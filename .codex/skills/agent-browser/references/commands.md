# Commands Reference

## Table of Contents

1. Navigation
2. Snapshot
3. Interaction
4. Get Information
5. Wait
6. Downloads
7. Network
8. Viewport and Device Emulation
9. Capture
10. Clipboard
11. Diff
12. Batch Execution

## Navigation

```bash
agent-browser open <url>              # Navigate (aliases: goto, navigate)
agent-browser close                   # Close browser
```

## Snapshot

```bash
agent-browser snapshot -i             # Interactive elements with refs (recommended)
agent-browser snapshot -i -C          # Include cursor-interactive elements
agent-browser snapshot -s "#selector" # Scope to CSS selector
```

## Interaction

```bash
agent-browser click @e1
agent-browser click @e1 --new-tab
agent-browser fill @e2 "text"
agent-browser type @e2 "text"
agent-browser select @e1 "option"
agent-browser check @e1
agent-browser press Enter
agent-browser keyboard type "text"
agent-browser keyboard inserttext "text"
agent-browser scroll down 500
agent-browser scroll down 500 --selector "div.content"
```

## Get Information

```bash
agent-browser get text @e1
agent-browser get url
agent-browser get title
agent-browser get cdp-url
```

## Wait

```bash
agent-browser wait @e1
agent-browser wait --load networkidle
agent-browser wait --url "**/page"
agent-browser wait 2000
agent-browser wait --text "Welcome"
agent-browser wait --fn "!document.body.innerText.includes('Loading...')"
agent-browser wait "#spinner" --state hidden
```

## Downloads

```bash
agent-browser download @e1 ./file.pdf
agent-browser wait --download ./output.zip
agent-browser --download-path ./downloads open <url>
```

## Network

```bash
agent-browser network requests
agent-browser network route "**/api/*" --abort
agent-browser network har start
agent-browser network har stop ./capture.har
```

## Viewport and Device Emulation

```bash
agent-browser set viewport 1920 1080
agent-browser set viewport 1920 1080 2
agent-browser set device "iPhone 14"
```

The third `set viewport` argument sets `window.devicePixelRatio` without changing CSS layout.

## Capture

```bash
agent-browser screenshot
agent-browser screenshot --full
agent-browser screenshot --annotate
agent-browser screenshot --screenshot-dir ./shots
agent-browser screenshot --screenshot-format jpeg --screenshot-quality 80
agent-browser pdf output.pdf
```

## Clipboard

```bash
agent-browser clipboard read
agent-browser clipboard write "Hello, World!"
agent-browser clipboard copy
agent-browser clipboard paste
```

## Diff

```bash
agent-browser diff snapshot
agent-browser diff snapshot --baseline before.txt
agent-browser diff screenshot --baseline before.png
agent-browser diff url <url1> <url2>
agent-browser diff url <url1> <url2> --wait-until networkidle
agent-browser diff url <url1> <url2> --selector "#main"
```

## Batch Execution

Use `batch` when the command sequence is known in advance and does not depend on parsing intermediate output:

```bash
echo '[
  ["open", "https://example.com"],
  ["snapshot", "-i"],
  ["click", "@e1"],
  ["screenshot", "result.png"]
]' | agent-browser batch --json

agent-browser batch --bail < commands.json
```

## Common Patterns

### Form Submission

```bash
agent-browser open https://example.com/signup
agent-browser snapshot -i
agent-browser fill @e1 "Jane Doe"
agent-browser fill @e2 "jane@example.com"
agent-browser select @e3 "California"
agent-browser check @e4
agent-browser click @e5
agent-browser wait --load networkidle
```

### Data Extraction

```bash
agent-browser open https://example.com/products
agent-browser snapshot -i
agent-browser get text @e5
agent-browser get text body > page.txt

agent-browser snapshot -i --json
agent-browser get text @e1 --json
```

### Command Chaining

Use `&&` when intermediate output is not needed:

```bash
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser snapshot -i
agent-browser fill @e1 "user@example.com" && agent-browser fill @e2 "password123" && agent-browser click @e3
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser screenshot page.png
```
