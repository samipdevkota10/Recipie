# Session Management

## Table of Contents

1. Named Sessions
2. Parallel Sessions
3. Existing Chrome
4. Cleanup
5. Local Files
6. iOS Simulator
7. Browser Engine Selection

## Named Sessions

Use named sessions whenever multiple agents or automations may run concurrently:

```bash
agent-browser --session agent1 open https://site-a.com
agent-browser --session agent2 open https://site-b.com
```

Inspect active sessions with:

```bash
agent-browser session list
```

## Parallel Sessions

Example:

```bash
agent-browser --session site1 open https://site-a.com
agent-browser --session site2 open https://site-b.com

agent-browser --session site1 snapshot -i
agent-browser --session site2 snapshot -i
```

## Existing Chrome

Attach to a running Chrome instance when reusing the user's current browser state is faster than logging in again:

```bash
agent-browser --auto-connect open https://example.com
agent-browser --auto-connect snapshot
agent-browser --cdp 9222 snapshot
```

## Cleanup

Close sessions when done:

```bash
agent-browser close
agent-browser --session agent1 close
```

If an earlier run leaked a daemon, closing the session is usually enough to clean it up. For ephemeral environments, auto-shutdown after inactivity:

```bash
AGENT_BROWSER_IDLE_TIMEOUT_MS=60000 agent-browser open example.com
```

## Local Files

Open local HTML or PDF files through `file://` URLs:

```bash
agent-browser --allow-file-access open file:///path/to/document.pdf
agent-browser --allow-file-access open file:///path/to/page.html
agent-browser screenshot output.png
```

## iOS Simulator

On macOS with Xcode and Appium configured:

```bash
agent-browser device list
agent-browser -p ios --device "iPhone 16 Pro" open https://example.com
agent-browser -p ios snapshot -i
agent-browser -p ios tap @e1
agent-browser -p ios fill @e2 "text"
agent-browser -p ios swipe up
agent-browser -p ios screenshot mobile.png
agent-browser -p ios close
```

Install requirements with:

```bash
npm install -g appium
appium driver install xcuitest
```

## Browser Engine Selection

Use the default Chrome engine unless the task specifically benefits from Lightpanda:

```bash
agent-browser --engine lightpanda open example.com
export AGENT_BROWSER_ENGINE=lightpanda
agent-browser open example.com
agent-browser --engine lightpanda --executable-path /path/to/lightpanda open example.com
```

Supported engines:

- `chrome`
- `lightpanda`
