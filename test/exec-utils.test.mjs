import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSpawnEnv,
  buildWindowsCommandLine,
  resolveCommandForSpawn,
  runCommand,
} from '../server/runtimes/exec-utils.mjs';

test('Windows command resolver runs npm .cmd shims through cmd.exe', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'notion2cli-win-cmd-'));
  const binDir = path.join(dir, 'bin with space');
  const commandPath = path.join(binDir, 'codex.CMD');
  const posixShimPath = path.join(binDir, 'codex');
  mkdirp(binDir);
  writeFileSync(posixShimPath, '#!/bin/sh\n');
  writeFileSync(commandPath, '@echo off\r\n');

  try {
    const result = resolveCommandForSpawn('codex', ['app-server', '--listen', 'stdio://'], {
      platform: 'win32',
      env: {
        Path: binDir,
        PATHEXT: '.CMD;.EXE',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      },
    });

    assert.equal(result.command, 'C:\\Windows\\System32\\cmd.exe');
    assert.equal(result.viaShell, true);
    assert.equal(result.resolvedCommand.toLowerCase(), commandPath.toLowerCase());
    assert.deepEqual(result.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.match(result.args[3], /"[^"]*codex\.cmd"/i);
    assert.match(result.args[3], /app-server --listen stdio:\/\/"?$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows command scripts can find the current Node executable', { skip: process.platform !== 'win32' }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'notion2cli-win-node-path-'));
  const commandPath = path.join(dir, 'needs-node.cmd');
  mkdirp(dir);
  writeFileSync(commandPath, '@echo off\r\nnode -e "process.stdout.write(process.version)"\r\n');

  try {
    const result = await runCommand('needs-node', [], {
      env: {
        Path: dir,
        PATHEXT: '.CMD;.EXE',
        ComSpec: process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe',
        SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      },
      timeoutMs: 5000,
    });

    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), process.version);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows command scripts preserve JSON arguments through cmd.exe', { skip: process.platform !== 'win32' }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'notion2cli-win-json-'));
  const commandPath = path.join(dir, 'echoargs.cmd');
  const scriptPath = path.join(dir, 'echoargs.mjs');
  const payload = {
    type: 'stdio',
    command: 'C:\\Program Files\\nodejs\\node.exe',
    env: {
      SAMPLE: 'value with spaces',
    },
  };
  mkdirp(dir);
  writeFileSync(commandPath, `@echo off\r\nnode "${scriptPath}" %*\r\n`);
  writeFileSync(scriptPath, 'console.log(JSON.stringify(process.argv.slice(2)))\n');

  try {
    const result = await runCommand('echoargs', ['mcp', 'add-json', 'name', JSON.stringify(payload)], {
      env: {
        Path: dir,
        PATHEXT: '.CMD;.EXE',
        ComSpec: process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe',
        SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      },
      timeoutMs: 5000,
    });

    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), ['mcp', 'add-json', 'name', JSON.stringify(payload)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows spawn env appends the current Node directory without changing command priority', () => {
  const env = buildSpawnEnv({
    Path: 'C:\\Tools',
  }, 'win32');

  assert.match(env.Path, /^C:\\Tools/i);
  assert.equal(env.Path.split(path.delimiter).at(-1), path.dirname(process.execPath));
});

test('Windows command resolver launches native .exe binaries directly', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'notion2cli-win-exe-'));
  const binDir = path.join(dir, 'bin');
  const commandPath = path.join(binDir, 'claude.EXE');
  mkdirp(binDir);
  writeFileSync(commandPath, '');

  try {
    const result = resolveCommandForSpawn('claude', ['--version'], {
      platform: 'win32',
      env: {
        PATH: binDir,
        PATHEXT: '.EXE;.CMD',
      },
    });

    assert.equal(result.command.toLowerCase(), commandPath.toLowerCase());
    assert.equal(result.viaShell, false);
    assert.deepEqual(result.args, ['--version']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows command resolver covers bundled provider CLI fallbacks', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'notion2cli-win-lark-'));
  const commandPath = path.join(dir, 'lark-cli.CMD');
  mkdirp(dir);
  writeFileSync(commandPath, '@echo off\r\n');

  try {
    const result = resolveCommandForSpawn('lark-cli', ['auth', 'status'], {
      platform: 'win32',
      env: {
        PATH: dir,
        PATHEXT: '.CMD;.EXE',
      },
    });

    assert.equal(result.viaShell, true);
    assert.equal(result.resolvedCommand.toLowerCase(), commandPath.toLowerCase());
    assert.match(result.args[3], /lark-cli\.cmd auth status/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows command line builder quotes paths and shell metacharacters', () => {
  assert.equal(
    buildWindowsCommandLine('C:\\Program Files\\notion2cli\\codex.cmd', ['run', 'a&b']),
    '"C:\\Program Files\\notion2cli\\codex.cmd" run "a^&b"',
  );
});

function mkdirp(dir) {
  mkdirSync(dir, { recursive: true });
}
