import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PromptProfileStore } from '../server/core/prompt-profiles.mjs';

async function withStore(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notion2cli-prompts-'));
  const store = new PromptProfileStore({
    filePath: path.join(dir, 'prompts.json'),
  });

  try {
    await fn(store);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('prompt profile store lists protected raw and editable Build profiles', async () => {
  await withStore(async (store) => {
    const profiles = await store.list();
    assert.deepEqual(profiles.map((profile) => profile.id), ['raw', 'build']);
    assert.equal(profiles[0].name, 'Raw');
    assert.equal(profiles[0].editable, false);
    assert.equal(profiles[1].name, 'Build');
    assert.equal(profiles[1].editable, true);
  });
});

test('prompt profile store creates and resolves user profiles', async () => {
  await withStore(async (store) => {
    const created = await store.create({
      name: 'Translate',
      instruction: 'Translate the input.',
    });

    assert.match(created.id, /^custom-/);
    assert.equal(created.name, 'Translate');
    assert.equal(created.source, 'user');

    const resolved = await store.resolve(created.id);
    assert.equal(resolved.instruction, 'Translate the input.');
  });
});

test('prompt profile store updates and resets Build override', async () => {
  await withStore(async (store) => {
    const updated = await store.update('build', {
      name: 'Ship',
      instruction: 'Implement the spec.',
    });
    assert.equal(updated.id, 'build');
    assert.equal(updated.name, 'Ship');
    assert.equal(updated.source, 'builtin_override');

    const reset = await store.reset('build');
    assert.equal(reset.name, 'Build');
    assert.match(reset.instruction, /Turn the requirements in the input document/);
  });
});

test('prompt profile store deletes custom profiles and hides Build', async () => {
  await withStore(async (store) => {
    const created = await store.create({
      name: 'Summarize',
      instruction: 'Summarize the input.',
    });
    await store.delete(created.id);
    assert.equal(await store.resolve(created.id), null);

    await store.delete('build');
    assert.deepEqual((await store.list()).map((profile) => profile.id), ['raw']);

    await store.reset('build');
    assert.deepEqual((await store.list()).map((profile) => profile.id), ['raw', 'build']);
  });
});

test('prompt profile store protects raw profile', async () => {
  await withStore(async (store) => {
    await assert.rejects(
      () => store.update('raw', { name: 'Raw', instruction: 'No.' }),
      /cannot be edited/,
    );
    await assert.rejects(
      () => store.delete('raw'),
      /cannot be deleted/,
    );
  });
});
