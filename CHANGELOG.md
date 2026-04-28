# Changelog

All notable changes to this project are documented here.

This project follows the spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning once releases are tagged.

## Unreleased

### Added

- English-first README with setup, runtime flows, security model, support matrix, and AI-agent guidance.
- Security policy and vulnerability reporting guidance.
- GitHub Actions CI for syntax checks, tests, audit, and package dry-run.
- Changelog.
- Privacy policy.
- Chrome Web Store listing, privacy disclosure, reviewer notes, and asset checklist.
- npm, GitHub Release, Product Hunt, and social launch materials.
- Chinese release guide for npm, GitHub Release, Chrome Web Store, Product Hunt, and manual launch tasks.
- Chrome Web Store extension packaging script.
- Extension icons and manifest icon metadata.
- npm package file list now includes privacy, Chrome Web Store, and launch marketing materials referenced by the README.

### Changed

- Chrome extension localhost permission is narrowed to the default bridge origin.
- Contribution guide is now English-first for public open-source contributors.
- README now links release materials and privacy documentation.

## 0.1.0 - 2026-04-28

### Added

- Initial MVP for sending Notion selections and full pages to local Codex or Claude Code sessions.
- Runtime-backed Notion MCP page bundle preparation.
- Local image artifact handling for Notion page images.
- Browser pairing flow with a local bearer token.
- Prompt profiles, including built-in `Raw` and `Build` flows.
- Optional Notion write-back through the selected runtime.
- MIT License and public contribution policy.
