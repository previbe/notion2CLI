import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const EXCLUDED_DIRS = new Set(['.git', '.tmp', 'node_modules', 'output']);
const TEXT_FILE_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.txt',
  '.yml',
  '.yaml',
]);
const EXTENSIONLESS_TEXT_FILES = new Set([
  'LICENSE',
  'notion2cli-bridge',
  'notion2cli-connect',
  'notion2cli-status',
]);

await checkEnglishOnlyText();

const targets = [
  path.join(root, 'cli'),
  path.join(root, 'server'),
  path.join(root, 'extension'),
  path.join(root, 'scripts'),
  path.join(root, 'test'),
  path.join(root, 'bin'),
];

const files = [];
for (const target of targets) {
  await collectJsFiles(target, files);
}

for (const file of files) {
  await checkFile(file);
}

async function checkEnglishOnlyText() {
  const files = [];
  await collectTextFiles(root, files);
  const violations = [];

  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const lines = raw.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\p{Script=Han}|[\u3000-\u303f\uff00-\uffef]/u.test(line)) {
        violations.push(`${path.relative(root, file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  if (violations.length) {
    throw new Error([
      'English-only text check failed. Remove CJK text or full-width punctuation from project files:',
      ...violations,
    ].join('\n'));
  }
}

async function collectTextFiles(dir, output) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        await collectTextFiles(path.join(dir, entry.name), output);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (isTextFile(entry.name)) {
      output.push(fullPath);
    }
  }
}

function isTextFile(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(extension) || EXTENSIONLESS_TEXT_FILES.has(fileName);
}

async function collectJsFiles(dir, output) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectJsFiles(fullPath, output);
      continue;
    }

    if (/\.(mjs|js)$/.test(entry.name)) {
      output.push(fullPath);
    }
  }
}

function checkFile(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['--check', file], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Syntax check failed for ${file}`));
    });
  });
}
