/**
 * v3.39 Phase 1a — plugin chain + library storage unit tests.
 *
 * Every test round-trips through disk via writeUserState/readUserState (after
 * invalidating the in-memory cache) so we're asserting the persistence
 * contract, not just in-memory mutation.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  UserStateService,
  migrateStateIfNeeded,
  PER_TRACK_KEYS,
} = require('../dist/state-service.test.cjs');

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-plugins-'));
}

async function reload(stateDir) {
  const s = new UserStateService(stateDir);
  s.invalidateCache();
  return s;
}

test('PER_TRACK_KEYS includes perTrackPluginChains so the split layout hoists it', () => {
  assert.ok(
    PER_TRACK_KEYS.includes('perTrackPluginChains'),
    'perTrackPluginChains must live in PER_TRACK_KEYS for per-track split writes',
  );
});

test('getTrackPluginChain returns an empty pass-through chain for an unknown song', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);
    const chain = await service.getTrackPluginChain('no-such-song');
    assert.deepEqual(chain, { songId: 'no-such-song', items: [] });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('addPluginToChain appends in order and persists across a reload', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const writer = new UserStateService(tmp);

    await writer.addPluginToChain('song-1', 'vst3:deadbeef');
    await writer.addPluginToChain('song-1', 'au:faceface');

    const reader = await reload(tmp);
    const chain = await reader.getTrackPluginChain('song-1');
    assert.equal(chain.songId, 'song-1');
    assert.equal(chain.items.length, 2);
    assert.equal(chain.items[0].pluginId, 'vst3:deadbeef');
    assert.equal(chain.items[0].order, 0);
    assert.equal(chain.items[0].enabled, true);
    assert.equal(chain.items[1].pluginId, 'au:faceface');
    assert.equal(chain.items[1].order, 1);
    assert.notEqual(chain.items[0].instanceId, chain.items[1].instanceId);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('togglePluginEnabled flips only the targeted slot', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);
    let chain = await service.addPluginToChain('song-a', 'vst3:a');
    chain = await service.addPluginToChain('song-a', 'vst3:b');
    const targetId = chain.items[1].instanceId;

    await service.togglePluginEnabled('song-a', targetId, false);

    const after = await (await reload(tmp)).getTrackPluginChain('song-a');
    const enabledByPlugin = Object.fromEntries(after.items.map((i) => [i.pluginId, i.enabled]));
    assert.equal(enabledByPlugin['vst3:a'], true, 'untouched slot stays enabled');
    assert.equal(enabledByPlugin['vst3:b'], false, 'target slot is disabled');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('reorderPluginChain rewrites order values to match the provided id list', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);
    let chain = await service.addPluginToChain('song-r', 'vst3:a');
    chain = await service.addPluginToChain('song-r', 'vst3:b');
    chain = await service.addPluginToChain('song-r', 'vst3:c');
    const [a, b, c] = chain.items.map((i) => i.instanceId);

    const reordered = await service.reorderPluginChain('song-r', [c, a, b]);
    assert.deepEqual(
      reordered.items.map((i) => [i.pluginId, i.order]),
      [
        ['vst3:c', 0],
        ['vst3:a', 1],
        ['vst3:b', 2],
      ],
    );

    // Unknown ids are ignored; missing ones keep their trailing position.
    const reloaded = await (await reload(tmp)).getTrackPluginChain('song-r');
    assert.equal(reloaded.items.length, 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('removePluginFromChain compacts order numbers back to 0..n-1', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);
    let chain = await service.addPluginToChain('song-d', 'vst3:a');
    chain = await service.addPluginToChain('song-d', 'vst3:b');
    chain = await service.addPluginToChain('song-d', 'vst3:c');
    const middleId = chain.items[1].instanceId;

    const after = await service.removePluginFromChain('song-d', middleId);
    assert.equal(after.items.length, 2);
    assert.deepEqual(
      after.items.map((i) => [i.pluginId, i.order]),
      [
        ['vst3:a', 0],
        ['vst3:c', 1],
      ],
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('setPluginState stores an opaque base64 blob on the targeted slot', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);
    const chain = await service.addPluginToChain('song-s', 'vst3:z');
    const instanceId = chain.items[0].instanceId;

    const blob = Buffer.from('<plugin state>').toString('base64');
    await service.setPluginState('song-s', instanceId, blob);

    const reloaded = await (await reload(tmp)).getTrackPluginChain('song-s');
    assert.equal(reloaded.items[0].state, blob);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('setPluginLibrary / getPluginLibrary round-trip through disk', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const writer = new UserStateService(tmp);

    const library = {
      plugins: [
        {
          id: 'vst3:deadbeef',
          name: 'Pro-Q 4',
          vendor: 'FabFilter',
          format: 'vst3',
          version: '4.0.0',
          path: '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 4.vst3',
          categories: ['Fx', 'EQ'],
          isSupported: true,
          failureReason: null,
        },
      ],
      scannedAt: new Date().toISOString(),
      scanVersion: 1,
    };
    await writer.setPluginLibrary(library);

    const reader = await reload(tmp);
    const reloaded = await reader.getPluginLibrary();
    assert.ok(reloaded);
    assert.equal(reloaded.plugins.length, 1);
    assert.equal(reloaded.plugins[0].id, 'vst3:deadbeef');
    assert.equal(reloaded.plugins[0].vendor, 'FabFilter');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('renderer full-state sync preserves plugin library and per-track chains', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);

    const library = {
      plugins: [
        {
          id: 'vst3:critical-preserve',
          name: 'Critical Preserve',
          vendor: 'Regression Audio',
          format: 'vst3',
          version: '1.0.0',
          path: '/Library/Audio/Plug-Ins/VST3/Critical Preserve.vst3',
          categories: ['Fx'],
          isSupported: true,
          failureReason: null,
        },
      ],
      scannedAt: new Date().toISOString(),
      scanVersion: 1,
    };
    await service.setPluginLibrary(library);
    await service.addPluginToChain('song-critical', 'vst3:critical-preserve');

    const syncPayload = JSON.parse(JSON.stringify(await service.readUserState()));
    syncPayload.pluginLibrary = undefined;
    syncPayload.perTrackPluginChains = {};
    syncPayload.albumTitle = 'Renderer sync payload';

    await service.writeUserStatePreservingAiRecommendations(syncPayload);

    const reader = await reload(tmp);
    const preservedLibrary = await reader.getPluginLibrary();
    const preservedChain = await reader.getTrackPluginChain('song-critical');

    assert.ok(preservedLibrary);
    assert.equal(preservedLibrary.plugins[0].id, 'vst3:critical-preserve');
    assert.equal(preservedChain.items.length, 1);
    assert.equal(preservedChain.items[0].pluginId, 'vst3:critical-preserve');
    assert.equal((await reader.readUserState()).albumTitle, 'Renderer sync payload');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getPluginLibrary returns null when nothing has been scanned yet', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);
    const library = await service.getPluginLibrary();
    assert.equal(library, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
