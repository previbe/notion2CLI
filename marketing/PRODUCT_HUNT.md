# Product Hunt Launch Draft

Use this after npm, GitHub Release, and Chrome Web Store are live.

Product Hunt's current posting flow asks for URL, name, tagline, topics, thumbnail, pricing, status, gallery, and optional video/demo. Their help center recommends a square thumbnail around `240 x 240` and gallery images around `1270 x 760`.

## Product URL

Use the most user-friendly public install page available at launch time.

Recommended order:

1. Chrome Web Store listing URL, once approved.
2. GitHub repository if the CWS listing is not live yet.

## Name

notion2CLI

## Tagline Options

Pick one:

1. Run Notion pages in your local AI coding CLI
2. Turn Notion pages into Codex and Claude tasks
3. Send Notion specs to Codex or Claude Code
4. A local bridge from Notion to AI coding CLIs

Recommended:

```text
Run Notion pages in your local AI coding CLI
```

## Short Description

notion2CLI lets you select text or run a whole Notion page as the next request in a local Codex CLI or Claude Code session. It uses a localhost bridge, Notion MCP, and a Chrome Activity panel so your planning page can become the execution surface.

## Topics

Use only the most relevant topics available in the Product Hunt UI:

- Developer Tools
- Productivity
- Artificial Intelligence
- Chrome Extensions
- Notion

## Pricing

Free.

## Status

Available.

If Chrome Web Store approval is still pending, do not launch on Product Hunt yet.

## Maker First Comment

Hey Product Hunt,

I built notion2CLI because a lot of my real work starts in Notion but gets executed in local AI coding tools.

The idea is narrow: make a Notion page act like the rich-text input surface for Codex CLI or Claude Code.

What it does today:

- select text in Notion and send it to the active local runtime
- run the current page through Notion MCP
- pass page images as local artifacts
- show the final result back in the browser panel
- optionally write back to the current Notion page through Notion MCP
- keep the bridge local at `127.0.0.1`

This is an early MVP for developers who already live in Notion plus Codex or Claude Code. I kept it local-first and intentionally avoided building a hosted Notion backend.

I would love feedback on:

- whether the Codex/Claude setup flow is clear enough
- what write-back modes feel safe
- which Notion-to-code workflows you would actually use

Thanks for taking a look.

## Gallery Plan

Create at least two images before launch.

Recommended `1270 x 760` gallery images:

1. Hero: Notion page with notion2CLI Activity panel and a concise headline.
2. Flow: Notion page -> localhost bridge -> Codex/Claude -> Notion reply.
3. Codex mode: stable Codex App session receiving a Notion task.
4. Claude mode: Claude Code terminal channel receiving a Notion task.
5. Prompt profiles: Raw, Build, and custom tasks.
6. Privacy/local-first: no hosted backend, localhost bridge, MCP.

Recommended `240 x 240` thumbnail:

- Use the notion2CLI app icon.
- Avoid small text.
- Keep high contrast.

## Launch Day Posts

### Short X/Threads Post

Launching notion2CLI today.

It turns a Notion page into the input surface for local Codex CLI or Claude Code sessions.

Select text, run the whole page, pass images as local artifacts, and optionally write back through Notion MCP.

Local-first: Chrome extension + localhost bridge.

### Longer X/Threads Post

Most of my implementation notes start in Notion, but the actual execution happens in Codex CLI or Claude Code.

So I built notion2CLI:

- select text in Notion -> run it in a local AI coding CLI
- no selection -> run the whole page through Notion MCP
- page images become local artifacts
- result comes back to the browser panel
- write-back is optional and goes through Notion MCP

The core design constraint: no hosted notion2CLI backend. It is a Chrome extension plus a local bridge at `127.0.0.1`.

It is an early MVP, but the Codex and Claude Code flows are working.

Feedback welcome.

## Outreach Message

Hey, I just launched notion2CLI.

It is a local-first bridge that lets you run selected text or full Notion pages in Codex CLI or Claude Code. I built it for people who write specs and tasks in Notion but execute in local AI coding tools.

Would appreciate your feedback, especially on whether the setup and write-back model feel clear.

## Do Not Say

- Do not claim it replaces Notion AI.
- Do not claim it keeps data fully offline. Codex CLI, Claude Code, and Notion MCP may use external services according to their own configuration.
- Do not imply the bridge writes to Notion deterministically by itself. Write-back goes through the selected runtime and Notion MCP.
- Do not claim broad OS support yet. macOS is the primary tested target.
