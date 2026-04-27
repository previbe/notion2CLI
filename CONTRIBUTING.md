# Contributing to notion2CLI

Thank you for helping improve notion2CLI. Issues, documentation improvements, bug fixes, tests, and focused feature pull requests are welcome.

## Contribution License

Unless you explicitly state otherwise when submitting a contribution, your contribution is licensed under the project's MIT License.

Only submit material you have the right to license. Do not submit private Notion page content, access tokens, API keys, local configuration files, sensitive logs, or third-party assets with incompatible licenses.

## Development Setup

```bash
npm install
npm run check
npm test
```

For release or packaging changes, also run:

```bash
npm audit --audit-level=moderate
npm pack --dry-run
```

## Pull Request Guidelines

Keep each PR focused on one clear change. Include tests or documentation updates when behavior changes.

PR descriptions should include:

- the purpose of the change
- the main implementation details
- verification commands you ran
- known limitations or follow-up work

If a PR changes Notion access, Codex CLI integration, Claude Code integration, Chrome extension permissions, localhost bridge behavior, pairing, authentication, artifact handling, or write-back behavior, call that out explicitly.

## Local Files

Do not commit generated output, local bridge state, credentials, screenshots, or machine-specific paths. In particular, keep these out of commits:

- `.env*`
- `.tmp/`
- `output/`
- `*.tgz`
- `~/.notion2cli/`
- `.claude/settings.local.json`
