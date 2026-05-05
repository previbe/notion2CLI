# Chrome Web Store Listing Draft

## Product Name

notion2CLI

## Short Description

Run Notion page content in your local Codex or Claude Code session.

## Detailed Description

notion2CLI turns a Notion page into a rich-text input surface for local AI coding sessions.

Open a Notion page, select text or run the whole page, and notion2CLI sends that content to your active local Codex CLI or Claude Code session through a localhost bridge. The result appears back in the browser Activity panel. When a task genuinely needs to update the current Notion page, the runtime can write back through your configured Notion MCP server.

What it does:

- Send selected Notion text to Codex CLI or Claude Code.
- Send a full Notion page through runtime-backed Notion MCP.
- Include supported Notion page images as local artifacts.
- Show the latest assistant result in the Notion-side Activity panel.
- Reuse a stable visible Codex App session.
- Deliver Claude jobs into the active `notion2cli claude launch` terminal session.
- Support local prompt profiles, including Raw, PreVibe, and Build.
- Optionally append or write results back to Notion through Notion MCP.

Local-first by design:

- The extension connects to `http://127.0.0.1:43821`.
- notion2CLI does not run a cloud service.
- Pairing uses a local 6-digit code and a local bearer token.
- Notion credentials stay with your configured runtime and Notion MCP setup.

Requirements:

- Node.js 22.15+
- The notion2CLI CLI bridge installed locally
- Codex CLI or Claude Code
- Google Chrome
- A logged-in Notion browser session
- Notion MCP configured for the selected runtime

This is an early MVP for developers who already use Notion as a planning surface and Codex or Claude Code as local execution tools.

## Category

Productivity

## Language

English

## Website

https://github.com/previbe/notion2CLI

## Support URL

https://github.com/previbe/notion2CLI/issues

## Privacy Policy URL

Use the public URL where `PRIVACY.md` is hosted.

Recommended:

https://previbe.github.io/notion2CLI/privacy/

If GitHub Pages is not set up, publish the same content from `PRIVACY.md` somewhere public before submitting.

## Single Purpose Statement

notion2CLI sends user-triggered Notion page content to a local Codex CLI or Claude Code session through a localhost bridge and displays the result in the browser Activity panel.

## Permission Justification

### `storage`

Used to store local extension settings, including the local bridge pairing token, selected prompt profile, panel position, manual write-back visibility, and write-back mode. The data is stored in Chrome extension storage on the user's machine.

### `https://www.notion.so/*` and `https://notion.so/*`

Used to show the Activity panel on Notion pages and read the current page title, page URL, and user-selected text. The extension does not run on unrelated websites.

### `http://127.0.0.1:43821/*`

Used to communicate with the local notion2CLI bridge running on the user's machine. This is required because the extension does not send page content to a notion2CLI cloud service.

## Data Usage Summary

The extension handles Notion page URLs, page titles, selected text, full-page content when the user explicitly runs a full-page task, image URLs from the page markdown, local settings, and assistant replies.

The extension sends this data only to the local bridge at `127.0.0.1:43821`. The local bridge then sends task material to the user's configured local Codex CLI or Claude Code runtime. Those tools may use their own services according to the user's configuration and terms.

## Remote Code Declaration

notion2CLI does not execute remote code in the Chrome extension.

The extension package contains its JavaScript, CSS, HTML, manifest, and icons. It does not load executable scripts from remote URLs.

## Reviewer Notes Summary

Use the full instructions in `chrome-store/REVIEW_NOTES.md`.

Short version:

1. Install the CLI from npm or from source.
2. Load the extension.
3. Start `notion2cli daemon start --runtime standalone --foreground` for a no-account smoke test, or use Codex/Claude with Notion MCP for the real flow.
4. Run `notion2cli pair`.
5. Pair the extension in Chrome.
6. Open a Notion page and run selected text or current page from the Activity panel.

## Screenshot Plan

Prepare these assets before final submission:

- Activity panel on a Notion page.
- Extension popup showing bridge setup and pairing.
- Prompt profile manager.
- Result displayed in the Activity panel.
- Optional write-back settings.

Avoid screenshots containing private Notion workspace data.
