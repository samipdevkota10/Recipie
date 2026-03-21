# Authentication

## Table of Contents

1. Import Auth from the User's Browser
2. Persistent Profile
3. Session Name
4. Auth Vault
5. State Files
6. Security Notes

## Import Auth from the User's Browser

Use this for fast one-off work when the user is already logged in:

```bash
agent-browser --auto-connect state save ./auth.json
agent-browser --state ./auth.json open https://app.example.com/dashboard
```

## Persistent Profile

Use a profile for recurring manual logins:

```bash
agent-browser --profile ~/.myapp open https://app.example.com/login
agent-browser --profile ~/.myapp open https://app.example.com/dashboard
```

## Session Name

Use a session name when cookies and localStorage should auto-save and auto-restore:

```bash
agent-browser --session-name myapp open https://app.example.com/login
agent-browser close

agent-browser --session-name myapp open https://app.example.com/dashboard
```

Saved state can be encrypted at rest:

```bash
export AGENT_BROWSER_ENCRYPTION_KEY=$(openssl rand -hex 32)
agent-browser --session-name secure open https://app.example.com
```

State management helpers:

```bash
agent-browser state list
agent-browser state show myapp-default.json
agent-browser state clear myapp
agent-browser state clean --older-than 7
```

## Auth Vault

Use the auth vault when credentials should be stored once and replayed without exposing passwords in prompts or shell history:

```bash
echo "$PASSWORD" | agent-browser auth save myapp --url https://app.example.com/login --username user --password-stdin
agent-browser auth login myapp

agent-browser auth list
agent-browser auth show myapp
agent-browser auth delete myapp
```

`auth login` waits for login selectors to appear before interacting, which is more reliable on delayed SPA login screens.

## State Files

Save and load browser state manually when a file-based workflow is preferable:

```bash
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "$USERNAME"
agent-browser fill @e2 "$PASSWORD"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
agent-browser state save auth.json

agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard
```

## Security Notes

- State files contain session tokens in plaintext unless encrypted.
- Add files such as `auth.json` to `.gitignore`.
- Delete saved state when it is no longer needed.
- Prefer piping secrets through stdin over putting them in shell history.
