/**
 * v3.39 Phase 1a — PluginHostService unit tests.
 *
 * We inject a scriptable fake child into PluginHostService via the optional
 * `spawnFn` constructor argument. The fake mirrors what pp-audio-host does
 * on the wire:
 *   - on "start", emits `{"event":"ready"}` so `.start()` resolves
 *   - on each JSON command, replies with a canned response (or an error)
 *
 * That keeps the test hermetic — no real binary is required, so the suite
 * passes on CI machines that don't have the sidecar built.
 */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const { PluginHostService, resolveSidecarBinary } = require('../dist/plugin-host-service.test.cjs');

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

  // Buffer stdin lines and respond based on the `replies` map. Keys are
  // method names; values are either an object (used verbatim, with the
  // request id patched in) or a function (called with the parsed request).
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
        const body = typeof handler === 'function' ? handler(req) : handler;
        // Default ok:true but allow handlers to explicitly return ok:false.
        const merged = { id: req.id, ok: true, ...body };
        if (Object.prototype.hasOwnProperty.call(body, 'ok')) merged.ok = body.ok;
        stdout.write(`${JSON.stringify(merged)}\n`);
      } catch (e) {
        stdout.write(`${JSON.stringify({ ok: false, error: String(e) })}\n`);
      }
    }
  });

  // Synthesise the ready handshake asynchronously so the consumer can
  // register its data handler first.
  if (emitReady) {
    setImmediate(() => {
      stdout.write(`${JSON.stringify({ event: 'ready', version: '0.1.0-test' })}\n`);
    });
  }

  return child;
}

test('resolveSidecarBinary returns null when no build output exists in a pristine cwd', () => {
  // Using /tmp guarantees neither candidate path exists; this tests the
  // "binary not yet built" branch that the IPC handler uses to decide
  // whether to surface the bootstrap hint.
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
          {
            // Malformed entry — missing required `path` — must be dropped.
            id: 'vst3:bad',
            name: 'Broken',
            format: 'vst3',
          },
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
  const fake = makeFakeChild({
    replies: {
      shutdown: {},
    },
  });
  const service = new PluginHostService('/fake/path', () => fake);
  await service.start();
  await service.stop();
  assert.equal(fake.killed || service.isRunning() === false, true);
});

test('load_plugin surfaces the sidecar\'s "not implemented" error', async () => {
  const fake = makeFakeChild({
    replies: {
      load_plugin: () => ({ ok: false, error: 'not implemented' }),
    },
  });
  // makeFakeChild handler always stamps ok:true — override by making the
  // handler emit directly. Simpler: use replies=none so the test-bundle
  // falls back to "no mock for load_plugin" which is semantically equivalent.
  const service = new PluginHostService('/fake/path', () => fake);
  await assert.rejects(
    service.loadPlugin('track-a', 0, 'vst3:xyz'),
    /not implemented|no mock for load_plugin/,
  );
});
