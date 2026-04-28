import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'assets', 'release', 'chrome-web-store');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const scenes = [
  {
    file: '01-run-selected-task.png',
    title: 'Run selected text',
    subtitle: 'Highlight a real Notion brief and send just that selection to Codex or Claude Code.',
    badge: 'Selected text',
    notionTitle: 'Beta onboarding polish',
    panelMode: 'Build',
    panelStatus: 'Completed',
    panelNote: 'This Brief was added to the same Codex App session and is shown in the panel.',
    outputTitle: 'Codex reply',
    output: [
      'Plan:',
      '1. Add an empty-state card for first-time workspace owners.',
      '2. Keep the primary CTA visible after the OAuth callback.',
      '3. Add a regression test for expired invite links.',
      '',
      'Files to inspect first:',
      '- app/onboarding/page.tsx',
      '- components/invite-banner.tsx',
      '- tests/onboarding.spec.ts',
    ].join('\n'),
    selected: true,
    mode: 'notion-panel',
  },
  {
    file: '02-full-page-prd.png',
    title: 'Turn a PRD into a plan',
    subtitle: 'Run the whole page when no text is selected. notion2CLI prepares the local task context.',
    badge: 'Full page run',
    notionTitle: 'Support inbox triage v2',
    panelMode: 'Build',
    panelStatus: 'Running',
    panelNote: 'Runtime-backed page read found 4 sections and 2 image artifacts.',
    outputTitle: 'Live task context',
    output: [
      'Reading page via Notion MCP...',
      'Preparing local image artifacts...',
      'Sending structured brief to Claude Code...',
      '',
      'Current focus: classify refund requests, escalations, and bug reports without leaving the support plan.',
    ].join('\n'),
    selected: false,
    mode: 'notion-panel',
  },
  {
    file: '03-result-in-activity-panel.png',
    title: 'Review results in Notion',
    subtitle: 'Keep the assistant reply next to the source plan before copying or writing back.',
    badge: 'Result review',
    notionTitle: 'Mobile checkout bug bash',
    panelMode: 'Raw',
    panelStatus: 'Completed',
    panelNote: 'The reply is ready. Copy it, open Codex, or write it back when the page should change.',
    outputTitle: 'Assistant reply',
    output: [
      'Likely root cause:',
      '- The sticky footer overlaps the payment CTA on narrow screens.',
      '- The Apple Pay button keeps a fixed height while the sheet resizes.',
      '',
      'Suggested fix:',
      'Use a safe-area aware footer and add one mobile viewport test for 390 x 844.',
    ].join('\n'),
    selected: true,
    writeback: true,
    mode: 'notion-panel',
  },
  {
    file: '04-local-bridge-setup.png',
    title: 'Pair Chrome with local CLI',
    subtitle: 'Start the local bridge, pair once, and keep page content on your machine.',
    badge: 'Local-first setup',
    mode: 'popup',
  },
  {
    file: '05-prompt-profiles.png',
    title: 'Reuse prompt profiles',
    subtitle: 'Switch between build briefs, bug triage, launch checks, and team-specific workflows.',
    badge: 'Prompt profiles',
    notionTitle: 'Launch day checklist',
    panelMode: 'Ship Checklist',
    panelStatus: 'Ready',
    panelNote: 'Custom profiles live locally and keep the task intent consistent across Notion pages.',
    outputTitle: 'Profile instruction',
    output: [
      'Turn this page into a release checklist:',
      '- Separate blockers from nice-to-haves.',
      '- Keep manual account steps explicit.',
      '- Suggest the smallest safe launch sequence.',
    ].join('\n'),
    selected: false,
    modal: true,
    mode: 'notion-panel',
  },
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });

  for (const scene of scenes) {
    await page.setContent(renderScene(scene), { waitUntil: 'load' });
    await page.screenshot({
      path: path.join(outputDir, scene.file),
      fullPage: false,
      scale: 'css',
    });
  }
} finally {
  await browser.close();
}

console.log(`Generated ${scenes.length} Chrome Web Store screenshots in ${outputDir}`);

function renderScene(scene) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(scene.title)}</title>
  <style>${baseCss()}</style>
</head>
<body>
  <main class="frame ${scene.mode === 'popup' ? 'frame-popup' : ''}">
    <section class="headline">
      <div class="badge">${escapeHtml(scene.badge)}</div>
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${escapeHtml(scene.subtitle)}</p>
    </section>
    ${scene.mode === 'popup' ? renderPopupScene() : renderNotionScene(scene)}
  </main>
</body>
</html>`;
}

function renderNotionScene(scene) {
  return `<section class="browser">
    <div class="browser-top">
      <div class="traffic"><span></span><span></span><span></span></div>
      <div class="address">https://www.notion.so/team/${slug(scene.notionTitle)}</div>
      <div class="toolbar-pill">notion2CLI</div>
    </div>
    <div class="workspace">
      <aside class="sidebar">
        <div class="workspace-name">Northstar Studio</div>
        <nav>
          <span>Inbox</span>
          <span class="active">Product specs</span>
          <span>Engineering notes</span>
          <span>Launch calendar</span>
        </nav>
      </aside>
      <article class="notion-page">
        ${renderNotionPage(scene)}
      </article>
      ${renderActivityPanel(scene)}
      ${scene.modal ? renderPromptModal() : ''}
    </div>
  </section>`;
}

function renderNotionPage(scene) {
  const selectedClass = scene.selected ? ' selected' : '';
  return `<div class="crumb">Product specs / ${escapeHtml(scene.notionTitle)}</div>
  <h2>${escapeHtml(scene.notionTitle)}</h2>
  <div class="meta-row">
    <span>Owner: Maya Chen</span>
    <span>Target: Friday demo</span>
    <span>Runtime: Codex</span>
  </div>
  <div class="callout">
    <strong>Goal</strong>
    <p>Ship the smallest useful improvement without turning the planning page into another ticket queue.</p>
  </div>
  <h3>Working brief</h3>
  <p class="notion-text${selectedClass}">Users understand the core flow, but the handoff from planning to implementation is still slow. The next pass should turn this Notion brief into concrete code steps, keep risks visible, and avoid copying the same context into a terminal.</p>
  <div class="task-grid">
    <div>
      <strong>Must keep</strong>
      <p>Local-first data flow, visible review step, manual write-back.</p>
    </div>
    <div>
      <strong>Check before launch</strong>
      <p>Empty state, mobile layout, and one happy-path test.</p>
    </div>
  </div>
  <h3>Notes from standup</h3>
  <ul>
    <li>Jordan can review copy after the first implementation pass.</li>
    <li>Priya wants the result summarized in Notion before code changes land.</li>
    <li>No customer workspace data should appear in launch screenshots.</li>
  </ul>`;
}

function renderActivityPanel(scene) {
  const taskButtons = ['Raw', 'Build', 'Bug Triage', 'Ship Checklist'];
  return `<aside class="activity">
    <div class="activity-head">
      <span class="ready-dot"></span>
      <div>
        <div class="eyebrow">Activity</div>
        <div class="panel-title">${escapeHtml(scene.notionTitle)}</div>
      </div>
      <button class="collapse">⌄</button>
    </div>
    <div class="activity-body">
      <div class="task-head">
        <span>Run this page</span>
        <button>Manage</button>
      </div>
      <div class="task-list">
        ${taskButtons.map((button) => `<button class="${button === scene.panelMode ? 'active' : ''}">${escapeHtml(button)}</button>`).join('')}
      </div>
      <p class="hint">${escapeHtml(scene.panelNote)}</p>
      <div class="job-meta">
        <span><span class="mini-spinner ${scene.panelStatus === 'Running' ? '' : 'done'}"></span>${escapeHtml(scene.panelStatus)}</span>
        <span>#${scene.panelStatus === 'Running' ? '1842' : '1841'}</span>
      </div>
      <div class="brief-head">
        <strong>${escapeHtml(scene.outputTitle)}</strong>
        <button class="icon-button">Copy</button>
      </div>
      <pre>${escapeHtml(scene.output)}</pre>
      ${scene.writeback ? '<button class="writeback">Write to Notion</button>' : ''}
    </div>
  </aside>`;
}

function renderPopupScene() {
  return `<section class="setup-stage">
    <div class="terminal">
      <div class="terminal-top">
        <span></span><span></span><span></span>
        <strong>Terminal</strong>
      </div>
      <pre>$ npm install -g notion2cli
$ notion2cli daemon start --runtime codex

notion2CLI bridge listening on 127.0.0.1:43821
runtime: Codex CLI
status: ready for browser pairing

$ notion2cli pair
Pairing code: 482913
Expires in 5 minutes</pre>
    </div>
    <div class="popup-card">
      <div class="popup-eyebrow">Connection & Setup</div>
      <section class="status-card">
        <div class="status-row">
          <span class="status-dot ready"></span>
          <div>
            <div class="status-label">Current status</div>
            <div class="status-value">Connected to Codex</div>
          </div>
        </div>
        <p class="status-hint">The browser is connected to the current Codex session.</p>
        <div class="step-card">
          <div class="step-title">Ready for Notion pages</div>
          <p class="step-body">Open a Notion page, select text, or run the whole page from the Activity panel.</p>
        </div>
      </section>
      <section class="pair-card">
        <div class="section-title">Browser connection</div>
        <p class="section-copy">Pairing code accepted. This browser can send tasks to the local bridge.</p>
        <button class="ghost">Disconnect this browser</button>
      </section>
      <section class="config-card">
        <div class="section-title">Write-back settings</div>
        <label class="toggle-field"><span><strong>Show manual Write to Notion button</strong></span><input checked type="checkbox" /></label>
        <label class="field"><span>Write-back mode</span><select><option>Append to page</option></select></label>
      </section>
    </div>
  </section>`;
}

function renderPromptModal() {
  return `<div class="modal">
    <div class="modal-panel">
      <div class="modal-head">
        <div>
          <div class="eyebrow">Prompt profiles</div>
          <strong>Shape repeatable Notion workflows</strong>
        </div>
        <button>×</button>
      </div>
      <div class="prompt-editor">
        <div class="prompt-list">
          <button>Raw</button>
          <button>Build</button>
          <button class="active">Ship Checklist</button>
          <button>Bug Triage</button>
        </div>
        <div class="prompt-form">
          <label><span>Name</span><input value="Ship Checklist" /></label>
          <label><span>Instruction</span><textarea>Turn the current Notion page into a launch checklist. Separate blockers, owner decisions, and follow-up tasks. Keep the answer short enough to paste back into the page.</textarea></label>
          <div class="editor-actions"><button class="primary-small">Save profile</button><button>New profile</button></div>
        </div>
      </div>
    </div>
  </div>`;
}

function baseCss() {
  return `
    :root {
      color-scheme: light;
      --bg: #f6f0e8;
      --paper: #fffcf7;
      --paper2: #f8f5ef;
      --ink: #20241f;
      --muted: rgba(32, 36, 31, 0.62);
      --soft: rgba(51, 60, 45, 0.11);
      --line: rgba(51, 60, 45, 0.14);
      --green: #5c7a4a;
      --blue: #3867d6;
      --orange: #bb6b2f;
      font-family: Inter, Avenir Next, Segoe UI, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { width: 1280px; height: 800px; margin: 0; overflow: hidden; background: var(--bg); color: var(--ink); }
    body {
      background:
        linear-gradient(135deg, rgba(92, 122, 74, 0.10), transparent 38%),
        linear-gradient(315deg, rgba(56, 103, 214, 0.08), transparent 36%),
        #f7f1e8;
    }
    .frame { position: relative; width: 1280px; height: 800px; padding: 38px 44px 42px; }
    .headline { display: grid; gap: 9px; width: 760px; position: relative; z-index: 2; }
    .badge { width: max-content; padding: 8px 12px; border-radius: 999px; border: 1px solid rgba(92, 122, 74, 0.20); background: rgba(255,255,255,0.72); color: #466139; font-size: 13px; font-weight: 850; letter-spacing: .06em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 48px; line-height: 1; letter-spacing: -0.025em; max-width: 780px; }
    .headline p { margin: 0; max-width: 720px; color: rgba(32, 36, 31, 0.70); font-size: 19px; line-height: 1.42; }
    .browser { position: absolute; left: 44px; right: 44px; bottom: 34px; height: 525px; border: 1px solid rgba(51,60,45,.14); border-radius: 22px; background: rgba(255,255,255,.72); box-shadow: 0 24px 70px rgba(51,60,45,.14); overflow: hidden; }
    .browser-top { height: 48px; display: flex; align-items: center; gap: 14px; padding: 0 18px; border-bottom: 1px solid var(--line); background: rgba(250,250,248,.92); }
    .traffic { display: flex; gap: 7px; }
    .traffic span { width: 11px; height: 11px; border-radius: 999px; background: #e8705a; }
    .traffic span:nth-child(2) { background: #e5b84b; }
    .traffic span:nth-child(3) { background: #69b86f; }
    .address { flex: 1; height: 28px; display: flex; align-items: center; padding: 0 14px; border-radius: 999px; background: white; color: rgba(32,36,31,.58); font-size: 14px; }
    .toolbar-pill { padding: 7px 10px; border-radius: 10px; background: rgba(92,122,74,.12); color: #476139; font-size: 12px; font-weight: 800; }
    .workspace { position: relative; height: calc(100% - 48px); display: grid; grid-template-columns: 210px 1fr; background: #fffdfa; }
    .sidebar { padding: 24px 18px; border-right: 1px solid var(--line); background: #f7f3ed; }
    .workspace-name { font-size: 16px; font-weight: 850; margin-bottom: 22px; }
    nav { display: grid; gap: 8px; }
    nav span { padding: 10px 10px; border-radius: 9px; color: rgba(32,36,31,.66); font-size: 14px; font-weight: 700; }
    nav .active { background: white; color: var(--ink); box-shadow: 0 3px 12px rgba(51,60,45,.08); }
    .notion-page { padding: 34px 440px 40px 54px; overflow: hidden; }
    .crumb { color: rgba(32,36,31,.43); font-size: 12px; margin-bottom: 14px; }
    h2 { margin: 0 0 12px; font-size: 40px; letter-spacing: -0.03em; }
    h3 { margin: 22px 0 8px; font-size: 18px; }
    .meta-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
    .meta-row span { padding: 6px 9px; border-radius: 999px; background: #f2eee6; color: rgba(32,36,31,.62); font-size: 12px; font-weight: 700; }
    .callout { border: 1px solid rgba(92,122,74,.16); border-radius: 12px; background: rgba(92,122,74,.08); padding: 12px 14px; }
    .callout p, .task-grid p, li, .notion-text { color: rgba(32,36,31,.76); font-size: 15px; line-height: 1.55; }
    .callout p { margin: 5px 0 0; }
    .notion-text { margin: 0; padding: 8px 10px; border-radius: 10px; }
    .notion-text.selected { background: rgba(64, 118, 230, .16); box-shadow: inset 0 0 0 1px rgba(64, 118, 230, .16); }
    .task-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
    .task-grid div { border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: #fff; }
    .task-grid p { margin: 5px 0 0; }
    ul { margin: 8px 0 0; padding-left: 19px; }
    .activity { position: absolute; top: 24px; right: 22px; width: 386px; border-radius: 20px; overflow: hidden; box-shadow: 0 24px 58px rgba(45,57,72,.18); filter: drop-shadow(0 20px 44px rgba(45,57,72,.10)); }
    .activity-head { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; padding: 13px 14px; border: 1px solid rgba(132,147,164,.28); border-bottom: 0; border-radius: 20px 20px 0 0; background: rgba(239,242,246,.98); }
    .ready-dot { width: 10px; height: 10px; border-radius: 999px; background: var(--green); box-shadow: 0 0 0 4px rgba(92,122,74,.14); }
    .eyebrow { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; color: rgba(36,48,65,.52); }
    .panel-title { margin-top: 2px; max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; font-weight: 850; color: #243041; }
    .collapse { width: 34px; height: 34px; border: 0; border-radius: 12px; background: rgba(255,255,255,.44); color: #243041; font-size: 18px; }
    .activity-body { max-height: 328px; padding: 18px 20px 20px; border: 1px solid rgba(132,147,164,.28); border-top: 1px solid rgba(132,147,164,.18); border-radius: 0 0 20px 20px; background: rgba(248,250,252,.98); }
    .task-head, .job-meta, .brief-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .task-head span, .brief-head strong { font-size: 13px; font-weight: 850; color: #243041; }
    .task-head button, .icon-button { border: 0; background: transparent; color: rgba(36,48,65,.56); font-size: 11px; font-weight: 800; }
    .task-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .task-list button { min-height: 36px; padding: 9px 13px; border: 1px solid rgba(132,147,164,.28); border-radius: 10px; background: rgba(255,255,255,.72); color: #243041; font-size: 13px; font-weight: 800; }
    .task-list .active { background: var(--green); color: #f7f3ea; border-color: rgba(92,122,74,.58); }
    .hint { margin: 10px 0 0; color: rgba(36,48,65,.76); font-size: 12px; line-height: 1.55; }
    .job-meta { margin-top: 14px; color: rgba(36,48,65,.56); font-size: 11px; }
    .job-meta span:first-child { display: inline-flex; align-items: center; gap: 7px; }
    .mini-spinner { width: 12px; height: 12px; border-radius: 999px; border: 2px solid rgba(92,122,74,.18); border-top-color: rgba(92,122,74,.85); }
    .mini-spinner.done { background: var(--green); border-color: var(--green); box-shadow: 0 0 0 3px rgba(92,122,74,.12); }
    .brief-head { margin-top: 18px; }
    pre { margin: 10px 0 0; max-height: 76px; overflow: hidden; white-space: pre-wrap; padding: 14px; border-radius: 16px; border: 1px solid rgba(132,147,164,.18); background: rgba(255,255,255,.72); color: #243041; font: 13px/1.62 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .writeback { margin-top: 12px; padding: 11px 12px; border-radius: 14px; border: 1px solid rgba(132,147,164,.28); background: rgba(255,255,255,.72); color: #243041; font-size: 12px; font-weight: 800; }
    .setup-stage { position: absolute; left: 60px; right: 60px; bottom: 54px; height: 550px; display: grid; grid-template-columns: 1fr 380px; gap: 30px; align-items: stretch; }
    .terminal { align-self: end; height: 415px; border-radius: 18px; overflow: hidden; background: #171b20; color: #d9e2da; box-shadow: 0 24px 70px rgba(23,27,32,.22); }
    .terminal-top { height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 16px; background: #22272e; color: rgba(255,255,255,.62); }
    .terminal-top span { width: 11px; height: 11px; border-radius: 999px; background: #ef6a5b; }
    .terminal-top span:nth-child(2) { background: #f2c24f; }
    .terminal-top span:nth-child(3) { background: #67c36f; }
    .terminal-top strong { margin-left: 8px; font-size: 12px; }
    .terminal pre { max-height: none; margin: 0; padding: 22px; border: 0; border-radius: 0; background: transparent; color: #dbe7d9; font-size: 14px; line-height: 1.7; }
    .popup-card { width: 360px; height: 538px; padding: 18px; border-radius: 24px; background: linear-gradient(180deg, #f8f3eb, #f1e8dc); box-shadow: 0 24px 60px rgba(51,60,45,.16); overflow: hidden; }
    .popup-eyebrow { font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: rgba(73,88,66,.62); }
    .status-card, .pair-card, .config-card { margin-top: 14px; padding: 16px; border: 1px solid rgba(69,83,61,.12); border-radius: 18px; background: rgba(255,251,245,.90); box-shadow: 0 16px 34px rgba(51,60,45,.08); }
    .status-row { display: flex; align-items: center; gap: 13px; }
    .status-dot { width: 14px; height: 14px; border-radius: 999px; background: #b9533e; box-shadow: 0 0 0 7px rgba(185,83,62,.12); }
    .status-dot.ready { background: var(--green); box-shadow: 0 0 0 7px rgba(92,122,74,.14); }
    .status-label { font-size: 11px; font-weight: 800; color: rgba(31,40,29,.60); }
    .status-value { margin-top: 2px; font-size: 17px; font-weight: 850; }
    .status-hint, .section-copy, .step-body { margin: 10px 0 0; color: rgba(31,40,29,.72); font-size: 12px; line-height: 1.6; }
    .step-card { margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(69,83,61,.10); }
    .step-title { font-size: 18px; font-weight: 850; }
    .section-title { font-size: 11px; font-weight: 850; letter-spacing: .06em; color: rgba(42,55,36,.76); }
    .ghost { width: 100%; margin-top: 12px; padding: 12px 14px; border-radius: 14px; border: 1px solid rgba(69,83,61,.08); background: rgba(69,83,61,.08); color: rgba(31,40,29,.74); font-size: 13px; font-weight: 800; }
    .toggle-field { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 12px; padding: 12px 13px; border: 1px solid rgba(69,83,61,.12); border-radius: 16px; background: rgba(255,253,249,.68); color: rgba(31,40,29,.78); }
    .toggle-field strong { display: block; font-size: 12px; line-height: 1.35; }
    .toggle-field input { width: 42px; height: 24px; accent-color: var(--green); }
    .field { display: grid; gap: 8px; margin-top: 12px; font-size: 12px; font-weight: 800; }
    select, input, textarea { width: 100%; border: 1px solid rgba(69,83,61,.18); border-radius: 14px; background: rgba(248,243,235,.98); color: #243020; font: inherit; }
    select { padding: 12px 14px; font-size: 13px; font-weight: 800; }
    .modal { position: absolute; inset: 48px 0 0 210px; display: flex; align-items: flex-end; justify-content: center; padding: 20px; background: rgba(25,32,43,.20); backdrop-filter: blur(6px); }
    .modal-panel { width: 560px; border-radius: 18px; border: 1px solid rgba(132,147,164,.28); background: rgba(248,250,252,.98); box-shadow: 0 24px 60px rgba(45,57,72,.20); overflow: hidden; }
    .modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid rgba(132,147,164,.18); }
    .modal-head button { width: 32px; height: 32px; border: 1px solid rgba(132,147,164,.18); border-radius: 10px; background: white; font-size: 20px; color: #243041; }
    .prompt-editor { display: grid; grid-template-columns: 150px 1fr; gap: 14px; padding: 16px; }
    .prompt-list { display: grid; align-content: start; gap: 8px; }
    .prompt-list button, .editor-actions button { min-height: 34px; padding: 8px 10px; border: 1px solid rgba(132,147,164,.18); border-radius: 10px; background: rgba(255,255,255,.56); color: #243041; font-size: 12px; font-weight: 800; text-align: left; }
    .prompt-list .active { border-color: rgba(92,122,74,.48); background: rgba(92,122,74,.12); }
    .prompt-form { display: grid; gap: 12px; }
    .prompt-form label { display: grid; gap: 6px; font-size: 11px; font-weight: 800; color: rgba(36,48,65,.56); }
    .prompt-form input, .prompt-form textarea { padding: 10px; border-radius: 12px; background: rgba(255,255,255,.72); border: 1px solid rgba(132,147,164,.28); color: #243041; font-size: 12px; }
    .prompt-form textarea { height: 138px; resize: none; line-height: 1.5; }
    .editor-actions { display: flex; gap: 8px; }
    .editor-actions .primary-small { background: var(--green); color: white; border: 0; }
  `;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
