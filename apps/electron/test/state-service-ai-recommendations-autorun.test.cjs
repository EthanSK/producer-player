/**
 * v3.33 Phase 4 — AI mastering recommendations auto-run semantics.
 *
 * These tests exercise the state-service surface that the Phase 4 renderer
 * flow in `App.tsx` depends on:
 *
 *   1. `aiRecommendedFlag` transitions as fresh recs land and are cleared or
 *      flipped to stale.
 *   2. `markAiRecommendationsStale` behaviour when the analysis fingerprint
 *      for a (songId, versionNumber) pair changes between runs — the fresh
 *      recs flip to stale and the flag clears so the next auto-run gate
 *      sees `aiRecommendedFlag: false` and can proceed.
 *   3. `agentAutoRecommendEnabled` default + round-trip through parseUserState
 *      so the new global gate survives restart / export-import.
 *
 * All scenarios round-trip through disk via `writeUserState` / `readUserState`
 * after invalidating the in-memory cache so the contract is persistence, not
 * just in-memory mutation.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  UserStateService,
  migrateStateIfNeeded,
  parseUserState,
  createDefaultUserState,
} = require('../dist/state-service.test.cjs');

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ai-rec-autorun-'));
}

function makeRec(overrides = {}) {
  return {
    recommendedValue: '-14.0 LUFS',
    recommendedRawValue: -14.0,
    reason: 'Streaming-target headroom.',
    model: 'claude-opus-4-6',
    requestId: 'req-autorun-1',
    analysisVersion: 'analysis-v1',
    generatedAt: 1745_000_000_000,
    status: 'fresh',
    ...overrides,
  };
}

async function reloadService(stateDir) {
  const service = new UserStateService(stateDir);
  service.invalidateCache();
  return service;
}

test('aiRecommendedFlag flips true after a fresh auto-run and false after clear', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const writer = new UserStateService(tmp);

    // Simulate the Phase 4 auto-run dispatching two metrics.
    await writer.setAiRecommendation(
      'song-alpha',
      2,
      'integrated_lufs',
      makeRec({ requestId: 'req-alpha-1', generatedAt: 10 }),
    );
    await writer.setAiRecommendation(
      'song-alpha',
      2,
      'true_peak',
      makeRec({
        requestId: 'req-alpha-1',
        generatedAt: 11,
        recommendedValue: '-1.0 dBTP',
      }),
    );

    let state = await (await reloadService(tmp)).readUserState();
    let slot = state.perTrackAiRecommendations['song-alpha']['2'];
    assert.equal(slot.aiRecommendedFlag, true, 'flag flips on after first fresh run');
    assert.equal(Object.keys(slot.recommendations).length, 2);

    // Auto-run gate should skip a second run while flag is on — we model
    // that on the renderer side. The state-service side exposes `clearAi`
    // for the regenerate button which drops the flag back to false.
    const clearWriter = new UserStateService(tmp);
    await clearWriter.clearAiRecommendations('song-alpha', 2);

    state = await (await reloadService(tmp)).readUserState();
    assert.equal(
      state.perTrackAiRecommendations['song-alpha'],
      undefined,
      'clearing every rec deletes the song map so the auto-run gate re-opens',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stale detection on analysisVersion change flips fresh recs to stale and clears the flag', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const writer = new UserStateService(tmp);

    // Two fresh recs under analysis-v1.
    await writer.setAiRecommendation(
      'song-beta',
      3,
      'integrated_lufs',
      makeRec({ analysisVersion: 'analysis-v1', generatedAt: 100 }),
    );
    await writer.setAiRecommendation(
      'song-beta',
      3,
      'true_peak',
      makeRec({
        analysisVersion: 'analysis-v1',
        generatedAt: 101,
        recommendedValue: '-1.0 dBTP',
      }),
    );

    // Now the mix changes — new analysis fingerprint.
    await writer.markAiRecommendationsStale('song-beta', 3, 'analysis-v2');

    const reader = await reloadService(tmp);
    const state = await reader.readUserState();
    const slot = state.perTrackAiRecommendations['song-beta']['3'];

    assert.ok(slot, 'slot is preserved (recs are KEPT, not deleted)');
    assert.equal(
      slot.aiRecommendedFlag,
      false,
      'flag clears when every rec becomes stale so the auto-run gate re-opens',
    );
    assert.equal(slot.recommendations.integrated_lufs.status, 'stale');
    assert.equal(slot.recommendations.true_peak.status, 'stale');
    // analysisVersion on each rec is PRESERVED (not rewritten). That lets a
    // later fresh run detect which recs need re-computing.
    assert.equal(
      slot.recommendations.integrated_lufs.analysisVersion,
      'analysis-v1',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a fresh rec under the new analysisVersion after stale detection flips the flag back on', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const writer = new UserStateService(tmp);

    await writer.setAiRecommendation(
      'song-gamma',
      1,
      'integrated_lufs',
      makeRec({ analysisVersion: 'analysis-v1', generatedAt: 1 }),
    );
    await writer.markAiRecommendationsStale('song-gamma', 1, 'analysis-v2');

    // Simulate the Phase 4 auto-run re-firing under the new fingerprint.
    await writer.setAiRecommendation(
      'song-gamma',
      1,
      'integrated_lufs',
      makeRec({
        analysisVersion: 'analysis-v2',
        generatedAt: 2,
        requestId: 'req-gamma-v2',
        recommendedValue: '-12.0 LUFS',
      }),
    );

    const state = await (await reloadService(tmp)).readUserState();
    const slot = state.perTrackAiRecommendations['song-gamma']['1'];
    assert.equal(slot.aiRecommendedFlag, true, 'flag flips back on with a fresh v2 rec');
    assert.equal(slot.recommendations.integrated_lufs.status, 'fresh');
    assert.equal(slot.recommendations.integrated_lufs.analysisVersion, 'analysis-v2');
    assert.equal(
      slot.recommendations.integrated_lufs.recommendedValue,
      '-12.0 LUFS',
      'fresh rec overwrites the prior stale one',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('agentAutoRecommendEnabled defaults to false and round-trips through parseUserState', async () => {
  // v3.63 — default OFF. Ethan's call: don't auto-burn agent credits on
  // song open; users opt in via AgentSettings. The ✨ AI Stars button in the
  // mastering fullscreen header is the explicit trigger.
  // 1. Default state has the flag OFF — first-time users opt IN to auto-run.
  const defaultState = createDefaultUserState();
  assert.equal(defaultState.agentAutoRecommendEnabled, false);

  // 2. Explicit `true` round-trips.
  const onState = parseUserState({
    ...defaultState,
    agentAutoRecommendEnabled: true,
  });
  assert.equal(onState.agentAutoRecommendEnabled, true);

  // 3. Missing field falls back to the default (OFF) so older state files
  //    inherit the new conservative default on upgrade.
  const legacyRaw = { ...defaultState };
  delete legacyRaw.agentAutoRecommendEnabled;
  const legacyParsed = parseUserState(legacyRaw);
  assert.equal(
    legacyParsed.agentAutoRecommendEnabled,
    false,
    'pre-v3.63 state files default OFF after upgrade',
  );

  // 4. Non-boolean values are rejected and fall back to the default.
  const garbageParsed = parseUserState({
    ...defaultState,
    agentAutoRecommendEnabled: 'yes',
  });
  assert.equal(garbageParsed.agentAutoRecommendEnabled, false);
});

test('agentAutoRecommendEnabled survives writeUserState round-trip', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const writer = new UserStateService(tmp);

    const current = await writer.readUserState();
    const next = { ...current, agentAutoRecommendEnabled: false };
    await writer.writeUserState(next);

    const state = await (await reloadService(tmp)).readUserState();
    assert.equal(state.agentAutoRecommendEnabled, false);

    // Flip back on.
    const writer2 = new UserStateService(tmp);
    const current2 = await writer2.readUserState();
    await writer2.writeUserState({
      ...current2,
      agentAutoRecommendEnabled: true,
    });

    const state2 = await (await reloadService(tmp)).readUserState();
    assert.equal(state2.agentAutoRecommendEnabled, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
