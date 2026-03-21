# Agent Browser — manual test plan

Use this document to verify **Gemini → bash → `agent-browser`** end-to-end from the **Agent Browser** UI (`/`) and **`POST /api/run-agent`**.

---

## 1. Prerequisites (do once per machine)

| Step | Instruction | Pass criteria |
|------|-------------|----------------|
| 1.1 | Install Node **20+** (`node -v`). | Version ≥ 20. |
| 1.2 | From repo: `cd frontend && npm install`. | Completes with no errors. |
| 1.3 | Install browser binaries for agent-browser: `cd frontend && npx agent-browser install`. | Command finishes; Chrome/Chromium for Testing available. |
| 1.4 | Create **`frontend/.env.local`** with at least one of: `GEMINI_API_KEY=...` or `GOOGLE_GENERATIVE_AI_API_KEY=...`. | File exists; key is valid (Google AI Studio). |
| 1.5 | Default is **headless** (no external Chrome window). Optional: `AGENT_BROWSER_HEADED=true` in `.env.local` to debug with a real browser window. | In-app URL preview still updates from logs when headless. |
| 1.6 | Start dev server: `cd frontend && npm run dev`. | Terminal shows **Ready** and a **localhost** URL (note port if not 3000). |

---

## 2. Smoke test — API and UI load

### TC-01: Home page loads

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `http://localhost:3000` (or the port shown in the terminal). | Page title/heading **Agent Browser**; prompt field and **Run Agent** button visible. |
| 2 | Open DevTools → **Network**; keep tab open. | Ready for TC-02. |

**Pass:** Page renders with no console errors blocking the UI.

---

### TC-02: `POST /api/run-agent` returns a stream (not immediate 500)

| Step | Action | Expected |
|------|--------|----------|
| 1 | In the prompt box, enter: `Open https://example.com only, wait 2 seconds, then close the browser.` | Text entered. |
| 2 | Click **Run Agent**. | Within a few seconds, log shows **Gemini successfully generated** and **Script contents** with `#!/bin/bash`. |
| 3 | Watch Network for `run-agent`. | Status **200**; type **event-stream** (not JSON error body for the happy path). |
| 4 | Read terminal output for `agent-browser`. | Green checks or normal tool output; ends with **Exited with code** 0 or 1 depending on script. |

**Pass:** No immediate **500** with only `{ "error": "..." }` in Network → Response (that usually means missing API key or Gemini error).

**Fail:** JSON error such as *GEMINI_API_KEY* / *API key* → fix `.env.local` and restart `npm run dev`.

---

## 3. Functional test cases (prompts)

Run each from the UI unless noted. After each case, record: **script looked valid?**, **browser behavior?**, **exit code?**, **any red ✗ in logs?**

### TC-10: Minimal navigation (low flake)

**Prompt (copy-paste):**

```text
Generate a bash script that uses set -e, opens https://example.com, waits 2000 ms, then closes the browser. Use only agent-browser commands. No comments that skip steps.
```

| Step | Instruction | Pass criteria |
|------|-------------|----------------|
| 1 | Paste prompt → **Run Agent**. | Script includes `set -e`, `open`, `wait`, `close`. |
| 2 | Observe in-app preview and/or external window only if `AGENT_BROWSER_HEADED=true`. | example.com URL appears in preview when headless; script still runs. |
| 3 | Check log tail. | **Exited with code 0** (typical). |

---

### TC-11: Correct `find role` syntax (regression for `--name`)

**Prompt:**

```text
Open https://www.example.com, wait 1500ms, then close. Do not use find role. Only open, wait, close.
```

| Step | Instruction | Pass criteria |
|------|-------------|----------------|
| 1 | Run prompt. | No `Unknown subaction: --name` in output. |

**Prompt B (role + name — must use correct order):**

```text
Open https://example.com, wait networkidle, take an interactive snapshot saved to /tmp/tc11.txt, then close. Use agent-browser snapshot -i redirection.
```

| Step | Instruction | Pass criteria |
|------|-------------|----------------|
| 1 | Run. | Snapshot step runs; file may be under temp path the model chooses; no CLI parse errors. |

---

### TC-12: Direct URL search (Amazon-style resilience)

**Prompt:**

```text
Use set -e. Open https://www.amazon.com/s?k=notebook in the browser, wait --load networkidle, wait 2500ms, save an interactive snapshot to amazon_snap.txt in the current directory, wait 3000ms, then close. Do not click search boxes.
```

| Step | Instruction | Pass criteria |
|------|-------------|----------------|
| 1 | Run. | Page loads search results; `amazon_snap.txt` may appear under `frontend/` if the script uses a relative path (verify in repo or `/tmp` if model uses absolute path). |
| 2 | If path is wrong, note for prompt tuning. | Still pass if script is valid and Amazon loads without **Element not found** from bogus clicks. |

---

### TC-13: Fill + submit pattern (inputs are supported)

**Prompt:**

```text
Use set -e. Open https://example.com, wait 2000ms, close. Do not use find role with --name before the action word click.
```

| Step | Instruction | Pass criteria |
|------|-------------|----------------|
| 1 | Run. | Completes; educates model to avoid bad flag order on other runs. |

**Prompt B (stronger fill test — may flake on site changes):**

```text
Open https://www.google.com, wait --load networkidle, wait 1500ms, find the search box by role or placeholder and type a short query using find ... fill or fill with a selector if you output a snapshot first, press Enter or click search, wait 3000ms, then close. If any step fails, still close the browser.
```

| Step | Instruction | Pass criteria |
|------|-------------|----------------|
| 1 | Run. | Observe whether Google accepts automation (sometimes blocked). Pass = script is plausible and agent-browser runs without **command not found**. |

---

### TC-14: Priceline / flights (complex UI)

**Prompt:**

```text
Go to https://www.priceline.com/, wait networkidle, wait 2000ms. Open the Flights section using: agent-browser find role tab click --name "Flights" (action click BEFORE --name). Wait 2000ms, snapshot -i > priceline_flights_tab.txt, wait 3000ms, close.
```

| Step | Instruction | Pass criteria |
|------|-------------|----------------|
| 1 | Run. | No **Unknown subaction: --name**. If tab name differs, note DOM change — adjust `--name` per snapshot file. |

---

### TC-15: CSV-style follow-up (snapshot + shell)

**Prompt:**

```text
Open https://example.com, wait 2000ms, run snapshot -i > example_snapshot.txt, then use grep or echo in bash to append one header line and one data line to example_out.csv, wait 2000ms, close.
```

| Step | Instruction | Pass criteria |
|------|-------------|----------------|
| 1 | Run. | CSV or snapshot artifacts appear where the script writes them (often `frontend/`). |

---

## 4. Optional: `curl` API test

Replace port if needed.

```bash
cd frontend
# Stream SSE (noisier in terminal)
curl -N -X POST http://localhost:3000/api/run-agent \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Use set -e. Open https://example.com, wait 1500, close."}'
```

**Pass:** Lines starting with `data: ` and JSON payloads; ends after stream closes.  
**Fail:** Single JSON body with `"error"` → read message (key, JSON body, etc.).

---

## 5. Pass/fail summary (checklist)

| ID | Name | Pass? |
|----|------|-------|
| TC-01 | Home loads | ☐ |
| TC-02 | run-agent streams | ☐ |
| TC-10 | example.com minimal | ☐ |
| TC-11 | No `--name` parse error | ☐ |
| TC-12 | Amazon direct URL + snapshot | ☐ |
| TC-13 | Fill / Google (optional) | ☐ |
| TC-14 | Priceline tab syntax | ☐ |
| TC-15 | Snapshot + CSV shell | ☐ |

---

## 6. Known limitations (not bugs in your app)

- **Gemini output varies** — same prompt can produce different scripts; rerun once if flaky.
- **Sites block bots** — captchas, consent walls, or layout changes cause **Element not found**; use **direct URLs** and **snapshot** to adjust selectors.
- **`set -e`** — script stops on first failing `agent-browser` line (exit code ≠ 0); that is intentional for debugging.
- **Paths** — Scripts run with cwd = `frontend/`; relative files land in `frontend/` unless the model uses `/tmp/...`.

---

## 7. Suggested order for a quick 10-minute run

1. Complete **§1 Prerequisites**.  
2. **TC-01** → **TC-02**.  
3. **TC-10** (sanity).  
4. **TC-11** / **TC-14** if you care about `find role` syntax.  
5. **TC-12** or **TC-15** for snapshot/CSV behavior.

File issues with: prompt used, full **Script contents** from the UI, last 30 lines of terminal log, and `agent-browser --version` output.
