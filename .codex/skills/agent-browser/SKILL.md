---
name: "agent-browser"
description: "Browser automation CLI for AI agents using Chrome or Chromium via CDP. Use when the user needs to interact with websites from the terminal, including opening pages, filling forms, clicking buttons, waiting for UI changes, taking screenshots, extracting data, downloading files, testing web apps, logging in, or automating browser actions with `agent-browser` or `npx agent-browser`."
---

# Agent Browser

Drive a real browser from the terminal with `agent-browser`. Prefer CLI-first workflows: navigate, snapshot interactive refs, act on fresh refs, and re-snapshot after navigation or major DOM changes.

## Prerequisites

Check whether the CLI is available before planning a workflow:

```bash
command -v agent-browser >/dev/null 2>&1 || command -v npx >/dev/null 2>&1
```

Use `agent-browser` directly when installed globally. Use `npx agent-browser ...` when `npx` is present and a project-local or on-demand install is preferred.

If neither is available, install it first:

```bash
npm i -g agent-browser
agent-browser install
```

Alternative installs:

```bash
brew install agent-browser
agent-browser install

cargo install agent-browser
agent-browser install
```

Upgrade with:

```bash
agent-browser upgrade
```

## Tooling

Use Bash commands that invoke:

- `agent-browser ...`
- `npx agent-browser ...`

## Core Workflow

Follow this loop unless the task clearly needs a variant:

1. Open the page.
2. Wait for load stability when needed.
3. Snapshot with interactive refs.
4. Interact with `@eN` refs from the latest snapshot.
5. Re-snapshot after navigation or DOM changes.

Minimal example:

```bash
agent-browser open https://example.com/form
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i
```

## Operating Rules

- Prefer `snapshot -i` as the default way to discover stable element refs.
- Re-snapshot after clicks that navigate, form submissions, modal changes, and dynamic DOM updates.
- Chain commands with `&&` only when no intermediate output needs to be parsed.
- Use `batch --json` for known multi-step sequences that do not depend on intermediate output.
- Use named sessions for concurrent automations so separate agents do not trample each other.
- Close sessions when done to avoid leaked browser processes.
- Prefer explicit waits such as `wait --load networkidle`, `wait --url`, `wait --text`, or `wait <selector>` on slow pages.
- Use `eval --stdin` or `eval -b` for complex JavaScript to avoid shell-quoting corruption.

## Authentication

Choose the lightest approach that fits the task:

- Import auth from a running browser for one-off work.
- Use `--profile` for recurring manual logins.
- Use `--session-name` for auto-saved cookies and localStorage.
- Use the auth vault when credentials should be stored and replayed without exposing plaintext in the prompt.
- Use `state save` and `state load` for manual session reuse.

State files can contain live session tokens in plaintext. Add them to `.gitignore`, delete them when no longer needed, and set `AGENT_BROWSER_ENCRYPTION_KEY` when encryption at rest matters.

See [references/authentication.md](references/authentication.md) when login flows, OAuth, 2FA, or session reuse are central to the task.

## Safety

When browsing untrusted pages or scraping arbitrary content:

- Prefer `--content-boundaries` or `AGENT_BROWSER_CONTENT_BOUNDARIES=1`.
- Restrict navigation with `AGENT_BROWSER_ALLOWED_DOMAINS`.
- Use an action policy when destructive actions must be blocked.
- Set `AGENT_BROWSER_MAX_OUTPUT` to avoid flooding context with oversized pages.

## References

Open only what the task needs:

- [references/commands.md](references/commands.md) for command syntax and examples
- [references/snapshot-refs.md](references/snapshot-refs.md) for ref lifecycle, snapshots, waits, iframes, and `eval`
- [references/session-management.md](references/session-management.md) for sessions, cleanup, local files, existing Chrome, iOS, and engine selection
- [references/authentication.md](references/authentication.md) for login flows and state reuse
- [references/video-recording.md](references/video-recording.md) for recording and headed debugging
- [references/profiling.md](references/profiling.md) for Chrome DevTools profiling
- [references/proxy-support.md](references/proxy-support.md) for proxy configuration
