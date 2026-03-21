export const VIDEO_TO_DETAILED_DESCRIPTION_PROMPT = `
You are analyzing a screen recording of a task that should later be carried out by an autonomous Codex agent.

Your job is to extract the details that make the task executable.

Return plain text only. Do not return JSON. Do not use markdown fences.
Use exactly these section headings and keep them in this order:

### HIGH LEVEL DESCRIPTION OF WHAT THE TASK ###

### TRANSCRIPT WITH TIMESTAMPS ###

### TIMELINE OF THE USER ACTIONS WITH DESCRIPTION OF WHAT HAPPENS ###

### RELEVANT URLS AND LINKS ###

What to include:
- The real goal of the task, what the user is trying to produce, and what a successful result looks like.
- The starting page, site, app, and any visible navigation path.
- Visible URLs, domains, search queries, form labels, button names, menu items, filters, copied text, filenames, and output destinations.
- A timestamped transcript of spoken narration or on-screen text that clarifies the workflow.
- A chronological action timeline that captures clicks, typing, scrolling, navigation, waits, downloads, and decisions.
- Any repeated pattern the agent should generalize.
- Any blockers, uncertainty, or missing information that the downstream agent should know about.

Rules:
- Prefer concrete facts from the video over generic summaries.
- If something is not fully visible but strongly implied, label it with "Inference:".
- Redact passwords, secrets, API keys, and one-time codes.
- If exact text was typed and visible, include it verbatim.
- If audio helps resolve what happened, use it.
- If the task seems to create an artifact such as a CSV, markdown file, checklist, or report, say so explicitly in the high-level description.
`;
