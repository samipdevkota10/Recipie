#!/bin/bash
agent-browser --headed open "https://www.google.com/search?q=top+10+pizza+places+NYC"
agent-browser wait 4000
agent-browser scroll 800
agent-browser wait 2000
agent-browser scroll 800
agent-browser wait 2000
agent-browser snapshot -i > raw_snapshot.txt
agent-browser screenshot agent_page.png