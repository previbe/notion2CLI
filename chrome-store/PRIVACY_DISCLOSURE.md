# Chrome Web Store Privacy Disclosure Draft

Use this file to fill the Chrome Web Store Developer Dashboard Privacy tab.

## Single Purpose

Send user-triggered Notion page content to a local Codex CLI or Claude Code session through a localhost bridge, then show the result in the browser Activity panel.

## Data Collection

Select the categories that match Chrome Web Store's current privacy form labels.

notion2CLI handles:

- Website content: Notion selected text and full-page markdown when the user explicitly runs a task.
- User activity: user-triggered extension actions such as pairing, run selected text, run current page, cancel, and write-back mode selection.
- Authentication information: a local random bearer token used only for browser-to-local-bridge pairing.

notion2CLI does not collect:

- Personally identifiable information for a notion2CLI cloud service.
- Financial and payment information.
- Health information.
- Location.
- Web browsing history outside Notion pages.
- Keystroke logging.

## Data Use

Data is used only to provide the extension's single purpose:

- prepare the local runtime request,
- display job state and assistant replies,
- optionally request Notion write-back through the selected runtime,
- remember local extension settings.

## Data Transfer

The extension sends user-triggered task data to:

```text
http://127.0.0.1:43821
```

This is the local notion2CLI bridge running on the user's machine.

The local bridge sends task material to the user's selected local runtime, currently Codex CLI or Claude Code. Those tools may use their own external services according to the user's configuration and terms.

notion2CLI itself does not operate a backend service for this data.

## Data Sale

Answer: No.

notion2CLI does not sell user data.

## Data Use for Unrelated Purposes

Answer: No.

notion2CLI does not use or transfer data for purposes unrelated to the single purpose.

## Human Review

Answer: No for notion2CLI-owned services.

The notion2CLI project does not receive the user's Notion content for human review. Data may still be handled by the user's configured runtime provider under that provider's terms.

## Privacy Policy URL

Use a public URL for `PRIVACY.md`.

Recommended:

```text
https://previbe.github.io/notion2CLI/privacy/
```

If that URL is not live yet, publish `PRIVACY.md` through GitHub Pages, a website, or a public Notion page before submitting.

## Permission Justifications

### `storage`

Stores local settings and the bridge pairing token.

### `https://www.notion.so/*`, `https://notion.so/*`

Displays the Activity panel on Notion pages and reads the current page URL, title, and current selection only on Notion.

### `http://127.0.0.1:43821/*`

Connects to the local bridge. Required because notion2CLI is local-first and does not use a cloud relay.

## Remote Code

Answer: No.

The extension does not load executable code from remote URLs.
