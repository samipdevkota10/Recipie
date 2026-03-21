# Video Recording

Use headed mode and recording when visual debugging matters:

```bash
agent-browser --headed open https://example.com
agent-browser highlight @e1
agent-browser inspect
agent-browser record start demo.webm
# ...interactions...
agent-browser record stop
```

Notes:

- `AGENT_BROWSER_HEADED=1` also enables headed mode.
- Use recording when debugging flaky UI flows or when the user wants a replayable artifact.
- Use `highlight` before recording if the target element is hard to identify.
