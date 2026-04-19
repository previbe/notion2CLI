---
name: connect
description: Use when the user wants to pair the current Claude Code session with the notion2CLI Chrome extension, or asks for the current bridge status.
---

This skill pairs the currently running Claude Code session with the local notion2CLI browser extension.

## What To Do

When the user asks to connect or pair notion2CLI:

1. Use the Bash tool to run `notion2cli pair`.
2. Do not invent a pairing code. Only show the exact code returned by the script.
3. Tell the user to open the `notion2CLI` popup in Chrome, paste the code, and click the connect button.
4. If the command fails, explain that the bridge is probably not running in this Claude session and ask the user to restart Claude Code in the project directory with the channel enabled.

When the user asks for current bridge status:

1. Use the Bash tool to run `notion2cli status`.
2. Summarize whether the bridge is up, whether a browser client is paired, and whether standalone mode is active.

## Important Rules

- Keep the response short and operational.
- Never fabricate a successful connection.
- If the bridge is reachable but not paired, say that explicitly.
