# Privacy Policy for notion2CLI

Last updated: 2026-04-28

notion2CLI is a local-first Chrome extension and command-line bridge for sending user-selected Notion page content to a local Codex CLI or Claude Code session.

This policy describes the notion2CLI project itself. Codex CLI, Claude Code, Notion, Google Chrome, and any Model Context Protocol servers you configure are separate products with their own privacy practices.

## Data notion2CLI Handles

notion2CLI may handle the following data when you explicitly use the extension:

- Notion page URL and page title.
- Selected Notion text, when you run a selected-text action.
- Current Notion page markdown, when you run a full-page action.
- Image URLs found in the Notion page markdown, and temporary local image artifacts downloaded from those URLs.
- The latest assistant response returned to the browser panel.
- Local settings such as pairing token, prompt profile preference, panel position, write-back mode, and whether manual write-back is visible.

## Local Storage

The Chrome extension stores local settings in Chrome extension storage on your machine.

The local bridge stores runtime state, prompt profiles, logs, and temporary artifacts under:

```text
~/.notion2cli/
```

Image artifacts are pruned automatically after roughly 24 hours.

## Network Transfers

notion2CLI does not operate a cloud service and does not send your Notion content to a notion2CLI-owned server.

The extension communicates with a local bridge at:

```text
http://127.0.0.1:43821
```

When you run a task, the local bridge sends the task material to the local runtime you selected, currently Codex CLI or Claude Code. Those tools may send prompts, page content, images, outputs, telemetry, or logs to their own services depending on their configuration, account, model provider, and terms.

Full-page reads and write-backs use the Notion MCP server configured in your selected runtime. notion2CLI does not store Notion OAuth credentials.

## Chrome Extension Permissions

notion2CLI requests these permissions:

- `storage`: saves local extension settings and the local pairing token.
- `https://www.notion.so/*` and `https://notion.so/*`: shows the Activity panel on Notion pages and reads the page URL, title, and current text selection.
- `http://127.0.0.1:43821/*`: communicates with the local notion2CLI bridge.

## Data Sharing

notion2CLI does not sell personal data.

notion2CLI does not share personal data with third parties on behalf of the project. Data may still be processed by the local runtime and services you configure, such as Codex CLI, Claude Code, Notion MCP, or model providers used by those tools.

## User Control

You can stop using notion2CLI by:

1. Removing or disabling the Chrome extension.
2. Stopping the local bridge with `notion2cli daemon stop`, or closing the `notion2cli claude launch` terminal session.
3. Removing local state from `~/.notion2cli/` if you want to clear cached prompts, logs, and artifacts.

## Security

The local bridge binds to `127.0.0.1` by default and uses a short-lived pairing code plus a random bearer token for browser requests. Remote image downloads are capped, and private-network image URLs are blocked by default.

See [SECURITY.md](SECURITY.md) for the full local bridge threat model.

## Contact

For privacy or security questions, open a GitHub issue at:

https://github.com/previbe/notion2CLI/issues
