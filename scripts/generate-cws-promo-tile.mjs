import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'assets', 'release', 'chrome-web-store');
const outputFile = path.join(outputDir, 'small-promo-tile-440x280.png');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});

try {
  const page = await browser.newPage({
    viewport: { width: 440, height: 280 },
    deviceScaleFactor: 2,
  });

  await page.setContent(renderTile(), { waitUntil: 'load' });
  await page.screenshot({
    path: outputFile,
    fullPage: false,
    omitBackground: false,
    scale: 'css',
  });
} finally {
  await browser.close();
}

console.log(`Generated Chrome Web Store small promo tile: ${outputFile}`);

function renderTile() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>notion2CLI small promo tile</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #20241f;
      --muted: rgba(32, 36, 31, 0.66);
      --green: #5c7a4a;
      --blue: #3867d6;
      --paper: #fffcf7;
      --line: rgba(51, 60, 45, 0.14);
      font-family: Inter, Avenir Next, Segoe UI, Helvetica, Arial, sans-serif;
    }

    * { box-sizing: border-box; }

    html,
    body {
      width: 440px;
      height: 280px;
      margin: 0;
      overflow: hidden;
      background: #f7f1e8;
      color: var(--ink);
    }

    body {
      background:
        linear-gradient(135deg, rgba(92, 122, 74, 0.14), transparent 46%),
        linear-gradient(315deg, rgba(56, 103, 214, 0.12), transparent 42%),
        #f7f1e8;
    }

    .tile {
      position: relative;
      width: 440px;
      height: 280px;
      padding: 22px 24px;
      overflow: hidden;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px 8px 9px;
      border: 1px solid rgba(92, 122, 74, 0.18);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.76);
      color: #3f5636;
      font-size: 13px;
      font-weight: 850;
      box-shadow: 0 8px 24px rgba(51, 60, 45, 0.08);
    }

    .mark {
      width: 20px;
      height: 20px;
      display: grid;
      place-items: center;
      border-radius: 7px;
      background: var(--ink);
      color: #f8f2ea;
      font-size: 10px;
      font-weight: 900;
    }

    h1 {
      width: 184px;
      margin: 13px 0 0;
      font-size: 36px;
      line-height: 1.02;
      letter-spacing: -0.02em;
    }

    .pills {
      display: flex;
      gap: 8px;
      margin-top: 14px;
    }

    .pill {
      padding: 9px 11px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.78);
      color: rgba(32, 36, 31, 0.74);
      font-size: 12px;
      font-weight: 800;
      border: 1px solid rgba(51, 60, 45, 0.10);
    }

    .stage {
      position: absolute;
      right: 22px;
      bottom: 22px;
      width: 214px;
      height: 132px;
    }

    .doc,
    .terminal {
      position: absolute;
      border-radius: 16px;
      box-shadow: 0 18px 44px rgba(51, 60, 45, 0.13);
      overflow: hidden;
    }

    .doc {
      left: 0;
      top: 18px;
      width: 120px;
      height: 106px;
      padding: 13px 12px;
      border: 1px solid var(--line);
      background: rgba(255, 252, 247, 0.94);
    }

    .terminal {
      right: 0;
      top: 0;
      width: 128px;
      height: 114px;
      padding: 13px 12px;
      background: #1d232a;
      color: #dbe7d9;
    }

    .label {
      margin-bottom: 10px;
      font-size: 10px;
      font-weight: 850;
      color: rgba(32, 36, 31, 0.70);
    }

    .terminal .label {
      color: rgba(219, 231, 217, 0.76);
    }

    .line {
      height: 6px;
      margin-top: 7px;
      border-radius: 999px;
      background: rgba(32, 36, 31, 0.12);
    }

    .line.short { width: 62%; }
    .line.mid { width: 78%; }
    .line.selected {
      height: 18px;
      border-radius: 8px;
      background: rgba(56, 103, 214, 0.18);
      border: 1px solid rgba(56, 103, 214, 0.20);
    }

    .terminal .line {
      background: rgba(219, 231, 217, 0.20);
    }

    .terminal .line.green {
      background: rgba(114, 170, 99, 0.72);
    }

    .connector {
      position: absolute;
      left: 91px;
      top: 58px;
      width: 34px;
      height: 22px;
      border-radius: 999px;
      background: var(--green);
      box-shadow: 0 10px 24px rgba(92, 122, 74, 0.22);
      z-index: 2;
    }

    .connector::before,
    .connector::after {
      content: "";
      position: absolute;
      top: 10px;
      width: 12px;
      height: 2px;
      background: rgba(255, 255, 255, 0.72);
    }

    .connector::before { left: 7px; transform: rotate(35deg); }
    .connector::after { right: 7px; transform: rotate(-35deg); }
  </style>
</head>
<body>
  <main class="tile" aria-label="notion2CLI Chrome Web Store small promotional tile">
    <div class="brand"><span class="mark">n2</span>notion2CLI</div>
    <h1>Notion to local AI</h1>
    <div class="pills">
      <span class="pill">Codex</span>
      <span class="pill">Claude Code</span>
    </div>
    <section class="stage" aria-hidden="true">
      <div class="doc">
        <div class="label">Notion page</div>
        <div class="line mid"></div>
        <div class="line selected"></div>
        <div class="line short"></div>
      </div>
      <div class="connector"></div>
      <div class="terminal">
        <div class="label">Local AI</div>
        <div class="line green"></div>
        <div class="line mid"></div>
        <div class="line short"></div>
        <div class="line green short"></div>
      </div>
    </section>
  </main>
</body>
</html>`;
}
