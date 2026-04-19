/**
 * v3.34 — Spectrum legacy-migration edge cases.
 *
 * Tier: SHOULD-ADD (from TEST_COVERAGE_AUDIT_2026-04-19.md, Codex SHOULD-ADD
 * #5). Covers the post-v3.32 surface when the legacy aiEqRecommendations
 * map is partially valid / mixed with fresh recs for non-spectrum metrics.
 *
 * The v3.32 renderer-side migration walks `userState.aiEqRecommendations`
 * and calls `setAiRecommendation(songId, 1, spectrum_eq_band_N, rec)` per
 * band. These tests exercise the state-service contracts that migration
 * relies on:
 *
 *   1. Mixed fresh (non-spectrum) + stale (spectrum) recs for the same
 *      (songId, versionNumber) slot — `aiRecommendedFlag` respects the
 *      fresh sibling and doesn't get stomped by the stale band writes.
 *   2. Migrating one song's legacy bands does NOT touch another song's
 *      fresh recs.
 *   3. Per-band writes can partially fail (e.g. only 4 of 6 bands are
 *      valid numbers in the legacy map) without the whole set going
 *      missing — each `setAiRecommendation` call is independent.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  UserStateService,
  migrateStateIfNeeded,
} = require('../dist/state-service.test.cjs');

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-spectrum-edges-'));
}

async function reloadService(stateDir) {
  const service = new UserStateService(stateDir);
  service.invalidateCache();
  return service;
}

function makeStaleBand(bandIndex, gainDb) {
  return {
    recommendedValue: `${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB on band ${bandIndex}`,
    recommendedRawValue: gainDb,
    reason: `Legacy band ${bandIndex}.`,
    model: 'legacy-migration',
    requestId: `band-${bandIndex}`,
    analysisVersion: 'legacy-pre-v3.30',
    generatedAt: 1_745_000_000_000,
    status: 'stale',
  };
}

function makeFresh(metricId, rawValue) {
  return {
    recommendedValue: `${rawValue}`,
    recommendedRawValue: rawValue,
    reason: `Fresh rec for ${metricId}`,
    model: 'agent-live',
    requestId: `fresh-${metricId}`,
    analysisVersion: 'analysis-v1',
    generatedAt: 1_745_000_100_000,
    status: 'fresh',
  };
}

test('mixed slot: stale spectrum bands + fresh non-spectrum metric — flag tracks the fresh sibling', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const svc = new UserStateService(tmp);

    // Fresh mastering rec lands first.
    await svc.setAiRecommendation('song-a', 1, 'integrated_lufs', makeFresh('integrated_lufs', -14.0));

    // Then legacy Spectrum migration overlays stale band recs.
    for (let i = 0; i < 6; i += 1) {
      await svc.setAiRecommendation('song-a', 1, `spectrum_eq_band_${i}`, makeStaleBand(i, i - 2));
    }

    const reader = await reloadService(tmp);
    const state = await reader.readUserState();
    const slot = state.perTrackAiRecommendations['song-a']['1'];

    assert.ok(slot, 'slot exists');
    // 7 total: 1 fresh mastering + 6 stale spectrum.
    assert.equal(Object.keys(slot.recommendations).length, 7);
    // Flag remains true because integrated_lufs is fresh.
    assert.equal(slot.aiRecommendedFlag, true, 'fresh sibling keeps flag on');
    // Verify each rec's status is correctly preserved.
    assert.equal(slot.recommendations.integrated_lufs.status, 'fresh');
    for (let i = 0; i < 6; i += 1) {
      assert.equal(
        slot.recommendations[`spectrum_eq_band_${i}`].status,
        'stale',
        `band ${i} stays stale`,
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('migrating one song\'s legacy bands does not affect another song\'s fresh recs', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const svc = new UserStateService(tmp);

    // song-b has a fresh rec.
    await svc.setAiRecommendation('song-b', 1, 'integrated_lufs', makeFresh('int', -13.0));

    // Migrate legacy bands for song-a only.
    for (let i = 0; i < 6; i += 1) {
      await svc.setAiRecommendation('song-a', 1, `spectrum_eq_band_${i}`, makeStaleBand(i, 0));
    }

    const reader = await reloadService(tmp);
    const state = await reader.readUserState();

    // song-b unaffected.
    const bSlot = state.perTrackAiRecommendations['song-b']['1'];
    assert.ok(bSlot, 'song-b slot preserved');
    assert.equal(bSlot.aiRecommendedFlag, true);
    assert.equal(bSlot.recommendations.integrated_lufs.status, 'fresh');

    // song-a has only the 6 stale bands, flag off.
    const aSlot = state.perTrackAiRecommendations['song-a']['1'];
    assert.ok(aSlot);
    assert.equal(aSlot.aiRecommendedFlag, false);
    assert.equal(Object.keys(aSlot.recommendations).length, 6);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('partial band migration (4 of 6 bands valid): the 4 still land in the unified store', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const svc = new UserStateService(tmp);

    // Simulate a legacy map where bands 2 and 4 had non-number gains that
    // the renderer migration skipped. 4 of 6 per-band writes reach the
    // state service.
    const validIndices = [0, 1, 3, 5];
    for (const i of validIndices) {
      await svc.setAiRecommendation('song-a', 1, `spectrum_eq_band_${i}`, makeStaleBand(i, i));
    }

    const reader = await reloadService(tmp);
    const state = await reader.readUserState();
    const slot = state.perTrackAiRecommendations['song-a']['1'];
    assert.ok(slot);
    assert.equal(Object.keys(slot.recommendations).length, 4);
    for (const i of validIndices) {
      assert.ok(slot.recommendations[`spectrum_eq_band_${i}`], `band ${i} migrated`);
    }
    // Bands 2 and 4 absent — no fabricated zeros.
    assert.equal(slot.recommendations.spectrum_eq_band_2, undefined);
    assert.equal(slot.recommendations.spectrum_eq_band_4, undefined);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('second migration pass with same data is idempotent at the state-service level', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const svc = new UserStateService(tmp);

    // First pass: migrate 6 bands.
    for (let i = 0; i < 6; i += 1) {
      await svc.setAiRecommendation('song-a', 1, `spectrum_eq_band_${i}`, makeStaleBand(i, i));
    }
    const firstRead = await (await reloadService(tmp)).readUserState();
    const firstSlot = firstRead.perTrackAiRecommendations['song-a']['1'];

    // Second pass with the same recs.
    for (let i = 0; i < 6; i += 1) {
      await svc.setAiRecommendation('song-a', 1, `spectrum_eq_band_${i}`, makeStaleBand(i, i));
    }
    const secondRead = await (await reloadService(tmp)).readUserState();
    const secondSlot = secondRead.perTrackAiRecommendations['song-a']['1'];

    // Shape stable.
    assert.equal(Object.keys(secondSlot.recommendations).length, 6);
    assert.equal(secondSlot.aiRecommendedFlag, firstSlot.aiRecommendedFlag, 'flag unchanged');
    for (let i = 0; i < 6; i += 1) {
      assert.equal(
        secondSlot.recommendations[`spectrum_eq_band_${i}`].recommendedRawValue,
        i,
        `band ${i} value stable`,
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
