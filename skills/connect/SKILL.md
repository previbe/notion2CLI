---
name: connect
description: Use when the user wants to pair the notion2CLI Chrome extension with the current local notion2CLI bridge/runtime, or asks for the current bridge status.
---

This skill connects the local notion2CLI browser extension to the current notion2CLI bridge/runtime.

## What To Do

When the user asks to connect or pair notion2CLI:

1. Use the Bash tool to run `notion2cli pair`.
2. Do not invent a pairing code. Only show the exact code returned by the script.
3. Tell the user to open the `notion2CLI` popup in Chrome, paste the code, and click the connect button.
4. If the command fails, explain that the current notion2CLI bridge/runtime is probably not running or not ready yet, and tell the user to start the desired daemon (`claude`, `codex`, or `standalone`) before retrying.

When the user asks for current bridge status:

1. Use the Bash tool to run `notion2cli status`.
2. Summarize whether the bridge is up, which runtime is active, whether a browser client is paired, and whether standalone mode is active.

## Important Rules

- Keep the response short and operational.
- Never fabricate a successful connection.
- The connection target is the current notion2CLI bridge/runtime, not a Claude or Codex chat session.
- If the bridge is reachable but not paired, say that explicitly.
