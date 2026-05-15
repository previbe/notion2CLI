# notion2CLI v0.2.0

notion2CLI now supports both Notion and Feishu/Lark document workflows through the local Chrome extension bridge.

Select text in a supported document page, or run the whole page, and notion2CLI sends that content as the next user request to the active local Codex or Claude Code runtime. Results return to the browser Activity panel. Notion full-page reads and write-back continue to use the configured Notion MCP runtime path. Feishu/Lark document reads and write-back use the bundled official `lark-cli` and explicit Wiki/Docx OpenAPI calls.

## Highlights

- Provider architecture for Notion and Feishu/Lark.
- Chrome extension Activity panel on Notion, Feishu docx/wiki, and Lark docx/wiki pages.
- Local bridge at `127.0.0.1:43821`.
- Browser pairing with a short-lived code and local bearer token.
- Selected text and full-page document runs.
- Feishu/Lark full-page reads through the bundled official `lark-cli`.
- Feishu/Lark write-back through official Wiki and Docx OpenAPI calls.
- Supported document images prepared as local artifacts.
- Stable visible Codex App session support.
- Claude Code channel support through `notion2cli claude launch`.
- Prompt profiles, including `Raw`, `PreVibe`, and `Build`.
- Optional manual write-back modes: append, replace selection, replace page body.
- Bridge status and extension request timeout fixes to avoid indefinite pending write-back states.

## Install

```bash
npm install -g notion2cli@0.2.0
```

Then install or update the Chrome extension package for v0.2.0.

## Requirements

- Node.js `>=22.15.0`
- npm
- Google Chrome
- Codex CLI or Claude Code
- A logged-in Notion browser session for Notion pages
- Notion MCP configured for the selected runtime when using Notion full-page reads or Notion write-back
- Feishu/Lark browser authorization through the bundled official `lark-cli` when using Feishu/Lark docs

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

Paste the pairing code into the Chrome extension popup, then open a supported Notion or Feishu/Lark document page and run `Raw`, `PreVibe`, `Build`, or a custom prompt profile.

For Feishu/Lark documents, open the extension popup and choose `Connect Feishu/Lark` to complete the local browser authorization flow before full-page reads or write-back.

## Security Notes

- The bridge binds to localhost.
- Browser pairing resets when the bridge restarts.
- Notion full-page reads and write-backs go through your configured runtime and Notion MCP.
- Feishu/Lark access is authorized locally through `lark-cli`; notion2CLI does not store Feishu/Lark secrets.
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
