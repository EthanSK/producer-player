// v3.120 (Item #14 follow-up) — persistence coverage for the
// `agentBackgroundPrecomputeEnabled` user-state toggle.
//
// The toggle MUST round-trip through the unified-state persistence layer
// so a paused state survives app relaunch (Ethan's explicit ask: "if it
// stops, it should just stay stopped until they turn it on, and it
// should persist throughout that pre-start"). We exercise both
// directions:
//   1. `parseUserState` accepts persisted booleans, falls back safely on
//      malformed values (string, number, undefined, null) so a corrupt
//      file never wedges precompute on or off in an unexpected state.
//   2. `createDefaultUserState` returns ON — fresh installs keep the
//      historical precompute behavior so users get fast track switches
//      out of the box.
//   3. `UserStateService.writeUserState` + `readUserState` round-trip
//      preserves the boolean so a user who paused precompute sees it
//      still paused after restart.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  UserStateService,
  parseUserState,
  createDefaultUserState,
} = require('../dist/state-service.test.cjs');

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-bg-precompute-persist-'));
}

test('createDefaultUserState — bg-precompute defaults to ON', () => {
  const fresh = createDefaultUserState();
  assert.equal(
    fresh.agentBackgroundPrecomputeEnabled,
    true,
    'fresh install must default to bg precompute ON for fast track switches',
  );
});

test('parseUserState — accepts persisted `true`', () => {
  const parsed = parseUserState({
    schemaVersion: 1,
    agentBackgroundPrecomputeEnabled: true,
  });
  assert.equal(parsed.agentBackgroundPrecomputeEnabled, true);
});

test('parseUserState — accepts persisted `false` (paused state)', () => {
  const parsed = parseUserState({
    schemaVersion: 1,
    agentBackgroundPrecomputeEnabled: false,
  });
  assert.equal(parsed.agentBackgroundPrecomputeEnabled, false);
});

test('parseUserState — falls back to ON on malformed values', () => {
  // Malformed values must NOT silently wedge bg precompute off — we want
  // the safe historical default (ON) when the persisted value is unparseable.
  for (const value of ['true', 1, 0, null, undefined, {}, []]) {
    const parsed = parseUserState({
      schemaVersion: 1,
      agentBackgroundPrecomputeEnabled: value,
    });
    assert.equal(
      parsed.agentBackgroundPrecomputeEnabled,
      true,
      `malformed value ${JSON.stringify(value)} must fall back to ON (default)`,
    );
  }
});

test('parseUserState — missing key falls back to ON', () => {
  const parsed = parseUserState({ schemaVersion: 1 });
  assert.equal(
    parsed.agentBackgroundPrecomputeEnabled,
    true,
    'pre-v3.120 state files (no key) must default to ON on load',
  );
});

test('UserStateService — paused (false) round-trips through write→read', async () => {
  const dir = mktmp();
  try {
    const service = new UserStateService(dir);
    const initial = await service.readUserState();
    assert.equal(initial.agentBackgroundPrecomputeEnabled, true);

    await service.writeUserState({
      ...initial,
      agentBackgroundPrecomputeEnabled: false,
    });

    // Reload to confirm the value comes back from disk, not just memory.
    const reloaded = new UserStateService(dir);
    reloaded.invalidateCache();
    const restored = await reloaded.readUserState();
    assert.equal(
      restored.agentBackgroundPrecomputeEnabled,
      false,
      'paused state must survive a service restart',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UserStateService — resumed (true) round-trips through write→read', async () => {
  const dir = mktmp();
  try {
    const service = new UserStateService(dir);
    const initial = await service.readUserState();
    await service.writeUserState({
      ...initial,
      agentBackgroundPrecomputeEnabled: true,
    });

    const reloaded = new UserStateService(dir);
    reloaded.invalidateCache();
    const restored = await reloaded.readUserState();
    assert.equal(restored.agentBackgroundPrecomputeEnabled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
