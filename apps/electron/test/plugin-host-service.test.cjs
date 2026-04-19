/**
 * PluginHostService unit tests.
 *
 * v3.39 (Phase 1a): scan / start / stop / "not implemented" round-trips.
 * v3.41 (Phase 2) additions:
 *   - diffChainReconciliation: pure diff logic, no child process.
 *   - reconcileTrackChain: loads new slots, unloads removed ones, leaves
 *                          unchanged slots alone. Errors are collected, not
 *                          thrown.
 *   - processBlock:        round-trips buffer + chain and returns processed
 *                          base64 + processedSlots count.
 *   - Empty-chain invariant: a chain with zero items (or all disabled) still
 *                            returns an ok:true passthrough from the sidecar.
 *
 * We inject a scriptable fake child into PluginHostService via the optional
 * `spawnFn` constructor argument. The fake mirrors what pp-audio-host does
 * on the wire, so the suite stays hermetic — no real binary required.
 */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  PluginHostService,
  resolveSidecarBinary,
  diffChainReconciliation,
} = require('../dist/plugin-host-service.test.cjs');

/** Build a fake ChildProcessWithoutNullStreams-like object we can script. */
function makeFakeChild({ replies = {}, emitReady = true } = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter();
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = false;
  child.kill = (_sig) => {
    child.killed = true;
    child.emit('exit', 0, null);
  };

  let buffer = '';
  stdin.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const nl = buffer.indexOf('\n');
      if (nl < 0) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const req = JSON.parse(line);
        const handler = replies[req.method];
        if (!handler) {
          stdout.write(
            `${JSON.stringify({ id: req.id, ok: false, error: `no mock for ${req.method}` })}\n`,
          );
          continue;
        }
        Promise.resolve(typeof handler === 'function' ? handler(req) : handler)
          .then((body) => {
            const merged = { id: req.id, ok: true, ...(body || {}) };
            if (body && Object.prototype.hasOwnProperty.call(body, 'ok')) merged.ok = body.ok;
            stdout.write(`${JSON.stringify(merged)}\n`);
          })
          .catch((e) => {
            stdout.write(`${JSON.stringify({ id: req.id, ok: false, error: String(e) })}\n`);
          });
      } catch (e) {
        stdout.write(`${JSON.stringify({ ok: false, error: String(e) })}\n`);
      }
    }
  });

  if (emitReady) {
    setImmediate(() => {
      stdout.write(`${JSON.stringify({ event: 'ready', version: '0.2.0-test' })}\n`);
    });
  }

  return child;
}

// ---------------------------------------------------------------------------
// Existing Phase 1a coverage
// ---------------------------------------------------------------------------

test('resolveSidecarBinary returns null when no build output exists in a pristine cwd', () => {
  const found = resolveSidecarBinary('/tmp/pp-does-not-exist-here');
  assert.equal(found, null);
});

test('start resolves on the {"event":"ready"} handshake', async () => {
  const fake = makeFakeChild();
  const service = new PluginHostService('/fake/path', () => fake);
  await service.start();
  assert.equal(service.isRunning(), true);
});

test('scanPlugins parses a canned reply into a ScannedPluginLibrary shape', async () => {
  const fake = makeFakeChild({
    replies: {
      scan_plugins: {
        plugins: [
          {
            id: 'vst3:abc',
            name: 'Pro-Q 4',
            vendor: 'FabFilter',
            format: 'vst3',
            version: '4.0',
            path: '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 4.vst3',
            categories: ['Fx', 'EQ'],
            isSupported: true,
            failureReason: null,
          },
          {
            id: 'au:def',
            name: 'AUCompressor',
            vendor: 'Apple',
            format: 'au',
            version: '1.0',
            path: '/Library/Audio/Plug-Ins/Components/AUCompressor.component',
            categories: ['Dynamics'],
            isSupported: true,
            failureReason: null,
          },
          { id: 'vst3:bad', name: 'Broken', format: 'vst3' },
        ],
        scanVersion: 1,
      },
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  const library = await service.scanPlugins();
  assert.equal(library.plugins.length, 2, 'malformed entry filtered out');
  assert.equal(library.scanVersion, 1);
  assert.ok(library.scannedAt.length > 0, 'scannedAt is stamped');
  const vst3 = library.plugins.find((p) => p.format === 'vst3');
  assert.equal(vst3.vendor, 'FabFilter');
});

test('stop sends shutdown and kills the child', async () => {
  const fake = makeFakeChild({ replies: { shutdown: {} } });
  const service = new PluginHostService('/fake/path', () => fake);
  await service.start();
  await service.stop();
  assert.equal(fake.killed || service.isRunning() === false, true);
});

test('stop notifies editor_closed listeners for tracked open editors', async () => {
  const fake = makeFakeChild({
    replies: {
      open_editor: (req) => ({ instanceId: req.params.instanceId, alreadyOpen: false }),
      shutdown: {},
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  const closedIds = [];
  service.onEditorClosed((id) => closedIds.push(id));
  await service.openPluginEditor('inst-stop');
  await service.stop();
  assert.deepEqual(closedIds, ['inst-stop']);
  assert.deepEqual(service.getOpenEditorIds(), []);
});

// ---------------------------------------------------------------------------
// Phase 2 — reconciliation diff logic (pure function)
// ---------------------------------------------------------------------------

test('diffChainReconciliation: fresh chain → all slots to load', () => {
  const plan = diffChainReconciliation(new Set(), [
    { instanceId: 'a', pluginId: 'vst3:x', enabled: true, order: 0 },
    { instanceId: 'b', pluginId: 'vst3:y', enabled: false, order: 1 },
  ]);
  assert.equal(plan.toLoad.length, 2);
  assert.equal(plan.toUnload.length, 0);
  assert.equal(plan.unchanged.length, 0);
});

test('diffChainReconciliation: chain cleared → everything unloads', () => {
  const plan = diffChainReconciliation(new Set(['a', 'b']), []);
  assert.deepEqual(plan.toLoad, []);
  assert.deepEqual([...plan.toUnload].sort(), ['a', 'b']);
});

test('diffChainReconciliation: unchanged ids stay unchanged regardless of enable/reorder', () => {
  const plan = diffChainReconciliation(new Set(['a', 'b']), [
    { instanceId: 'b', pluginId: 'vst3:y', enabled: false, order: 0 },
    { instanceId: 'a', pluginId: 'vst3:x', enabled: true, order: 1 },
    { instanceId: 'c', pluginId: 'vst3:z', enabled: true, order: 2 },
  ]);
  assert.deepEqual(plan.toLoad.map((t) => t.instanceId), ['c']);
  assert.deepEqual(plan.toUnload, []);
  assert.deepEqual(plan.unchanged.sort(), ['a', 'b']);
});

test('diffChainReconciliation: skips malformed items (no instanceId or pluginId)', () => {
  const plan = diffChainReconciliation(new Set(), [
    { instanceId: '', pluginId: 'vst3:x', enabled: true, order: 0 },
    { instanceId: 'a', pluginId: '', enabled: true, order: 1 },
    { instanceId: 'b', pluginId: 'vst3:y', enabled: true, order: 2 },
  ]);
  assert.deepEqual(plan.toLoad.map((t) => t.instanceId), ['b']);
});

// ---------------------------------------------------------------------------
// Phase 2 — load / unload / reconcile
// ---------------------------------------------------------------------------

function makeLibrary() {
  return {
    plugins: [
      {
        id: 'vst3:abc',
        name: 'Pro-Q 4',
        vendor: 'FabFilter',
        format: 'vst3',
        version: '4.0',
        path: '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 4.vst3',
        categories: ['Fx', 'EQ'],
        isSupported: true,
        failureReason: null,
      },
      {
        id: 'au:def',
        name: 'AUCompressor',
        vendor: 'Apple',
        format: 'au',
        version: '1.0',
        path: '/Library/Audio/Plug-Ins/Components/AUCompressor.component',
        categories: ['Dynamics'],
        isSupported: true,
        failureReason: null,
      },
    ],
    scannedAt: new Date().toISOString(),
    scanVersion: 1,
  };
}

test('loadPlugin tracks the instance id and returns sidecar metadata', async () => {
  const fake = makeFakeChild({
    replies: {
      load_plugin: (req) => ({
        instanceId: req.params.instanceId,
        reportedLatencySamples: 64,
        numInputs: 2,
        numOutputs: 2,
      }),
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  const res = await service.loadPlugin({
    instanceId: 'i-1',
    pluginPath: '/Library/Audio/Plug-Ins/VST3/Pro-Q 4.vst3',
    format: 'vst3',
  });
  assert.equal(res.instanceId, 'i-1');
  assert.equal(res.reportedLatencySamples, 64);
  assert.deepEqual(service.getLoadedInstanceIds(), ['i-1']);
});

test('unloadPlugin drops the instance id from the loaded set', async () => {
  const fake = makeFakeChild({
    replies: {
      load_plugin: (req) => ({ instanceId: req.params.instanceId }),
      unload_plugin: (req) => ({ instanceId: req.params.instanceId, wasLoaded: true }),
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  await service.loadPlugin({ instanceId: 'x', pluginPath: '/p', format: 'vst3' });
  await service.unloadPlugin('x');
  assert.deepEqual(service.getLoadedInstanceIds(), []);
});

test('reconcileTrackChain: loads new slots, unloads removed ones', async () => {
  const calls = { load: [], unload: [] };
  const fake = makeFakeChild({
    replies: {
      load_plugin: (req) => {
        calls.load.push(req.params.instanceId);
        return { instanceId: req.params.instanceId };
      },
      unload_plugin: (req) => {
        calls.unload.push(req.params.instanceId);
        return { instanceId: req.params.instanceId, wasLoaded: true };
      },
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  service.rememberLibrary(makeLibrary());

  // Start with one loaded
  await service.loadPlugin({ instanceId: 'keep-me', pluginPath: '/p', format: 'vst3' });
  calls.load.length = 0;

  const result = await service.reconcileTrackChain({
    songId: 'song-1',
    items: [
      { instanceId: 'keep-me', pluginId: 'vst3:abc', enabled: true, order: 0 },
      { instanceId: 'new-one', pluginId: 'au:def', enabled: false, order: 1 },
    ],
  });
  assert.deepEqual(calls.load, ['new-one']);
  assert.deepEqual(calls.unload, []);
  assert.deepEqual(result.loaded, ['new-one']);
  assert.deepEqual(result.failed, []);
});

test('reconcileTrackChain: applies persisted plugin state after loading a slot', async () => {
  const calls = { load: [], setState: [] };
  const fake = makeFakeChild({
    replies: {
      load_plugin: (req) => {
        calls.load.push(req.params.instanceId);
        return { instanceId: req.params.instanceId };
      },
      set_plugin_state: (req) => {
        calls.setState.push({
          instanceId: req.params.instanceId,
          stateBase64: req.params.stateBase64,
        });
        return {};
      },
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  service.rememberLibrary(makeLibrary());

  const result = await service.reconcileTrackChain({
    songId: 'song-1',
    items: [
      {
        instanceId: 'with-state',
        pluginId: 'vst3:abc',
        enabled: true,
        order: 0,
        state: 'saved-plugin-state',
      },
    ],
  });

  assert.deepEqual(calls.load, ['with-state']);
  assert.deepEqual(calls.setState, [
    { instanceId: 'with-state', stateBase64: 'saved-plugin-state' },
  ]);
  assert.deepEqual(result.loaded, ['with-state']);
  assert.deepEqual(result.failed, []);
});

test('reconcileTrackChain: empty chain unloads all instances (invariant: no plugins → no effect)', async () => {
  const calls = { load: [], unload: [] };
  const fake = makeFakeChild({
    replies: {
      load_plugin: (req) => { calls.load.push(req.params.instanceId); return { instanceId: req.params.instanceId }; },
      unload_plugin: (req) => { calls.unload.push(req.params.instanceId); return { instanceId: req.params.instanceId, wasLoaded: true }; },
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  service.rememberLibrary(makeLibrary());
  await service.loadPlugin({ instanceId: 'a', pluginPath: '/p', format: 'vst3' });
  await service.loadPlugin({ instanceId: 'b', pluginPath: '/p', format: 'vst3' });

  await service.reconcileTrackChain({ songId: 's', items: [] });
  assert.deepEqual(calls.unload.sort(), ['a', 'b']);
  assert.deepEqual(service.getLoadedInstanceIds(), []);
});

test('reconcileTrackChain: missing cached library → slot flagged as failed, chain still advances', async () => {
  const fake = makeFakeChild({
    replies: {
      load_plugin: (req) => ({ instanceId: req.params.instanceId }),
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  // No rememberLibrary call, so pluginId → path lookup will fail.
  const result = await service.reconcileTrackChain({
    songId: 's',
    items: [{ instanceId: 'x', pluginId: 'vst3:abc', enabled: true, order: 0 }],
  });
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /not found in cached library/);
  assert.deepEqual(result.loaded, []);
});

test('reconcileTrackChain serializes rapid add/remove so stale loads are unloaded', async () => {
  const calls = { load: [], unload: [] };
  const fake = makeFakeChild({
    replies: {
      load_plugin: (req) =>
        new Promise((resolve) => {
          setTimeout(() => {
            calls.load.push(req.params.instanceId);
            resolve({ instanceId: req.params.instanceId });
          }, 25);
        }),
      unload_plugin: (req) => {
        calls.unload.push(req.params.instanceId);
        return { instanceId: req.params.instanceId, wasLoaded: true };
      },
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  service.rememberLibrary(makeLibrary());

  const add = service.reconcileTrackChain({
    songId: 's',
    items: [{ instanceId: 'stale', pluginId: 'vst3:abc', enabled: true, order: 0 }],
  });
  const clear = service.reconcileTrackChain({ songId: 's', items: [] });

  await Promise.all([add, clear]);
  assert.deepEqual(calls.load, ['stale']);
  assert.deepEqual(calls.unload, ['stale']);
  assert.deepEqual(service.getLoadedInstanceIds(), []);
});

// ---------------------------------------------------------------------------
// Phase 2 — processBlock + empty-chain bypass
// ---------------------------------------------------------------------------

test('processBlock round-trips base64 buffer through the sidecar', async () => {
  const fake = makeFakeChild({
    replies: {
      process_block: (req) => ({
        channels: req.params.channels,
        frames: req.params.frames,
        bufferBase64: req.params.bufferBase64, // echo
        processedSlots: req.params.chain.filter((c) => c.enabled).length,
      }),
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  const res = await service.processBlock({
    chain: [
      { instanceId: 'a', enabled: true },
      { instanceId: 'b', enabled: false },
    ],
    bufferBase64: 'AAAAAA==', // 4 bytes → 1 float32 frame
    frames: 1,
    channels: 1,
  });
  assert.equal(res.frames, 1);
  assert.equal(res.processedSlots, 1);
  assert.equal(res.bufferBase64, 'AAAAAA==');
});

test('processBlock with an all-disabled chain still gets ok:true (sidecar passthrough)', async () => {
  const fake = makeFakeChild({
    replies: {
      process_block: (req) => ({
        channels: 2,
        frames: req.params.frames,
        bufferBase64: req.params.bufferBase64,
        processedSlots: 0,
      }),
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  const res = await service.processBlock({
    chain: [{ instanceId: 'a', enabled: false }, { instanceId: 'b', enabled: false }],
    bufferBase64: 'AAAAAA==',
    frames: 1,
    channels: 1,
  });
  assert.equal(res.processedSlots, 0);
});

test('processBlock with an empty chain is a pure passthrough (zero slots processed)', async () => {
  const fake = makeFakeChild({
    replies: {
      process_block: (req) => ({
        channels: 2,
        frames: req.params.frames,
        bufferBase64: req.params.bufferBase64,
        processedSlots: 0,
      }),
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  const res = await service.processBlock({
    chain: [],
    bufferBase64: 'AAAAAA==',
    frames: 1,
    channels: 1,
  });
  assert.equal(res.processedSlots, 0);
});

// ---------------------------------------------------------------------------
// Phase 2 — parameter + state wrappers
// ---------------------------------------------------------------------------

test('setParameter / getParameter round-trip', async () => {
  let stored = 0.25;
  const fake = makeFakeChild({
    replies: {
      set_parameter: (req) => { stored = req.params.value; return {}; },
      get_parameter: () => ({ value: stored }),
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  await service.setParameter('i', 3, 0.75);
  const v = await service.getParameter('i', 3);
  assert.equal(v, 0.75);
});

// ---------------------------------------------------------------------------
// v3.42 Phase 3 — native editor window open/close + editor_closed events.
// ---------------------------------------------------------------------------

test('openPluginEditor sends open_editor and tracks the id', async () => {
  const fake = makeFakeChild({
    replies: {
      open_editor: (req) => ({ instanceId: req.params.instanceId, alreadyOpen: false }),
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  const res = await service.openPluginEditor('inst-1');
  assert.equal(res.instanceId, 'inst-1');
  assert.equal(res.alreadyOpen, false);
  assert.deepEqual(service.getOpenEditorIds(), ['inst-1']);
});

test('closePluginEditor sends close_editor and drops the id', async () => {
  const fake = makeFakeChild({
    replies: {
      open_editor: (req) => ({ instanceId: req.params.instanceId, alreadyOpen: false }),
      close_editor: (req) => ({ instanceId: req.params.instanceId, wasOpen: true }),
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  await service.openPluginEditor('inst-1');
  await service.closePluginEditor('inst-1');
  assert.deepEqual(service.getOpenEditorIds(), []);
});

test('editor_closed sidecar events fire onEditorClosed listeners and clear state', async () => {
  const fake = makeFakeChild({
    replies: {
      open_editor: (req) => ({ instanceId: req.params.instanceId, alreadyOpen: false }),
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  const closedIds = [];
  const unsub = service.onEditorClosed((id) => closedIds.push(id));
  await service.openPluginEditor('inst-x');
  // Push an unsolicited editor_closed event down the fake stdout.
  fake.stdout.write(
    `${JSON.stringify({ event: 'editor_closed', instanceId: 'inst-x' })}\n`,
  );
  // Give the event loop a tick to deliver the line.
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(closedIds, ['inst-x']);
  assert.deepEqual(service.getOpenEditorIds(), []);
  unsub();
});

test('unloadPlugin removes any tracked open-editor state for the same id', async () => {
  const fake = makeFakeChild({
    replies: {
      open_editor: (req) => ({ instanceId: req.params.instanceId, alreadyOpen: false }),
      unload_plugin: (req) => ({ instanceId: req.params.instanceId, wasLoaded: true }),
      load_plugin: (req) => ({ instanceId: req.params.instanceId }),
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  await service.loadPlugin({ instanceId: 'inst-1', pluginPath: '/p', format: 'vst3' });
  await service.openPluginEditor('inst-1');
  await service.unloadPlugin('inst-1');
  assert.deepEqual(service.getOpenEditorIds(), []);
});

test('get/setPluginState round-trip', async () => {
  let stored = '';
  const fake = makeFakeChild({
    replies: {
      get_plugin_state: () => ({ stateBase64: stored }),
      set_plugin_state: (req) => { stored = req.params.stateBase64; return {}; },
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  await service.setPluginState('i', 'SGVsbG8=');
  const state = await service.getPluginState('i');
  assert.equal(state, 'SGVsbG8=');
});
