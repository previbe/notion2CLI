import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRuntimeLaunchCommand,
  getPermissionModeHint,
  normalizePermissionMode,
} from '../extension/launch-commands.js';

test('popup launch command builder maps codex permission modes', () => {
  assert.equal(
    buildRuntimeLaunchCommand('codex', 'default'),
    'notion2cli daemon start --runtime codex',
  );
  assert.equal(
    buildRuntimeLaunchCommand('codex', 'auto-review'),
    'notion2cli daemon start --runtime codex --permission-mode auto-review',
  );
  assert.equal(
    buildRuntimeLaunchCommand('codex', 'full-access'),
    'notion2cli daemon start --runtime codex --permission-mode full-access',
  );
});

test('popup launch command builder maps claude permission modes', () => {
  assert.equal(
    buildRuntimeLaunchCommand('claude', 'default'),
    'notion2cli claude launch',
  );
  assert.equal(
    buildRuntimeLaunchCommand('claude', 'auto-review'),
    'notion2cli claude launch --permission-mode auto-review',
  );
  assert.equal(
    buildRuntimeLaunchCommand('claude', 'full-access'),
    'notion2cli claude launch --permission-mode full-access',
  );
});

test('popup permission helpers normalize invalid local preferences', () => {
  assert.equal(normalizePermissionMode('unexpected'), 'default');
  assert.match(getPermissionModeHint('full-access'), /Disables sandbox/);
});

