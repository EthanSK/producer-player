const assert = require('node:assert/strict');
const test = require('node:test');

const {
  runJs,
  screenshot,
  domSnapshot,
  buildDomSnapshotScript,
  RUN_JS_DEFAULT_TIMEOUT_MS,
  RUN_JS_MAX_CODE_BYTES,
  RUN_JS_MAX_RESULT_BYTES,
  SCREENSHOT_MAX_BYTES,
  DOM_SNAPSHOT_DEFAULT_MAX_NODES,
  DOM_SNAPSHOT_HARD_MAX_NODES,
} = require('../dist/agent-ui-control.test.cjs');

// --- runJs ----------------------------------------------------------------

test('runJs rejects empty code', async () => {
  const result = await runJs(
    { code: '' },
    { executeJavaScript: async () => 1 },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Missing/i);
});

test('runJs returns the parsed value on success', async () => {
  const result = await runJs(
    { code: '({a:1,b:[2,3]})' },
    { executeJavaScript: async () => ({ a: 1, b: [2, 3] }) },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 1, b: [2, 3] });
});

test('runJs serializes circular refs without throwing', async () => {
  const a = { name: 'a' };
  a.self = a;
  const result = await runJs(
    { code: 'window' },
    { executeJavaScript: async () => a },
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.name, 'a');
  assert.equal(result.value.self, '[Circular]');
});

test('runJs enforces the code length cap', async () => {
  const huge = 'a'.repeat(RUN_JS_MAX_CODE_BYTES + 1);
  const result = await runJs(
    { code: huge },
    { executeJavaScript: async () => null },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /byte limit/);
});

test('runJs enforces the result size cap', async () => {
  const big = 'x'.repeat(RUN_JS_MAX_RESULT_BYTES + 100);
  const result = await runJs(
    { code: 'doc.body.innerHTML' },
    { executeJavaScript: async () => big },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Result exceeds/);
});

test('runJs enforces the timeout', async () => {
  const result = await runJs(
    { code: 'never', timeoutMs: 25 },
    {
      executeJavaScript: () =>
        new Promise((resolve) => setTimeout(() => resolve('late'), 250)),
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
});

test('runJs default timeout is the documented value', () => {
  assert.equal(RUN_JS_DEFAULT_TIMEOUT_MS, 5000);
});

test('runJs propagates renderer errors as ok:false', async () => {
  const result = await runJs(
    { code: 'throw new Error("boom")' },
    {
      executeJavaScript: async () => {
        throw new Error('boom');
      },
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /boom/);
});

// --- screenshot -----------------------------------------------------------

function fakeImage(byteLength, w = 1440, h = 900) {
  return {
    toPNG: () => Buffer.alloc(byteLength, 0),
    getSize: () => ({ width: w, height: h }),
  };
}

test('screenshot returns data URL on success', async () => {
  const result = await screenshot(
    {},
    { webContents: { capturePage: async () => fakeImage(1024) } },
  );
  assert.equal(result.ok, true);
  assert.ok(result.dataUrl.startsWith('data:image/png;base64,'));
  assert.equal(result.byteLength, 1024);
  assert.equal(result.width, 1440);
  assert.equal(result.height, 900);
});

test('screenshot enforces size cap', async () => {
  const result = await screenshot(
    {},
    { webContents: { capturePage: async () => fakeImage(SCREENSHOT_MAX_BYTES + 1) } },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /exceeds/);
});

test('screenshot returns ok:false on capture failure', async () => {
  const result = await screenshot(
    {},
    {
      webContents: {
        capturePage: async () => {
          throw new Error('display sleeping');
        },
      },
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /display sleeping/);
});

// --- domSnapshot ----------------------------------------------------------

test('buildDomSnapshotScript inlines safe arguments', () => {
  const s = buildDomSnapshotScript('#root', 100);
  // The selector must be JSON-quoted to survive the Function call.
  assert.match(s, /"#root"/);
  assert.match(s, /, 100\)/);
});

test('buildDomSnapshotScript clamps maxNodes to the hard cap', () => {
  const s = buildDomSnapshotScript(undefined, 99_999);
  assert.match(s, new RegExp(`, ${DOM_SNAPSHOT_HARD_MAX_NODES}\\)`));
});

test('domSnapshot returns shaped result on success', async () => {
  const fakeRoot = {
    tag: 'body',
    testid: null,
    role: null,
    label: null,
    text: null,
    type: null,
    disabled: false,
    bounds: null,
    children: [
      {
        tag: 'button',
        testid: 'play-button',
        role: null,
        label: 'Play',
        text: null,
        type: null,
        disabled: false,
        bounds: { x: 0, y: 0, w: 40, h: 40 },
        children: [],
      },
    ],
  };
  const result = await domSnapshot(
    {},
    {
      executeJavaScript: async () => ({
        root: fakeRoot,
        nodeCount: 1,
        truncated: false,
      }),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.nodeCount, 1);
  assert.equal(result.truncated, false);
  assert.equal(result.root.children[0].testid, 'play-button');
});

test('domSnapshot surfaces walker error string', async () => {
  const result = await domSnapshot(
    { rootSelector: '#missing' },
    { executeJavaScript: async () => ({ error: 'Root not found: #missing' }) },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Root not found/);
});

test('domSnapshot surfaces executeJavaScript error', async () => {
  const result = await domSnapshot(
    {},
    {
      executeJavaScript: async () => {
        throw new Error('renderer crashed');
      },
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /renderer crashed/);
});

test('default node cap is the documented value', () => {
  assert.equal(DOM_SNAPSHOT_DEFAULT_MAX_NODES, 500);
});
