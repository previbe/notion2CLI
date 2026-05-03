# notion2CLI

[Chrome Web Store](https://chromewebstore.google.com/detail/notion2cli/poadenkneikinepacildoepjamefghio) | [Architecture](docs/ARCHITECTURE.md) | [Security](SECURITY.md) | [Privacy](PRIVACY.md) | [Contributing](CONTRIBUTING.md) | [Chinese README](docs/README.zh-CN.md)

Run Claude Code or Codex directly from Notion.

notion2CLI turns the work you already keep in Notion into executable tasks for your local AI agent. Select a paragraph from a spec, bug report, meeting note, launch plan, or run the whole page, then send it to Claude Code or Codex without copying context into a terminal.

The result comes back to the browser Activity panel, and when you choose write-back the agent can update the Notion page through your configured Notion MCP setup.

Use it when your thinking lives in Notion but execution happens in local coding agents:

- turn a product brief into an implementation plan
- send a selected bug report to Codex or Claude Code
- ask an agent to review a Notion spec with the full page as context
- return the answer to the Notion-side panel instead of losing it in a terminal
- optionally append or write results back to the current Notion page

## How It Works

```text
Notion page
  -> Chrome extension
  -> http://127.0.0.1:43821 local bridge
  -> Codex CLI or Claude Code runtime
  -> browser Activity panel
  -> optional Notion write-back through Notion MCP
```

notion2CLI is local-first. The Chrome extension talks to a localhost bridge, and the bridge hands work to your selected local runtime. For full-page runs and write-back, the runtime uses your Notion MCP configuration.

## Support Matrix

| Area | Current support |
| --- | --- |
| Node.js | `>=22.15.0` |
| Package manager | `npm` with `package-lock.json` |
| Browser | Google Chrome with the [Chrome Web Store extension](https://chromewebstore.google.com/detail/notion2cli/poadenkneikinepacildoepjamefghio) |
| Operating systems | macOS is the primary tested target. Linux and Windows are not formally supported yet. |
| Codex | Codex CLI installed locally. `notion2cli codex open` is macOS-only. |
| Claude | Claude Code installed locally. Claude Desktop is not an input target. |
| Notion | A logged-in Notion browser session plus Notion MCP configured for the selected runtime. |

## Install

Install the CLI:

```bash
npm install -g notion2cli
```

Install the Chrome extension from the Chrome Web Store:

```text
https://chromewebstore.google.com/detail/notion2cli/poadenkneikinepacildoepjamefghio
```

For local development, you can still load the extension from source:

```bash
git clone https://github.com/previbe/notion2CLI.git
cd notion2CLI
npm install
```

Then load the development extension:

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

You can choose the startup permission mode from the Chrome popup before copying the command, or pass it explicitly:

```bash
notion2cli daemon start --runtime codex --permission-mode auto-review
notion2cli daemon start --runtime codex --permission-mode full-access
```

Create a browser pairing code:

```bash
notion2cli pair
```

Then open the `notion2CLI` Chrome popup, paste the 6-digit code, and connect. On any Notion page, use the Activity panel to run `Raw`, `PreVibe`, `Build`, or a custom prompt profile.

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

Claude Code supports the same notion2cli permission modes at launch:

```bash
notion2cli claude launch --permission-mode auto-review
notion2cli claude launch --permission-mode full-access
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

The Activity panel exposes `Raw`, `PreVibe`, `Build`, and custom prompt profiles.

- `Raw` forwards the Notion material as the task.
- `PreVibe` distills Notion material into a development-ready brief.
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
- Startup permission modes are `default`, `auto-review`, and `full-access`. `default` is recommended. `full-access` disables sandbox and approval prompts for the selected CLI runtime; use it only in trusted workspaces or external sandboxes.
- Permission mode changes require restarting the CLI or daemon. Notion OAuth authorization is separate and may still require browser approval.
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

## Release Notes And Packaging

Public release and store materials live in:

- `docs/RELEASE_NOTES.md`
- `chrome-store/`

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
