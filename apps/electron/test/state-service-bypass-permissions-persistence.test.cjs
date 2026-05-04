// Item #13 (v3.113) — persistence coverage for the
// `agentDangerouslyBypassPermissions` user-state toggle.
//
// The toggle MUST round-trip through the unified-state persistence layer
// so the user's choice survives a relaunch (the whole point of the
// "persisted, opt-in" requirement). We exercise both directions:
//   1. `parseUserState` accepts a stored `true`, falls back safely on
//      malformed values (string, number, undefined, null).
//   2. `createDefaultUserState` returns OFF — a fresh install must NOT
//      ship dangerous-bypass mode pre-enabled.
//   3. `UserStateService.writeUserState` + `readUserState` round-trip
//      preserves the boolean so a user who turned it ON sees it ON after
//      restart.

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-bypass-perm-persist-'));
}

test('createDefaultUserState — bypass-permissions defaults to OFF', () => {
  const fresh = createDefaultUserState();
  assert.equal(
    fresh.agentDangerouslyBypassPermissions,
    false,
    'fresh install must NOT ship dangerous-bypass mode pre-enabled',
  );
});

test('parseUserState — accepts persisted `true`', () => {
  const parsed = parseUserState({
    schemaVersion: 1,
    agentDangerouslyBypassPermissions: true,
  });
  assert.equal(parsed.agentDangerouslyBypassPermissions, true);
});

test('parseUserState — accepts persisted `false`', () => {
  const parsed = parseUserState({
    schemaVersion: 1,
    agentDangerouslyBypassPermissions: false,
  });
  assert.equal(parsed.agentDangerouslyBypassPermissions, false);
});

test('parseUserState — falls back to OFF on malformed values', () => {
  // Each malformed value must NOT accidentally enable dangerous mode.
  for (const value of ['true', 1, 0, null, undefined, {}, []]) {
    const parsed = parseUserState({
      schemaVersion: 1,
      agentDangerouslyBypassPermissions: value,
    });
    assert.equal(
      parsed.agentDangerouslyBypassPermissions,
      false,
      `malformed value ${JSON.stringify(value)} must fall back to OFF`,
    );
  }
});

test('parseUserState — missing key falls back to OFF', () => {
  const parsed = parseUserState({ schemaVersion: 1 });
  assert.equal(
    parsed.agentDangerouslyBypassPermissions,
    false,
    'pre-v3.113 state files (no key) must default to OFF on load',
  );
});

test('UserStateService — bypass=true round-trips through write→read', async () => {
  const dir = mktmp();
  try {
    const service = new UserStateService(dir);
    const initial = await service.readUserState();
    assert.equal(initial.agentDangerouslyBypassPermissions, false);

    await service.writeUserState({
      ...initial,
      agentDangerouslyBypassPermissions: true,
    });

    // Reload to confirm the value comes back from disk, not just memory.
    const reloaded = new UserStateService(dir);
    reloaded.invalidateCache();
    const restored = await reloaded.readUserState();
    assert.equal(
      restored.agentDangerouslyBypassPermissions,
      true,
      'persisted ON value must survive a service restart',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UserStateService — bypass=false round-trips through write→read', async () => {
  const dir = mktmp();
  try {
    const service = new UserStateService(dir);
    const initial = await service.readUserState();
    await service.writeUserState({
      ...initial,
      agentDangerouslyBypassPermissions: false,
    });

    const reloaded = new UserStateService(dir);
    reloaded.invalidateCache();
    const restored = await reloaded.readUserState();
    assert.equal(restored.agentDangerouslyBypassPermissions, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
