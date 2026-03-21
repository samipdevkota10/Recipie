# Proxy Support

Use proxy settings for geo-testing, corporate network routing, or controlled outbound traffic.

Project-local configuration example:

```json
{
  "headed": true,
  "proxy": "http://localhost:8080",
  "profile": "./browser-data"
}
```

Save that as `agent-browser.json` in the project root when the workflow should default to a proxy.

Configuration precedence is:

1. `~/.agent-browser/config.json`
2. `./agent-browser.json`
3. environment variables
4. CLI flags

When the task involves both proxies and authentication, prefer pairing proxy config with named sessions or profiles so repeated runs stay stable.
