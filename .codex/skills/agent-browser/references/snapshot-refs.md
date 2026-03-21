# Snapshot and Refs

## Table of Contents

1. Core Workflow
2. Ref Lifecycle
3. Annotated Screenshots
4. Iframes
5. Semantic Locators
6. JavaScript Evaluation
7. Slow Pages and Timeouts

## Core Workflow

Every browser automation follows this pattern:

1. Navigate: `agent-browser open <url>`
2. Snapshot: `agent-browser snapshot -i`
3. Interact: use refs such as `@e1`, `@e2`
4. Re-snapshot after navigation or DOM changes

Example:

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i
```

## Ref Lifecycle

Refs are invalidated when the page changes. Always re-snapshot after:

- clicking links or buttons that navigate
- form submissions
- dynamic content loading
- opening or closing menus and modals

Example:

```bash
agent-browser click @e5
agent-browser snapshot -i
agent-browser click @e1
```

Use `diff snapshot` after an action when you need to verify a UI change against the last snapshot:

```bash
agent-browser snapshot -i
agent-browser click @e2
agent-browser diff snapshot
```

## Annotated Screenshots

Use annotated screenshots when spatial reasoning matters or text snapshots miss the target:

```bash
agent-browser screenshot --annotate
agent-browser click @e2
```

This caches refs and overlays numbered labels. It is useful for icon buttons, charts, canvas elements, and layout verification.

## Iframes

Iframe content is inlined in snapshots. Refs inside iframes already carry frame context, so interact with them directly:

```bash
agent-browser open https://example.com/checkout
agent-browser snapshot -i
agent-browser fill @e3 "4111111111111111"
agent-browser fill @e4 "12/28"
agent-browser click @e5
```

To scope work to one iframe:

```bash
agent-browser frame @e2
agent-browser snapshot -i
agent-browser frame main
```

## Semantic Locators

Use semantic locators when refs are unavailable or unstable:

```bash
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find role button click --name "Submit"
agent-browser find placeholder "Search" type "query"
agent-browser find testid "submit-btn" click
```

## JavaScript Evaluation

Prefer `eval --stdin` or `eval -b` for anything beyond a trivial one-liner. Shell quoting can corrupt nested quotes, template literals, `!`, backticks, and `$()`.

Simple expressions:

```bash
agent-browser eval 'document.title'
agent-browser eval 'document.querySelectorAll("img").length'
```

Recommended heredoc form:

```bash
agent-browser eval --stdin <<'EVALEOF'
JSON.stringify(
  Array.from(document.querySelectorAll("img"))
    .filter(i => !i.alt)
    .map(i => ({ src: i.src.split("/").pop(), width: i.width }))
)
EVALEOF
```

Base64 variant:

```bash
agent-browser eval -b "$(echo -n 'Array.from(document.querySelectorAll(\"a\")).map(a => a.href)' | base64)"
```

## Slow Pages and Timeouts

The default timeout is 25 seconds. Override it with `AGENT_BROWSER_DEFAULT_TIMEOUT` when needed, but prefer explicit waits:

```bash
agent-browser wait --load networkidle
agent-browser wait "#content"
agent-browser wait @e1
agent-browser wait --url "**/dashboard"
agent-browser wait --fn "document.readyState === 'complete'"
agent-browser wait 5000
```
