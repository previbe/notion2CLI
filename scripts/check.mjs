import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
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
