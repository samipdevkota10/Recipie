# Profiling

Use Chrome DevTools profiling when the task is performance analysis rather than routine interaction:

```bash
agent-browser --headed open https://example.com
agent-browser profiler start
# ...reproduce the slow flow...
agent-browser profiler stop trace.json
```

Notes:

- Headed mode is usually easier when reproducing performance problems.
- Save the trace file when the user needs an artifact for follow-up analysis.
