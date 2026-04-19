import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMcpPageBundle,
  parseRuntimePageBundleEnvelope,
} from '../server/core/mcp-page-bundle.mjs';

test('parseRuntimePageBundleEnvelope extracts metadata and markdown payload', () => {
  const parsed = parseRuntimePageBundleEnvelope(`
<<<N2C_PAGE_BUNDLE_JSON
{"ok":true,"pageUrl":"https://www.notion.so/example","pageTitle":"Example","truncated":false,"warnings":["warn-1"]}
N2C_PAGE_BUNDLE_JSON
<<<N2C_PAGE_MARKDOWN
# Example

hello
N2C_PAGE_MARKDOWN
  `);

  assert.deepEqual(parsed, {
    ok: true,
    pageUrl: 'https://www.notion.so/example',
    pageTitle: 'Example',
    warnings: ['warn-1'],
    truncated: false,
    markdown: '# Example\n\nhello',
  });
});

test('createMcpPageBundle classifies markdown image and file assets', () => {
  const bundle = createMcpPageBundle({
    pageUrl: 'https://www.notion.so/example',
    pageTitle: 'Example',
    provider: 'runtime-backed-notion-mcp',
    runtimeId: 'fake',
    markdown: [
      '# Example',
      '',
      'Look at this image:',
      '![diagram](https://example.com/assets/diagram.png)',
      '',
      'Reference PDF:',
      '[brief](https://example.com/files/brief.pdf)',
    ].join('\n'),
  });

  assert.equal(bundle.assets.images.length, 1);
  assert.equal(bundle.assets.images[0].sourceUrl, 'https://example.com/assets/diagram.png');
  assert.equal(bundle.assets.pdfs.length, 1);
  assert.equal(bundle.stats.imageBlockCount, 1);
  assert.equal(bundle.stats.pdfBlockCount, 1);
  assert.equal(bundle.stats.textBlockCount, 1);
  assert.equal(bundle.blocks[0].type, 'text');
});
