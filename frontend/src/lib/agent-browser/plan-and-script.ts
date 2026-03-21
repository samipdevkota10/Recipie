import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerativeModel,
  type ObjectSchema,
} from "@google/generative-ai";

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
agent-browser snapshot -i > ./amazon_snapshot.txt
agent-browser wait 4000
agent-browser close

### Example B (Priceline tab — note click BEFORE --name)
#!/bin/bash
set -e
agent-browser open "https://www.priceline.com/"
agent-browser wait 3500
agent-browser find role tab click --name "Flights"
agent-browser wait 2500
agent-browser snapshot -i > ./priceline_tab.txt
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
5. **Waits:** Prefer \`agent-browser wait <ms>\` (e.g. 2500–4000) after \`open\` and after clicks.
   **Avoid \`agent-browser wait --load networkidle\`** on analytics-heavy or SPA sites (ads, tracking, websockets) — it often **never completes** and hangs the script. Use fixed ms waits + scroll + snapshot instead.
6. **Tabs / wrong view:** If a page has tabs like "Events" vs "Venues", **click the tab that shows the data you need** (e.g. \`find text "Events" click\` or \`find role tab click --name "Events"\`) **before** scrolling and snapshotting listings.
7. **Portable shell (macOS default):** Do **NOT** use \`grep -oP\` (GNU-only; fails on macOS BSD grep). Use \`grep -E\`, \`sed -E\`, \`awk\`, or \`perl\` for extraction. Use \`sed -E\` not \`sed -r\`.
8. For CSV: snapshot -i > file.txt then grep/sed/awk/echo to build a .csv; state in # comments that rows are approximate.
9. Before close: wait at least 3000ms so a human can see the final page.
10. No markdown fences. No prose outside the script.
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
- cli_reminders: find role ... click --name ordering; **avoid wait --load networkidle** on busy sites; use fixed agent-browser wait ms; click correct listing tab before snapshot; macOS-compatible parsing.

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
- \`agent-browser open <url>\`
- \`agent-browser wait <ms>\` — **prefer this** after navigation. Avoid \`wait --load networkidle\` on heavy SPAs (often hangs forever).
- **Find + action (order matters):**
  - \`agent-browser find text "Sign In" click\`
  - \`agent-browser find role tab click --name "Flights"\`  ← **CORRECT:** action \`click\` comes **before** \`--name\`. **WRONG:** \`find role tab --name "Flights" click\` (causes "Unknown subaction: --name").
  - \`agent-browser find role button click --name "Search"\`
  - \`agent-browser find label "Email" fill "a@b.com"\` | \`find placeholder "City" fill "LAX"\` | \`find label "To" fill "LAX"\`
- **Typing / inputs ARE supported** — use \`find ... fill\`, \`find ... type\`, or \`agent-browser fill <selector> "text"\` / \`keyboard type "text"\` after focus. **Never** claim the tool cannot fill inputs.
- \`agent-browser scroll down <pixels>\` (or up/left/right)
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

  if (!s.startsWith("#!/")) {
    s = `#!/bin/bash\n${s}`;
  }
  return s;
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
