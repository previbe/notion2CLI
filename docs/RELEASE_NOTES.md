# notion2CLI v0.1.2

notion2CLI turns a Notion page into the rich-text input surface for a local Codex or Claude Code session.

Select text in Notion, or run the whole page, and notion2CLI sends that content as the next user request to the active local runtime. The result returns to the browser Activity panel. When a task genuinely needs to update the Notion page, the runtime can write back through Notion MCP.

## Highlights

- Chrome extension Activity panel for Notion pages.
- Local bridge at `127.0.0.1:43821`.
- Browser pairing with a short-lived code and local bearer token.
- Selected text and full-page Notion runs.
- Runtime-backed full-page reads through Notion MCP.
- Local image artifact preparation for Notion page images.
- Stable visible Codex App session support.
- Claude Code channel support through `notion2cli claude launch`.
- Prompt profiles, including `Raw`, `PreVibe`, and `Build`.
- Optional manual write-back modes: append, replace selection, replace page body.

## Install

```bash
npm install -g notion2cli
```

Then install the Chrome extension from the Chrome Web Store:

```text
https://chromewebstore.google.com/detail/notion2cli/poadenkneikinepacildoepjamefghio
```

## Requirements

- Node.js `>=22.15.0`
- npm
- Google Chrome
- Codex CLI or Claude Code
- A logged-in Notion browser session
- Notion MCP configured for the selected runtime

## Quick Start

Codex:

```bash
notion2cli mcp install notion --runtime codex
notion2cli daemon start --runtime codex
notion2cli pair
```

Claude Code:

```bash
notion2cli claude launch
notion2cli pair
```

Paste the pairing code into the Chrome extension popup, then open a Notion page and run `Raw`, `PreVibe`, `Build`, or a custom prompt profile.

## Security Notes

- The bridge binds to localhost.
- Browser pairing resets when the bridge restarts.
- Full-page reads and write-backs go through your configured runtime and Notion MCP.
- Remote image downloads are capped and private-network image URLs are blocked by default.

Read `SECURITY.md` and `PRIVACY.md` before running notion2CLI on sensitive workspaces.

## Verification

Release checks for this version:

- `npm run check`
- `npm test`
- `npm audit --omit=dev`
- `npm pack --dry-run`
- `npm publish --dry-run --access public`
- `npm run package:extension`
