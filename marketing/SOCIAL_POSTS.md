# Social Launch Copy

## Positioning

notion2CLI is for developers who plan in Notion and execute in local AI coding CLIs.

Core message:

```text
Turn a Notion page into the input surface for local Codex CLI or Claude Code sessions.
```

## One-Liners

- Run Notion pages in your local AI coding CLI.
- Send Notion specs to Codex CLI or Claude Code.
- A local-first bridge from Notion pages to AI coding sessions.
- Use Notion as the rich-text input layer for local coding agents.

## GitHub Release Post

notion2CLI v0.1.0 is out.

It turns Notion pages into the input surface for local Codex CLI or Claude Code sessions:

- selected text -> local runtime task
- full page -> Notion MCP page bundle
- images -> local artifacts
- result -> browser Activity panel
- optional write-back through Notion MCP

GitHub: https://github.com/previbe/notion2CLI

## npm Release Post

notion2CLI is now installable from npm:

```bash
npm install -g notion2cli
```

Use it to send Notion selections or whole pages into local Codex CLI or Claude Code sessions through a localhost bridge.

Repo: https://github.com/previbe/notion2CLI

## Chrome Web Store Approval Post

notion2CLI is now available on the Chrome Web Store.

It adds a small Activity panel to Notion pages so you can run selected text or full pages in a local Codex CLI or Claude Code session.

Local-first: Chrome extension + localhost bridge + your configured runtime.

Install: <Chrome Web Store URL>

## Product Hunt Launch Post

notion2CLI is live on Product Hunt.

It lets developers run Notion specs and page content directly in local Codex CLI or Claude Code sessions.

Would love feedback on the setup flow, prompt profiles, and safe write-back model.

Product Hunt: <Product Hunt URL>

## LinkedIn Post

I released notion2CLI v0.1.0.

The problem it solves is simple: a lot of implementation work starts as structured notes or specs in Notion, but the execution happens in local AI coding tools.

notion2CLI adds a small Chrome extension panel to Notion and a local bridge to Codex CLI or Claude Code.

Current MVP:

- send selected Notion text to the active local runtime
- run a full Notion page through Notion MCP
- pass page images as local artifacts
- return the result to the browser panel
- optionally write back through Notion MCP

It is local-first and intentionally does not run a hosted notion2CLI backend.

GitHub: https://github.com/previbe/notion2CLI

## Hacker News / Indie Hackers Draft

I built notion2CLI, a local-first bridge from Notion pages to Codex CLI and Claude Code.

The extension lets you select text in Notion, or run the whole page, and sends that content to a local CLI runtime through a localhost bridge. Full-page reads go through the runtime's Notion MCP server, and image references can be prepared as local artifacts.

The result appears back in the Notion-side Activity panel. Optional write-back also goes through Notion MCP.

I kept the scope narrow for the MVP: no hosted backend, no direct Notion API integration in the bridge, no Chrome Native Messaging yet.

Repo: https://github.com/previbe/notion2CLI

## FAQ

### Is this a cloud service?

No. notion2CLI itself does not operate a hosted backend. The extension talks to a local bridge at `127.0.0.1`.

### Does data leave my machine?

notion2CLI sends data to your selected local runtime. Codex CLI, Claude Code, Notion MCP, and configured model providers may use their own network services according to your configuration and their terms.

### Does it write to Notion?

Only when the selected task or manual write-back flow asks for it. Write-back happens through the configured runtime and Notion MCP.

### Who is it for?

Developers who write specs, tasks, or implementation notes in Notion and want to run them directly in local AI coding tools.

### What is not supported yet?

Generic file attachments, Chrome Native Messaging, Claude Desktop injection, and full two-way history sync are not part of the MVP.
