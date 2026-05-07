// v3.145 — the user-facing background-precompute pause toggle was removed.
//
// Coverage for the legacy `agentBackgroundPrecomputeEnabled` field now pins the
// migration behavior: fresh state is ON, malformed/missing values are ON, and an
// older persisted `false` is sanitized back to ON so startup warmup cannot stay
// accidentally disabled after upgrade.

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-bg-precompute-migrate-'));
}

test('createDefaultUserState — bg-precompute legacy field defaults to ON', () => {
  const fresh = createDefaultUserState();
  assert.equal(
    fresh.agentBackgroundPrecomputeEnabled,
    true,
    'fresh install must default to bg precompute ON for startup warmup',
  );
});

test('parseUserState — keeps persisted `true` enabled', () => {
  const parsed = parseUserState({
    schemaVersion: 1,
    agentBackgroundPrecomputeEnabled: true,
  });
  assert.equal(parsed.agentBackgroundPrecomputeEnabled, true);
});

test('parseUserState — migrates persisted `false` back to enabled', () => {
  const parsed = parseUserState({
    schemaVersion: 1,
    agentBackgroundPrecomputeEnabled: false,
  });
  assert.equal(parsed.agentBackgroundPrecomputeEnabled, true);
});

test('parseUserState — falls back to ON on malformed values', () => {
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

test('UserStateService — older paused false state is sanitized on read', async () => {
  const dir = mktmp();
  try {
    const service = new UserStateService(dir);
    const initial = await service.readUserState();
    assert.equal(initial.agentBackgroundPrecomputeEnabled, true);

    await service.writeUserState({
      ...initial,
      agentBackgroundPrecomputeEnabled: false,
    });

    const reloaded = new UserStateService(dir);
    reloaded.invalidateCache();
    const restored = await reloaded.readUserState();
    assert.equal(
      restored.agentBackgroundPrecomputeEnabled,
      true,
      'legacy paused state must not survive a service restart',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UserStateService — enabled true round-trips through write→read', async () => {
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
