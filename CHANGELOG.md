# Changelog

All notable changes to this project are documented here.

This project follows the spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning once releases are tagged.

## Unreleased

### Added

- English-first README with setup, runtime flows, security model, support matrix, and AI-agent guidance.
- Security policy and vulnerability reporting guidance.
- GitHub Actions CI for syntax checks, tests, audit, and package dry-run.
- Changelog.

### Changed

- Chrome extension localhost permission is narrowed to the default bridge origin.
- Contribution guide is now English-first for public open-source contributors.

## 0.1.0 - 2026-04-28

### Added

- Initial MVP for sending Notion selections and full pages to local Codex or Claude Code sessions.
- Runtime-backed Notion MCP page bundle preparation.
- Local image artifact handling for Notion page images.
- Browser pairing flow with a local bearer token.
- Prompt profiles, including built-in `Raw` and `Build` flows.
- Optional Notion write-back through the selected runtime.
- MIT License and public contribution policy.
