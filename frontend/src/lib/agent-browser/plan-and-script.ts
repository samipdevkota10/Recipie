import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerativeModel,
  type ObjectSchema,
} from "@google/generative-ai";
import type { VideoAnalysisResult } from "@/lib/types/video-analysis";

/** Structured plan: phase 1 of the agent (reasoning before bash). */
export interface AgentTaskPlan {
  goal: string;
  primary_site: string;
  url_strategy:
    | "direct_search_or_listing_url"
    | "homepage_then_ui_search"
    | "multi_page_unknown";
  /** Concrete URL to open first when possible (search results, /s?k=, etc.) */
  start_url: string | null;
  /** Short imperative steps the bash script should implement */
  steps_outline: string[];
  /** How to satisfy "CSV / data" asks */
  data_extraction:
    | "none"
    | "snapshot_then_shell_csv"
    | "snapshot_only"
    | "screenshot_manual";
  /** What could break (captcha, DOM changes, etc.) */
  failure_risks: string[];
  /** Extra reminder for the script author */
  cli_reminders: string;
}

const PLAN_SCHEMA: ObjectSchema = {
  type: SchemaType.OBJECT,
  properties: {
    goal: {
      type: SchemaType.STRING,
      description: "Single sentence: what done looks like for the user.",
    },
    primary_site: {
      type: SchemaType.STRING,
      description: "Main hostname, e.g. amazon.com or priceline.com",
    },
    url_strategy: {
      type: SchemaType.STRING,
      description:
        "direct_search_or_listing_url | homepage_then_ui_search | multi_page_unknown",
    },
    start_url: {
      type: SchemaType.STRING,
      description:
        "Best first URL, or empty string if unknown. Prefer /s?k= search URLs over homepages.",
      nullable: true,
    },
    steps_outline: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "4–12 short steps the bash script must perform in order.",
    },
    data_extraction: {
      type: SchemaType.STRING,
      description:
        "none | snapshot_then_shell_csv | snapshot_only | screenshot_manual",
    },
    failure_risks: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "Concrete risks (wrong filter text, bot check, etc.).",
    },
    cli_reminders: {
      type: SchemaType.STRING,
      description:
        "One paragraph: e.g. find role tab CLICK before --name; use wait between steps.",
    },
  },
  required: [
    "goal",
    "primary_site",
    "url_strategy",
    "steps_outline",
    "data_extraction",
    "failure_risks",
    "cli_reminders",
  ],
};

const FEW_SHOT_SCRIPT = `
### Example A (Amazon search — fixed waits, no networkidle)
#!/bin/bash
set -e
agent-browser open "https://www.amazon.com/s?k=energy+drinks"
agent-browser wait 3500
agent-browser scroll down 700
agent-browser wait 1500
agent-browser snapshot -i > raw_snapshot.txt
agent-browser screenshot agent_page.png
agent-browser wait 4000
agent-browser close

### Example B (Priceline tab — note click BEFORE --name)
#!/bin/bash
set -e
agent-browser open "https://www.priceline.com/"
agent-browser wait 3500
agent-browser find role tab click --name "Flights"
agent-browser wait 2500
agent-browser snapshot -i > raw_snapshot.txt
agent-browser screenshot agent_page.png
agent-browser wait 4000
agent-browser close
`.trim();

const SCRIPT_AUTHOR_RULES = `
You write ONLY a bash script for the \`agent-browser\` CLI. Rules:

1. Start with #!/bin/bash and set -e on the next line.
2. **find role** syntax MUST be: agent-browser find role <role> <action> --name "Label"
   NEVER: find role <role> --name "Label" click  (breaks CLI: Unknown subaction: --name)
3. Inputs ARE supported: find placeholder "..." fill "...", find label "..." fill "...", etc.
4. Prefer **direct listing/search URLs** over homepage + search box when possible.
5. **Keyboard:** Use \`agent-browser press Enter\`, \`agent-browser press Tab\`, etc. **Never** \`agent-browser press_key\` (invalid). After \`fill\` on a search field, use \`agent-browser press Enter\` to submit.
6. **Waits:** Prefer \`agent-browser wait <ms>\` (2500–4000) after \`open\` and clicks. **Avoid \`wait --load networkidle\`** on heavy SPAs (often hangs).
7. **Google / search:** Prefer \`agent-browser open "https://www.google.com/search?q=terms+here"\` over fragile combobox roles. Or \`find placeholder "Search" fill "..."\` then \`agent-browser press Enter\`.
8. **Tabs / wrong view:** If a page has tabs like "Events" vs "Venues", click the data tab first (\`find text "Events" click\` or \`find role tab click --name "Events"\`) before scrolling and snapshotting.
9. **Portable shell (macOS):** No \`grep -oP\`; use \`grep -E\`, \`sed -E\`, \`awk\`. No \`sed -r\`.
10. For CSV: snapshot -i > file.txt then grep/sed/awk/echo; comment that rows are approximate.
11. Before close: wait at least 3000ms.
12. **Headless / in-app preview:** No \`agent-browser --headed\`; use plain \`agent-browser\`.
13. **REQUIRED — data capture:** Before \`close\`, you MUST run: \`agent-browser screenshot agent_page.png\` AND \`agent-browser snapshot -i > raw_snapshot.txt\`. These files are consumed by a downstream verification + CSV extraction step. Without them the pipeline fails.
14. No markdown fences. No prose outside the script.
`.trim();

function getModelName(envKey: string, fallback: string) {
  const v = process.env[envKey];
  return v && v.trim() ? v.trim() : fallback;
}

export function createAgentModels(apiKey: string): {
  planModel: GenerativeModel;
  scriptModel: GenerativeModel;
} {
  const genAI = new GoogleGenerativeAI(apiKey);
  const planModel = genAI.getGenerativeModel({
    model: getModelName("AGENT_PLAN_MODEL", "gemini-2.5-flash"),
  });
  const scriptModel = genAI.getGenerativeModel({
    model: getModelName("AGENT_SCRIPT_MODEL", "gemini-2.5-flash"),
  });
  return { planModel, scriptModel };
}

export async function planAgentTask(
  planModel: GenerativeModel,
  userPrompt: string,
): Promise<AgentTaskPlan> {
  const text = `You plan browser automation executed later by a bash script calling the agent-browser CLI.

User request:
"""
${userPrompt}
"""

Instructions:
- Prefer concrete start_url when you can infer it (e.g. Amazon: https://www.amazon.com/s?k=QUERY with + for spaces).
- steps_outline must be actionable shell steps (open, fixed-ms wait, scroll, find/click tabs if needed, snapshot, portable grep/sed/awk, close).
- If the user wants a CSV, set data_extraction to snapshot_then_shell_csv and outline grep/sed steps using **portable** tools (no grep -oP; sed -E not sed -r).
- In failure_risks, mention SPA/networkidle hangs and wrong-tab UI when relevant.
- cli_reminders: find role ... click --name ordering; **avoid wait --load networkidle**; use \`agent-browser press Enter\` not press_key; prefer direct Google search URLs; macOS-compatible parsing; no \`--headed\`.

Respond ONLY as JSON matching the schema.`;

  const result = await planModel.generateContent({
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      temperature: 0.35,
      responseMimeType: "application/json",
      responseSchema: PLAN_SCHEMA,
    },
  });

  const raw = result.response.text();
  const parsed = JSON.parse(raw) as AgentTaskPlan;
  if (!parsed.steps_outline?.length) {
    throw new Error("Planner returned an empty steps_outline.");
  }
  if (parsed.start_url === "" || parsed.start_url === undefined) {
    parsed.start_url = null;
  }
  return parsed;
}

/** Original single-prompt template (fallback when structured planning fails). */
export function buildLegacyAgentPrompt(userPrompt: string): string {
  return `You are an expert at generating CLI bash scripts for the \`agent-browser\` tool. 
Your goal is to translate the user's natural language request into a sequence of \`agent-browser\` commands.

The available commands for \`agent-browser\` are:
- \`agent-browser close\`
- \`agent-browser open <url>\` — **never** \`agent-browser --headed open\` (host defaults to headless; user uses in-app preview).
- \`agent-browser wait <ms>\` — **prefer this** after navigation. Avoid \`wait --load networkidle\` on heavy SPAs (often hangs forever).
- **Find + action (order matters):**
  - \`agent-browser find text "Sign In" click\`
  - \`agent-browser find role tab click --name "Flights"\`  ← **CORRECT:** action \`click\` comes **before** \`--name\`. **WRONG:** \`find role tab --name "Flights" click\` (causes "Unknown subaction: --name").
  - \`agent-browser find role button click --name "Search"\`
  - \`agent-browser find label "Email" fill "a@b.com"\` | \`find placeholder "City" fill "LAX"\` | \`find label "To" fill "LAX"\`
- **Typing / inputs ARE supported** — use \`find ... fill\`, \`find ... type\`, or \`agent-browser fill <selector> "text"\` / \`keyboard type "text"\` after focus. **Never** claim the tool cannot fill inputs.
- \`agent-browser scroll down <pixels>\` (or up/left/right)
- \`agent-browser press Enter\` (or Tab, Escape) — **not** \`press_key\`
- \`agent-browser snapshot -i > <file>\`
- \`agent-browser click @eN\` (ref from a prior \`snapshot\`)

IMPORTANT — resilient scripts (especially Amazon / big retail sites):
1. Start with \`set -e\` so the script exits non-zero if a command fails (easier to debug).
2. **Prefer direct URLs over typing in search boxes.** Example: Amazon search → \`open "https://www.amazon.com/s?k=energy+drinks"\` instead of homepage + placeholder fill + "Search" click. Labels, placeholders, and roles change often and **"Search Amazon" / role Search** often do not match the real DOM.
3. **Do not assume filter text** like \`Under $10\` — Amazon shows different strings ($0 – $10, Up to $10, etc.) or hides filters until you scroll. Prefer: \`agent-browser wait 3000\`, \`scroll down 500\`, \`wait 1500\`, \`snapshot -i > /tmp/snap.txt\`, then \`find text\` using wording that plausibly appears, or refine the **search URL** with price/sort params if you know them. **Do not use \`wait --load networkidle\`** on sites with endless network activity — use fixed ms waits.
4. **CSV / data capture:** \`snapshot -i > file.txt\` captures listing text; use **macOS-portable** parsing: \`grep -E\`, \`sed -E\`, \`awk\` — **never \`grep -oP\`** (GNU-only). Say so in comments if extraction is approximate.
5. For a visible demo: add \`wait\` between steps (800–2500 ms). Before \`close\`, \`wait 4000+\` so the user sees the final page.

You must output EXACTLY a bash script, starting with #!/bin/bash. Do not include markdown formatting like \`\`\`bash. Just the raw text of the script.

Users Request: "${userPrompt}"`;
}

export async function generateScriptFromPlan(
  scriptModel: GenerativeModel,
  userPrompt: string,
  plan: AgentTaskPlan,
): Promise<string> {
  const planBlock = JSON.stringify(plan, null, 2);

  const text = `USER REQUEST:
${userPrompt}

STRUCTURED PLAN (follow this; do not contradict it):
${planBlock}

${SCRIPT_AUTHOR_RULES}

FEW-SHOT SCRIPTS (style and patterns only; adapt URLs/steps to the plan above):
${FEW_SHOT_SCRIPT}

Output ONLY the final bash script.`;

  const result = await scriptModel.generateContent({
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 8192,
    },
  });

  return sanitizeAgentBrowserScript(stripCodeFences(result.response.text()));
}

/** Remove ```bash / ``` wrappers if the model adds them. */
export function stripCodeFences(text: string): string {
  return text
    .replace(/^```bash\n?/i, "")
    .replace(/^```sh\n?/i, "")
    .replace(/^```\n?/, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

/**
 * Fix common Gemini mistakes: find role order, networkidle hangs, GNU-only sed -r on macOS.
 */
export function sanitizeAgentBrowserScript(script: string): string {
  let s = script;

  // Double quotes
  s = s.replace(
    /\bagent-browser\s+find\s+role\s+(\w+)\s+--name\s+"([^"]*)"\s+(click|fill|type|hover|focus|check|uncheck|text)\b/gi,
    'agent-browser find role $1 $3 --name "$2"',
  );
  // Single quotes
  s = s.replace(
    /\bagent-browser\s+find\s+role\s+(\w+)\s+--name\s+'([^']*)'\s+(click|fill|type|hover|focus|check|uncheck|text)\b/gi,
    "agent-browser find role $1 $3 --name '$2'",
  );

  // networkidle often never fires on SPAs → fixed wait (override with AGENT_KEEP_NETWORKIDLE=1)
  if (process.env.AGENT_KEEP_NETWORKIDLE !== "1" && process.env.AGENT_KEEP_NETWORKIDLE !== "true") {
    s = s.replace(
      /\bagent-browser\s+wait\s+--load\s+networkidle\b/g,
      "agent-browser wait 3500",
    );
  }

  // BSD/macOS sed uses -E; GNU sed accepts both — normalize for portability
  s = s.replace(/\bsed\s+-r\b/g, "sed -E");

  // Strip --headed unless user explicitly runs external window (matches route.ts AGENT_BROWSER_HEADED)
  const headedExternal =
    process.env.AGENT_BROWSER_HEADED === "1" ||
    process.env.AGENT_BROWSER_HEADED === "true";
  if (!headedExternal) {
    s = s.replace(/\bagent-browser\s+--headed\s+/g, "agent-browser ");
    s = s.replace(/\bnpx\s+agent-browser\s+--headed\s+/g, "npx agent-browser ");
  }

  // LLM hallucination: press_key is not a valid subcommand
  s = s.replace(
    /\bagent-browser\s+press_key\s+"([^"]+)"/gi,
    "agent-browser press $1",
  );
  s = s.replace(/\bagent-browser\s+press_key\s+(\S+)/gi, "agent-browser press $1");

  if (!s.startsWith("#!/")) {
    s = `#!/bin/bash\n${s}`;
  }
  return ensureArtifactCommands(s);
}

/**
 * Guarantee the script captures agent_page.png and raw_snapshot.txt
 * before the final `agent-browser close`. Without these files, the
 * post-execution verification and CSV extraction have nothing to work with.
 */
function ensureArtifactCommands(script: string): string {
  const hasScreenshot = /agent-browser\s+screenshot\s+agent_page\.png/i.test(script);
  const hasSnapshot = /agent-browser\s+snapshot\s+-i\s*>\s*\.?\/?(raw_snapshot\.txt)/i.test(script);

  if (hasScreenshot && hasSnapshot) return script;

  const inject: string[] = [];
  if (!hasSnapshot) inject.push('agent-browser snapshot -i > raw_snapshot.txt');
  if (!hasScreenshot) inject.push('agent-browser screenshot agent_page.png');

  const closeIdx = script.lastIndexOf('agent-browser close');
  if (closeIdx !== -1) {
    const before = script.slice(0, closeIdx);
    const after = script.slice(closeIdx);
    return `${before}agent-browser wait 1500\n${inject.join('\n')}\n${after}`;
  }

  return `${script}\nagent-browser wait 1500\n${inject.join('\n')}\n`;
}

/** One-shot script (legacy / fallback if planning fails). */
export async function generateScriptSingleShot(
  scriptModel: GenerativeModel,
  userPrompt: string,
): Promise<string> {
  const result = await scriptModel.generateContent({
    contents: [
      { role: "user", parts: [{ text: buildLegacyAgentPrompt(userPrompt) }] },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  });
  return sanitizeAgentBrowserScript(stripCodeFences(result.response.text()));
}

/**
 * Generate an agent-browser bash script from video-analyzed actions + user instructions.
 * The video JSON provides concrete observed steps; Gemini translates them to CLI commands
 * and incorporates any user modifications (different city, more suppliers, etc.).
 */
export async function generateScriptFromVideoActions(
  scriptModel: GenerativeModel,
  videoJson: VideoAnalysisResult,
  userInstructions: string,
): Promise<string> {
  const actionsBlock = videoJson.actions
    .map(
      (a) =>
        `  ${a.seq}. [${a.type}] ${a.description}` +
        (a.target ? ` | target: "${a.target}"` : "") +
        (a.value ? ` | value: "${a.value}"` : "") +
        (a.url_at_action ? ` | url: ${a.url_at_action}` : ""),
    )
    .join("\n");

  const text = `You are generating an agent-browser bash script that replays actions observed from a screen recording.

VIDEO ANALYSIS (what the user demonstrated):
- Task: ${videoJson.task_title}
- Intent: ${videoJson.user_intent}
- Starting URL: ${videoJson.starting_url ?? "unknown"}
- Observed actions:
${actionsBlock}

USER INSTRUCTIONS (how to adapt, extend, or modify the workflow):
${userInstructions || "Replay the observed actions faithfully — no modifications."}

ACTION → AGENT-BROWSER MAPPING:
- navigate (with URL in value)  → agent-browser open "<url>"
- click                         → agent-browser find text "<target>" click
- type (fill a field)           → agent-browser find placeholder "<target>" fill "<value>"
                                  or: agent-browser find label "<target>" fill "<value>"
- press_key                     → agent-browser press <value>  (Enter, Tab, Escape, etc.)
- scroll                        → agent-browser scroll down 500
- select (dropdown)             → agent-browser find role combobox click --name "<target>" then agent-browser find text "<value>" click
- wait                          → agent-browser wait 2000
- switch_tab                    → (skip — agent-browser manages one active page)
- hover                         → agent-browser find text "<target>" hover
- close                         → agent-browser close

${SCRIPT_AUTHOR_RULES}

CRITICAL RULES FOR THIS MODE:
1. Follow the observed action sequence closely — it reflects real user behavior.
2. If the user instructions ask to modify (e.g. different city, more items), adapt the relevant steps but keep the overall flow structure.
3. Merge consecutive click-into-field + type actions into a single find/fill command.
4. Add agent-browser wait 2500-3500 after every open and after clicks that trigger navigation.
5. End the script with: agent-browser screenshot agent_page.png && agent-browser snapshot -i > raw_snapshot.txt
6. Before close, wait at least 3000ms.

FEW-SHOT (style reference):
${FEW_SHOT_SCRIPT}

Output ONLY the final bash script.`;

  const result = await scriptModel.generateContent({
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 8192,
    },
  });

  return sanitizeAgentBrowserScript(stripCodeFences(result.response.text()));
}
