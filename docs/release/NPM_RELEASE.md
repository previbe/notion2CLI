# npm Release Notes

## Package

```text
notion2cli
```

## Install

```bash
npm install -g notion2cli
```

## Preflight

```bash
npm run release:check
```

## Publish

Manual account step may be required for npm login and 2FA.

```bash
npm login
npm publish --access public
```

## Verify

```bash
npm view notion2cli version
npm install -g notion2cli
notion2cli --version
notion2cli --help
```

## Package Summary

notion2CLI is a local-first bridge that lets developers use Notion pages as the rich-text input surface for local Codex CLI or Claude Code sessions.

## Package Keywords

- notion
- cli
- codex
- claude
- chrome-extension
- mcp
- local-first

## npm README Summary

The npm README is `README.md`.

Important points to keep visible:

- Node.js `>=22.15.0`
- Chrome extension must be loaded or installed separately.
- Codex CLI or Claude Code is required for real runtime flows.
- Full-page reads and write-backs require Notion MCP.
- notion2CLI itself does not operate a hosted backend.
