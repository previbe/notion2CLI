# Release Checklist

Use this checklist for the first public release across npm, GitHub Releases, Chrome Web Store, Product Hunt, and social media.

## Release Decision

- Release version: `0.1.0`
- Release type: first public MVP
- Primary repository: `https://github.com/previbe/notion2CLI`
- npm package: `notion2cli`
- Chrome Web Store listing: pending developer account review
- Product Hunt launch: schedule only after Chrome Web Store approval

## Pre-Release Verification

Run locally from the repository root:

```bash
npm run release:check
node ./bin/notion2cli.mjs doctor
```

Expected results:

- `npm run check` passes.
- `npm test` passes.
- `npm audit --omit=dev` reports no vulnerabilities.
- `npm pack --dry-run` includes only release files.
- `npm publish --dry-run --access public` succeeds.
- `npm run package:extension` creates a Chrome Web Store zip under `dist/chrome/`.
- `doctor` confirms Codex CLI or Claude Code is installed and Notion MCP is configured for at least one runtime.

## Manual End-To-End Tests

Run these with a non-sensitive Notion test page.

### Codex Runtime

1. `notion2cli daemon stop` if an old daemon is running.
2. `notion2cli mcp install notion --runtime codex`.
3. `notion2cli daemon start --runtime codex`.
4. `notion2cli pair`.
5. Pair the Chrome extension.
6. Select text in Notion and run `Raw`.
7. Run the full page with no selection.
8. Confirm the Codex App session is visible with `notion2cli codex inspect`.
9. Enable manual write-back and append the latest reply.
10. Confirm the Notion page changed.
11. `notion2cli daemon stop`.

### Claude Code Runtime

1. `notion2cli claude launch`.
2. Keep the terminal open.
3. In another terminal, run `notion2cli pair`.
4. Pair the Chrome extension.
5. Select text in Notion and run `Raw`.
6. Run the full page with no selection.
7. Confirm the Claude terminal receives the channel message and calls the reply tool.
8. Enable manual write-back and append the latest reply.
9. Confirm the Notion page changed.

### Browser Extension

1. Open `chrome://extensions`.
2. Load the repository `extension/` folder unpacked.
3. Verify the toolbar icon appears.
4. Verify the popup can show bridge status.
5. Verify the Activity panel appears only on Notion pages.
6. Verify pair/unpair works.
7. Verify prompt profile management works.
8. Verify the stop button cancels a pending job.

## npm Release

Manual step: npm account and 2FA may be required.

```bash
npm login
npm publish --access public
```

After publishing:

```bash
npm view notion2cli version
npm install -g notion2cli
notion2cli --version
```

## GitHub Release

1. Ensure `CHANGELOG.md` is updated.
2. Tag the release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. Create a GitHub Release from tag `v0.1.0`.
4. Use `docs/release/GITHUB_RELEASE_NOTES.md` as the release body.
5. Attach:
   - npm tarball from `dist/npm/`
   - Chrome extension zip from `dist/chrome/`

## Chrome Web Store

Manual step: your Chrome Web Store developer account must be approved first.

1. Run `npm run package:extension`.
2. Upload the generated zip from `dist/chrome/`.
3. Use `chrome-store/LISTING.md` for the store listing.
4. Use `chrome-store/PRIVACY_DISCLOSURE.md` for the Privacy tab.
5. Use `chrome-store/REVIEW_NOTES.md` for reviewer instructions.
6. Link the public privacy policy URL. Recommended source: publish `PRIVACY.md` through GitHub Pages or another public webpage.
7. Select the Trader account option if releasing under a business, product, professional, or commercial context.

Do not schedule Product Hunt before the CWS item is approved and installable.

## Product Hunt

Manual step: use your personal Product Hunt account. Company accounts cannot post products.

1. Use `marketing/PRODUCT_HUNT.md`.
2. Product URL should be the public install page or GitHub repository.
3. Include the Chrome Web Store link as soon as it is available.
4. Add at least two gallery images.
5. Publish only after npm, GitHub Release, and Chrome Web Store are live.

## Social Launch

Use `marketing/SOCIAL_POSTS.md`.

Recommended order:

1. GitHub Release post.
2. npm package post.
3. Chrome Web Store approval post.
4. Product Hunt launch day post.
5. Follow-up thread with demos and lessons learned.

## Must Remain Manual

- Google developer account approval and verification.
- Chrome Web Store final upload and submit.
- npm 2FA and final publish confirmation.
- GitHub Release final publish if repository permissions require browser auth.
- Product Hunt final scheduling and launch.
- Final legal review of `PRIVACY.md`, especially if publishing under a company.
