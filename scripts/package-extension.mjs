import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

const root = process.cwd();
const extensionDir = path.join(root, 'extension');
const outputDir = path.join(root, 'dist', 'chrome');
const outputFile = path.join(outputDir, `notion2cli-chrome-extension-v${packageJson.version}.zip`);

await mkdir(outputDir, { recursive: true });
await rm(outputFile, { force: true });

const files = [
  'background.js',
  'content-script.js',
  'content-style.css',
  'icons',
  'manifest.json',
  'popup.css',
  'popup.html',
  'popup.js',
];

const result = spawnSync('zip', ['-r', outputFile, ...files], {
  cwd: extensionDir,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`zip exited with status ${result.status}`);
}

process.stdout.write(`${outputFile}\n`);
