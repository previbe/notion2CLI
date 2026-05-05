# Security Policy

notion2CLI is local-first, but it handles private Notion content and forwards that content to local AI runtimes. Treat it as a tool that can move sensitive material between local processes.

## Supported Versions

| Version | Supported |
| --- | --- |
| `0.1.x` | Security fixes are accepted while the MVP is active. |

## Reporting a Vulnerability

Please do not publish exploit details, private Notion content, bearer tokens, logs, or reproduction data in a public issue.

Preferred reporting path:

1. Use GitHub Security Advisories for this repository if available.
2. If private advisories are not available, open a minimal public issue asking for a secure contact path. Do not include sensitive details in that issue.

Include the affected version or commit, runtime path (`codex`, `claude`, or `standalone`), operating system, and a concise impact summary.

## Local Bridge Threat Model

The bridge listens on `127.0.0.1` and defaults to port `43821`. It is intended for same-machine use only.

Authentication and pairing:

- Browser pairing uses a 6-digit code.
- Pairing codes expire after 5 minutes.
- A successful pairing creates a random bearer token.
- The token is stored in Chrome local extension storage.
- Pairing state is stored in the bridge process and is reset when the bridge restarts.
- Authenticated browser requests use the bearer token.

Browser access:

- The Chrome extension is limited to Notion pages and the default local bridge origin.
- The bridge accepts Chrome extension origins and local CLI requests without an `Origin` header.
- Non-extension browser origins are rejected unless explicitly configured through `NOTION2CLI_ALLOWED_ORIGINS`.

Notion access:

- The bridge does not store Notion OAuth credentials.
- Full-page reads and write-backs go through the selected runtime's Notion MCP configuration.
- If Codex CLI or Claude Code sends data to external services, that behavior is governed by those tools and their configuration.

CLI permissions:

- The default startup permission mode is recommended.
- `auto-review` reduces manual prompts, but it does not make Notion page content trusted.
- `full-access` disables sandbox and approval prompts for the selected CLI runtime. Use it only in trusted workspaces or external sandboxes.
- Permission mode changes require restarting the CLI or daemon.
- Notion OAuth authorization is separate from CLI permissions and may still require browser approval.

Artifacts:

- Supported page images may be downloaded into `~/.notion2cli/state/artifacts/`.
- Image count and size are capped.
- Private-network image URLs are blocked by default.
- Artifact cache directories are pruned after roughly 24 hours.

## Handling Sensitive Data

Avoid running full-page jobs on pages that contain credentials, private customer data, or regulated information unless you understand how your selected runtime handles that data.

Before sharing logs or bug reports, remove:

- Notion page URLs and page IDs
- page content
- bearer tokens
- local file paths that reveal private workspace names
- `~/.notion2cli/` state
- Codex or Claude runtime logs containing prompts or responses
