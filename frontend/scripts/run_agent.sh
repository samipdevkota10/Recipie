#!/bin/bash
# Resolve agent-browser from this app's node_modules (no global install required)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$FRONTEND_ROOT/node_modules/.bin:$PATH"

PROMPT="$1"

echo "Agent starting for prompt: $PROMPT"
if [[ "$PROMPT" == *"SF"* ]] || [[ "$PROMPT" == *"events"* ]]; then
    # Use the hardcoded script for the demo if SF or events is mentioned
    echo "[SYSTEM] Running specialized script for events tracking"
    agent-browser close
    agent-browser open https://cerebralvalley.ai/events
    agent-browser wait 4000
    agent-browser find text "SF & Bay Area" click
    agent-browser wait 2000
    agent-browser scroll 800
    agent-browser wait 1000
    agent-browser scroll 800
    agent-browser wait 2000
    agent-browser snapshot -i > events_raw.txt
    
    echo "Event Name" > sf_events.csv
    grep "Open event:" events_raw.txt | sed 's/- link "Open event: //g' | sed 's/" \[ref=.*//g' >> sf_events.csv
    echo "[SYSTEM] Done extracting events! Results saved to sf_events.csv"
else
    # Simple fallback script opening google
    echo "[SYSTEM] Initiating custom browsing session..."
    agent-browser open "https://google.com/search?q=$(echo $PROMPT | tr ' ' '+')"
    agent-browser wait 3000
    echo "[SYSTEM] Searching for your prompt!"
    agent-browser snapshot -i > custom_search.txt
    echo "[SYSTEM] Done executing custom request."
fi
