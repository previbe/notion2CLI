# Changelog

All notable changes to this project are documented here.

This project follows the spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning once releases are tagged.

## Unreleased

## 0.2.0 - 2026-05-16

### Added

- Added Feishu/Lark document provider support for `/docx/` and `/wiki/` pages.
- Added Feishu/Lark full-page reads through the bundled official `lark-cli`.
- Added Feishu/Lark write-back through explicit official Wiki and Docx OpenAPI calls.
- Added Feishu/Lark image artifact resolution for supported document media.
- Added Chrome extension support for Feishu/Lark document pages and popup authorization.
- Added provider-aware Activity panel copy, capabilities, and write-back labels.

### Changed

- Refactored document handling into a provider architecture for Notion and Feishu/Lark.
- Updated Chrome Web Store metadata for the local CLI bridge and pairing flow.
- Updated npm and Chrome extension versions to `0.2.0`.

### Fixed

- Prevented slow Claude MCP status probes from blocking bridge status responses.
- Added bridge request timeouts so the extension cannot stay indefinitely stuck in a pending write-back state.
- Preserved selected text when clicking active task and manual write-back controls.

## 0.1.2 - 2026-05-05

### Changed

- Bumped the npm package, Chrome extension, Claude plugin, and runtime bridge metadata versions to `0.1.2`.

## 0.1.1 - 2026-04-28

### Fixed

- npm package now publishes the English `README.md` as the registry README.
- Moved the Chinese README to `docs/README.zh-CN.md` so it remains available without competing with the npm README detector.

### Changed

- Bumped the Chrome extension manifest version to `0.1.1` to stay aligned with the npm package version.

## 0.1.0 - 2026-04-28

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
- Initial MVP for sending Notion selections and full pages to local Codex or Claude Code sessions.
- Runtime-backed Notion MCP page bundle preparation.
- Local image artifact handling for Notion page images.
- Browser pairing flow with a local bearer token.
- Prompt profiles, including built-in `Raw`, `PreVibe`, and `Build` flows.
- Optional Notion write-back through the selected runtime.
- MIT License and public contribution policy.

### Changed

- Chrome extension localhost permission is narrowed to the default bridge origin.
- Contribution guide is now English-first for public open-source contributors.
- README now links release materials and privacy documentation.
