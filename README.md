# notion2CLI

[Chrome Web Store](https://chromewebstore.google.com/detail/notion2cli/poadenkneikinepacildoepjamefghio) | [Architecture](docs/ARCHITECTURE.md) | [Security](SECURITY.md) | [Privacy](PRIVACY.md) | [Contributing](CONTRIBUTING.md) | [Chinese README](docs/README.zh-CN.md)

Run Claude Code or Codex directly from Notion and Feishu/Lark Docs.

notion2CLI turns the work you already keep in Notion or Feishu/Lark Docs into executable tasks for your local AI agent. Select a paragraph from a spec, bug report, meeting note, launch plan, or run the whole page, then send it to Claude Code or Codex without copying context into a terminal.

The result comes back to the browser Activity panel, and when you choose write-back the bridge can update the source document through the configured document provider.

Use it when your thinking lives in a document workspace but execution happens in local coding agents:

- turn a product brief into an implementation plan
- send a selected bug report to Codex or Claude Code
- ask an agent to review a document spec with the full page as context
- return the answer to the browser-side panel instead of losing it in a terminal
- optionally append or write results back to the current document

## How It Works

```text
Notion or Feishu/Lark document
  -> Chrome extension
  -> http://127.0.0.1:43821 local bridge
  -> document provider
  -> Codex CLI or Claude Code runtime
  -> browser Activity panel
  -> optional provider write-back
```

notion2CLI is local-first. The Chrome extension talks to a localhost bridge, and the bridge hands work to your selected local runtime. Notion full-page reads continue to use the runtime Notion MCP setup. Feishu/Lark full-page reads, image downloads, append, replace-body, and replace-selection write-back use the official `lark-cli` from the bridge.

## Support Matrix

| Area | Current support |
| --- | --- |
| Node.js | `>=22.15.0` |
| Package manager | `npm` with `package-lock.json` |
| Browser | Google Chrome with the [Chrome Web Store extension](https://chromewebstore.google.com/detail/notion2cli/poadenkneikinepacildoepjamefghio) |
| Operating systems | macOS is the primary tested target. Native Windows is supported as a beta path for the local bridge, document providers, and CLI runtimes. WSL2 remains recommended when your project depends on Linux tooling. |
| Codex | Codex CLI installed locally. On Windows, run Codex natively in PowerShell/CMD/Git Bash, or run everything inside WSL2. `notion2cli codex open` auto-opens Codex App only on macOS; Windows users can open Codex App manually. |
| Claude | Claude Code installed locally. Native Windows requires Claude Code for Windows; Git for Windows is recommended by Claude Code for shell tool compatibility. Claude Desktop is not an input target. |
| Notion | A logged-in Notion browser session plus Notion MCP configured for the selected runtime. |
| Feishu/Lark Docs | A docx or wiki browser URL plus one-time browser authorization through the official `lark-cli`. |

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

## Windows Native Beta

Native Windows support covers the local bridge, pairing flow, Codex CLI runtime, Claude Code runtime, Notion MCP setup, Feishu/Lark provider setup through `lark-cli`, full-page reads, Activity panel replies, and optional write-back.

Install prerequisites in PowerShell, CMD, or Git Bash:

```powershell
npm install -g notion2cli
npm install -g @openai/codex
```

For Claude Code, use the official Windows installer or package manager, then verify:

```powershell
claude --version
```

Run the diagnostic before pairing:

```powershell
notion2cli doctor
```

Then start the bridge from the Windows project directory:

```powershell
cd C:\Users\you\code\your-project
notion2cli daemon start --runtime codex
notion2cli pair
```

For Claude Code:

```powershell
cd C:\Users\you\code\your-project
notion2cli claude launch
notion2cli pair
```

Notes:

- Keep using the Windows Chrome extension; it connects to `http://127.0.0.1:43821`.
- npm-installed `.cmd` shims for `codex`, `claude`, `lark-cli`, and `notion2cli` are supported.
- `notion2cli-bridge`, `notion2cli-connect`, and `notion2cli-status` are Node entrypoints and do not require Bash.
- Codex App automatic opening is not implemented for native Windows yet. Use `notion2cli codex inspect`, then open Codex App manually and look for the notion2CLI session.
- Use WSL2 instead when the repository, sandbox, or agent workflow depends on Linux-only tools.

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

Then open the `notion2CLI` Chrome popup, paste the 6-digit code, and connect. On any supported Notion or Feishu/Lark Docs page, use the Activity panel to run `Raw`, `PreVibe`, `Build`, or a custom prompt profile.

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

## Feishu/Lark Provider Setup

Feishu/Lark support is ordinary-user only. The bridge uses the official `@larksuite/cli` package bundled with notion2CLI. Do not configure app secrets or access tokens.

First connect the browser to the local bridge, then open the extension popup and choose **Connect Feishu/Lark**. The bridge starts the official local authorization flow and opens the returned browser URL. Depending on your tenant state, you may see two browser handoffs:

1. create a local Personal Agent app through `lark-cli config init --new`
2. authorize document scopes through `lark-cli auth login`

Credentials and user tokens are stored by `lark-cli` in the operating system credential store or its own local secure store. notion2CLI does not store Feishu/Lark secrets.

Supported URLs include `/docx/<document_id>` and `/wiki/<wiki_token>` pages on `feishu.cn`, `larksuite.com`, and `larkoffice.com`.

For wiki pages, notion2CLI resolves the wiki node through the official Wiki v2 `get_node` API and then reads/writes the underlying Docx document through explicit Docx v1 OpenAPI calls. The user authorization includes document read/write, media download, and `wiki:node:read` scopes.

## Browser Actions

### Run selected text

When text is selected, the extension sends:

- `selectionText`
- `selectionContext`
- `pageUrl`
- `pageTitle`
- `providerId`

The bridge creates a job and forwards the selected text as the next user input to the active runtime.

### Run the current page

When no text is selected, the bridge:

1. resolves the current document provider,
2. reads the full document through Notion MCP or the official `lark-cli`,
3. normalizes the response into a page bundle,
4. extracts supported image assets,
5. downloads local image artifacts,
6. sends page markdown, page metadata, warnings, and image artifact paths to the runtime.

If page-bundle preparation fails, the job fails. The bridge does not fall back to browser DOM scraping.

### Prompt profiles

The Activity panel exposes `Raw`, `PreVibe`, `Build`, and custom prompt profiles.

- `Raw` forwards the document material as the task.
- `PreVibe` distills document material into a development-ready brief.
- `Build` treats document material as a software task brief for the current runtime.
- Custom profiles are stored locally in `~/.notion2cli/prompts.json`.

Prompt profiles define task intent. Document content remains task material and must not override bridge instructions, runtime safety rules, or the selected profile.

### Write back

Manual write-back can be enabled in the extension settings. Notion write-back is still performed by the selected runtime through Notion MCP. Feishu/Lark write-back is performed by the bridge through the official `lark-cli`.

Manual write-back modes:

- append to the page
- replace the currently selected text
- replace the page body

Append mode is the default recommendation because it is non-destructive. Replace-selection mode fails safely when the selected text cannot be found uniquely in the fetched Feishu/Lark document markdown.

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
- The Chrome extension requests supported Notion and Feishu/Lark document page access plus the default local bridge origin.
- Browser pairing uses a 6-digit code that expires after 5 minutes.
- A successful pairing creates a random bearer token stored in Chrome local extension storage.
- Pairing state is held by the local bridge process and is reset when the bridge restarts.
- Full-page reads and write-backs are performed through the resolved document provider. Feishu/Lark provider calls use the official local `lark-cli`; notion2CLI does not read Feishu/Lark app secrets or access tokens.
- Document content is sent to your local Codex or Claude Code runtime. Those tools may use their own network services according to their own configuration and terms.
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
