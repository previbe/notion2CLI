# notion2CLI

[Architecture](docs/ARCHITECTURE.md) | [Security](SECURITY.md) | [Privacy](PRIVACY.md) | [Contributing](CONTRIBUTING.md) | [Chinese README](README.zh-CN.md)

Use a Notion page as the rich-text input surface for a local Codex or Claude Code session.

notion2CLI is a local-first bridge between three things you already run on your machine:

- a Notion page in Chrome
- a tiny localhost bridge
- a local AI coding/runtime session, currently Codex CLI or Claude Code

Select text in Notion, or run the whole page, and notion2CLI sends that content as the next user request to the active local runtime. The answer returns to the browser panel. If the task should update the Notion page, the runtime can write back through Notion MCP.

## Project Status

This is an early MVP. The core contract is intentionally narrow:

- Forward selected Notion text as the next runtime input.
- Forward the current Notion page as the next runtime input.
- Resolve full-page content through the runtime's Notion MCP server.
- Cache Notion page images as local artifacts for the runtime.
- Return the latest assistant result to the browser panel.
- Let the runtime write back to Notion only when the selected task genuinely requires it.
- Reuse a stable visible Codex App session for Codex.
- Deliver Claude jobs into the active `notion2cli claude launch` terminal session.

Not in scope for the current MVP:

- Direct Notion API access from the bridge.
- Deterministic Notion writes performed by the bridge itself.
- Complete generic file attachment support.
- Claude Desktop input injection.
- Chrome Native Messaging.
- Full two-way history sync between the extension, bridge, Codex App, and Claude terminal.

## How It Works

```text
Notion page
  -> Chrome extension
  -> http://127.0.0.1:43821 local bridge
  -> Codex CLI or Claude Code runtime
  -> browser Activity panel
  -> optional Notion write-back through Notion MCP
```

The browser extension does not scrape the full Notion DOM. For full-page runs, the bridge asks the selected runtime to read the page through Notion MCP, normalizes the result, downloads supported image artifacts, and then sends a structured prompt plus local image paths to the runtime.

## Support Matrix

| Area | Current support |
| --- | --- |
| Node.js | `>=22.15.0` |
| Package manager | `npm` with `package-lock.json` |
| Browser | Google Chrome with a manually loaded Manifest V3 extension |
| Operating systems | macOS is the primary tested target. Linux and Windows are not formally supported yet. |
| Codex | Codex CLI installed locally. `notion2cli codex open` is macOS-only. |
| Claude | Claude Code installed locally. Claude Desktop is not an input target. |
| Notion | A logged-in Notion browser session plus Notion MCP configured for the selected runtime. |

## Install From Source

The npm package metadata is ready, but until the first package is published, install from the repository:

```bash
git clone https://github.com/previbe/notion2CLI.git
cd notion2CLI
npm install
npm install -g .
```

Load the Chrome extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this repository's `extension` directory.

The extension talks to `http://127.0.0.1:43821`. If you run the bridge on a custom port, you must also adjust the extension build.

## Quick Start: Codex

Install and authorize Notion MCP for Codex:

```bash
notion2cli mcp install notion --runtime codex
```

Start the bridge:

```bash
notion2cli daemon start --runtime codex
```

Create a browser pairing code:

```bash
notion2cli pair
```

Then open the `notion2CLI` Chrome popup, paste the 6-digit code, and connect. On any Notion page, use the Activity panel to run `Raw`, `Build`, or a custom prompt profile.

Useful Codex commands:

```bash
notion2cli daemon status
notion2cli codex inspect
notion2cli codex open
notion2cli daemon stop
```

## Quick Start: Claude Code

Claude Code uses a foreground channel session instead of the background daemon:

```bash
notion2cli claude launch
```

Keep that terminal open. In another terminal, create a browser pairing code:

```bash
notion2cli pair
```

If Notion MCP authorization is required during a full-page run, the Activity panel will show the browser authorization link. Write-back authorization may still appear inside the Claude Code terminal.

Useful Claude commands:

```bash
notion2cli claude inspect
notion2cli claude config-path
```

## Browser Actions

### Run selected text

When text is selected in Notion, the extension sends:

- `selectionText`
- `pageUrl`
- `pageTitle`

The bridge creates a job and forwards the selected text as the next user input to the active runtime.

### Run the current page

When no text is selected, the bridge:

1. asks the runtime's Notion MCP server to read the page,
2. normalizes the response into a `McpPageBundle`,
3. extracts supported image assets,
4. downloads local image artifacts,
5. sends page markdown, page metadata, warnings, and image artifact paths to the runtime.

If page-bundle preparation fails, the job fails. The bridge does not fall back to browser DOM scraping.

### Prompt profiles

The Activity panel exposes `Raw`, `Build`, and custom prompt profiles.

- `Raw` forwards the Notion material as the task.
- `Build` treats the Notion material as a software task brief for the current runtime.
- Custom profiles are stored locally in `~/.notion2cli/prompts.json`.

Prompt profiles define task intent. Notion page content remains task material and must not override bridge instructions, runtime safety rules, or the selected profile.

### Write back to Notion

Agents may update the current Notion page through Notion MCP when the selected task genuinely requires it. Manual write-back can also be enabled in the extension settings.

Manual write-back modes:

- append to the page
- replace the currently selected text
- replace the page body

Append mode is the default recommendation because it is non-destructive.

## Local State

Runtime state, logs, prompt profiles, and cached artifacts live under:

```text
~/.notion2cli/
```

Common paths:

- `~/.notion2cli/state/daemon.json`
- `~/.notion2cli/state/artifacts/`
- `~/.notion2cli/prompts.json`
- `~/.notion2cli/claude-channel.mcp.json`
- `~/.notion2cli/claude-worker.mcp.json`
- `~/.notion2cli/logs/daemon.log`
- `~/.notion2cli/logs/daemon.err.log`

## Security Model

notion2CLI is local-first, but it still moves private page content between local components. Read [SECURITY.md](SECURITY.md) before running it on sensitive workspaces.

Important details:

- The bridge binds to `127.0.0.1` and defaults to port `43821`.
- The Chrome extension only requests Notion page access and the default local bridge origin.
- Browser pairing uses a 6-digit code that expires after 5 minutes.
- A successful pairing creates a random bearer token stored in Chrome local extension storage.
- Pairing state is held by the local bridge process and is reset when the bridge restarts.
- Full-page reads and write-backs are performed by the selected runtime through Notion MCP.
- Notion content is sent to your local Codex or Claude Code runtime. Those tools may use their own network services according to their own configuration and terms.
- Remote image downloads are capped and private-network image URLs are blocked by default.

## Development

```bash
npm install
npm run check
npm test
```

For release-sensitive changes, also run:

```bash
npm audit --audit-level=moderate
npm pack --dry-run
npm publish --dry-run --access public
npm run package:extension
```

Manual end-to-end smoke test:

1. Prepare a Notion page containing a short instruction and one image.
2. Start either `notion2cli daemon start --runtime codex` or `notion2cli claude launch`.
3. Pair the browser extension.
4. Run the current page.
5. Confirm the selected runtime starts working immediately.
6. Confirm the final result appears in the Activity panel.
7. If manual write-back is enabled, append the result to the Notion page and verify the target page changed as expected.

## Release Materials

Public launch materials live in:

- `docs/release/RELEASE_CHECKLIST.md`
- `docs/release/RELEASE_GUIDE.zh-CN.md`
- `docs/release/GITHUB_RELEASE_NOTES.md`
- `docs/release/NPM_RELEASE.md`
- `chrome-store/`
- `marketing/`

Build the Chrome Web Store zip with:

```bash
npm run package:extension
```

## For AI Agents Working In This Repository

If you are an AI coding agent handling this project, treat these as the working constraints:

- Start with `README.md`, `docs/ARCHITECTURE.md`, and `package.json`.
- Keep the MVP contract narrow: Notion page or selection in, local runtime job out, optional Notion MCP write-back.
- Do not introduce direct Notion API calls unless the task explicitly changes the architecture.
- Do not commit local files, generated artifacts, screenshots, `.env*`, `.tmp/`, `output/`, or `~/.notion2cli` state.
- Keep Chrome permissions narrow. The default bridge origin is `http://127.0.0.1:43821`.
- Run `npm run check` and `npm test` before handing off code changes.
- For packaging or release work, run `npm pack --dry-run` and inspect the tarball file list.

Useful file map:

- CLI entrypoint: `bin/notion2cli.mjs`
- CLI helpers: `cli/`
- bridge server: `server/bridge-server.mjs`
- core job and HTTP logic: `server/core/`
- runtime adapters: `server/runtimes/`
- Chrome extension: `extension/`
- architecture notes: `docs/ARCHITECTURE.md`
- tests: `test/`

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

Unless stated otherwise, contributions to this project are submitted under the project's MIT License.

## License

MIT. See [LICENSE](LICENSE).

## Trademark Notice

notion2CLI is not an official Notion, OpenAI, Anthropic, Claude, Codex, or Google Chrome project. Product names and trademarks belong to their respective owners.
