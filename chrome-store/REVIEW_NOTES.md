# Chrome Web Store Review Notes

These notes are for Chrome Web Store reviewers.

## What notion2CLI Does

notion2CLI lets a user send selected text or a full page from Notion or Feishu/Lark documents to a local Codex CLI or Claude Code session.

The Chrome extension is only one part of the system. It requires a local CLI bridge running on the user's machine.

## No Cloud Backend

The extension communicates with:

```text
http://127.0.0.1:43821
```

This is a local bridge started by the user. notion2CLI does not operate a cloud relay for page content.

## Fast Smoke Test Without Codex or Claude

This standalone path verifies the extension, pairing, panel UI, and local bridge without requiring Codex CLI, Claude Code, Notion MCP, or Feishu/Lark authorization.

1. Install Node.js 22.15+.
2. Install the CLI:

   ```bash
   npm install -g notion2cli
   ```

   Or from source:

   ```bash
   git clone https://github.com/previbe/notion2CLI.git
   cd notion2CLI
   npm install
   npm install -g .
   ```

3. Start the local bridge:

   ```bash
   notion2cli daemon start --runtime standalone --foreground
   ```

4. Load the extension in Chrome.
5. Run:

   ```bash
   notion2cli pair
   ```

6. Open the extension popup and enter the 6-digit pairing code.
7. Open a Notion or supported Feishu/Lark document page.
8. Select any text and run `Raw` from the Activity panel.
9. Expected result: the Activity panel shows a simulated response. Standalone mode does not call document providers and does not modify the page.

## Full Test With Codex

This path verifies the real Codex runtime flow.

1. Install Codex CLI.
2. Configure Notion MCP:

   ```bash
   notion2cli mcp install notion --runtime codex
   ```

3. Start the bridge:

   ```bash
   notion2cli daemon start --runtime codex
   notion2cli pair
   ```

4. Pair the extension.
5. Open a Notion page.
6. Select text and run `Raw`.
7. Run the page without a selection to test full-page MCP reading.

## Full Test With Feishu/Lark

This path verifies the official local `lark-cli` provider flow.

1. Start the bridge with Codex or Claude.
2. Pair the extension.
3. Open a supported Feishu/Lark `/docx/` or `/wiki/` page.
4. Open the extension popup and choose `Connect Feishu/Lark`.
5. Complete the browser authorization link. If the popup asks again, choose `Connect Feishu/Lark` a second time to authorize document scopes.
6. Return to the document page and run selected text.
7. Run the page without a selection to test full-page reading through `lark-cli`.

## Full Test With Claude Code

This path verifies the Claude Code channel flow.

1. Install Claude Code.
2. Start the channel bridge:

   ```bash
   notion2cli claude launch
   ```

3. In another terminal:

   ```bash
   notion2cli pair
   ```

4. Pair the extension.
5. Open a Notion page.
6. Select text and run `Raw`.
7. Expected result: the Claude Code terminal receives the task and the Activity panel receives the reply.

## Why Permissions Are Needed

- `storage`: local settings and pairing token.
- `https://www.notion.so/*`, `https://notion.so/*`: Activity panel on Notion pages and current page metadata/selection.
- `https://*.feishu.cn/*`, `https://*.larksuite.com/*`, `https://*.larkoffice.com/*`: Activity panel on supported Feishu/Lark document pages and current page metadata/selection.
- `http://127.0.0.1:43821/*`: local bridge communication.

## Data Notes

The extension sends data only to the local bridge. The local bridge forwards task material to the user's configured local runtime. The runtime may use external services according to the user's runtime configuration and provider terms.

## Remote Code

The extension does not load remote executable code.
