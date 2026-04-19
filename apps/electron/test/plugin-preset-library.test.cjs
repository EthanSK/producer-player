/**
 * v3.43 Phase 4 — plugin preset library persistence.
 */
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const test = require('node:test');

const {
  PLUGIN_PRESET_LIBRARY_FILE_NAME,
  PluginPresetLibraryStore,
} = require('../dist/plugin-preset-library.test.cjs');

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'producer-player-plugin-presets-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('save new preset and read back identical entry', async () => {
  await withTempDir(async (dir) => {
    const store = new PluginPresetLibraryStore(dir);
    const saved = await store.savePreset('vst3:abc', 'Lead Vocal', 'AAECAw==');
    const readBack = await store.getPreset('vst3:abc', 'Lead Vocal');

    assert.equal(readBack.pluginIdentifier, saved.pluginIdentifier);
    assert.equal(readBack.name, saved.name);
    assert.equal(readBack.stateBase64, saved.stateBase64);
    assert.equal(readBack.savedAt, saved.savedAt);
  });
});

test('save with same plugin/name overwrites and keeps one entry', async () => {
  await withTempDir(async (dir) => {
    const store = new PluginPresetLibraryStore(dir);
    await store.savePreset('vst3:abc', 'Mix Bus', 'old-state');
    const updated = await store.savePreset('vst3:abc', 'Mix Bus', 'new-state');
    const presets = await store.listPresetsFor('vst3:abc');

    assert.equal(presets.length, 1);
    assert.equal(presets[0].stateBase64, 'new-state');
    assert.equal(presets[0].savedAt, updated.savedAt);
  });
});

test('list sorts newest-first', async () => {
  await withTempDir(async (dir) => {
    const store = new PluginPresetLibraryStore(dir);
    await store.savePreset('vst3:abc', 'Older', 'state-a');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.savePreset('vst3:abc', 'Newer', 'state-b');

    const presets = await store.listPresetsFor('vst3:abc');
    assert.deepEqual(presets.map((preset) => preset.name), ['Newer', 'Older']);
  });
});

test('delete removes the entry', async () => {
  await withTempDir(async (dir) => {
    const store = new PluginPresetLibraryStore(dir);
    await store.savePreset('vst3:abc', 'Delete Me', 'state');
    await store.deletePreset('vst3:abc', 'Delete Me');

    assert.equal(await store.getPreset('vst3:abc', 'Delete Me'), null);
    assert.deepEqual(await store.listPresetsFor('vst3:abc'), []);
  });
});

test('survives a fresh instance pointing at the same dir', async () => {
  await withTempDir(async (dir) => {
    const store = new PluginPresetLibraryStore(dir);
    await store.savePreset('vst3:abc', 'Round Trip', 'persisted-state');

    const freshStore = new PluginPresetLibraryStore(dir);
    const readBack = await freshStore.getPreset('vst3:abc', 'Round Trip');
    assert.equal(readBack.stateBase64, 'persisted-state');

    const raw = JSON.parse(
      await readFile(join(dir, PLUGIN_PRESET_LIBRARY_FILE_NAME), 'utf8'),
    );
    assert.equal(raw.version, 1);
    assert.equal(raw.presets.length, 1);
  });
});

test('corrupt file on disk recovers to an empty library without throwing', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, PLUGIN_PRESET_LIBRARY_FILE_NAME), '{not-json', 'utf8');
    const store = new PluginPresetLibraryStore(dir);

    assert.deepEqual(await store.listPresetsFor('vst3:abc'), []);
    await store.savePreset('vst3:abc', 'Recovered', 'state');
    assert.equal((await store.listPresetsFor('vst3:abc')).length, 1);
  });
});
