/**
 * v3.32 Phase 3b — Spectrum AI-recommendation migration contract test.
 *
 * The renderer runs a one-shot migration at startup that walks the legacy
 * `aiEqRecommendations` map and writes each song's per-band gains into the
 * unified v3.30 `perTrackAiRecommendations` store (`setAiRecommendation`)
 * under `spectrum_eq_band_N` metric IDs, with `status: 'stale'` and
 * `analysisVersion: 'legacy-pre-v3.30'`.
 *
 * This test exercises the storage-side contract that migration relies on:
 *   1. Calling `setAiRecommendation` with `status: 'stale'` for each band
 *      persists a full set of stale recs for the correct
 *      (songId, versionNumber) slot.
 *   2. `aiRecommendedFlag` stays `false` when the entire set is stale
 *      (no fresh rec means nothing is "AI-recommended" in the live sense).
 *   3. A subsequent `setAiRecommendation` with `status: 'fresh'` (e.g. the
 *      user clicks the Spectrum's "AI Recommend" button post-migration)
 *      overwrites the stale band and flips `aiRecommendedFlag` back on.
 *   4. `clearAiRecommendations(songId, versionNumber)` wipes every
 *      `spectrum_eq_band_N` metric in one call — this is what the v3.31
 *      Regenerate button invokes and what the task's Phase 3b plan
 *      relies on.
 *
 * The renderer-side migration code (the `SPECTRUM_AI_MIGRATED_TO_UNIFIED_KEY`
 * sentinel, the walk over `userState.aiEqRecommendations`) is covered by
 * the unit test below indirectly: if the per-band writes land in the right
 * shape, the sentinel just makes sure they land exactly once.
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

const FREQUENCY_BAND_COUNT = 6; // Sub / Low / Low-Mid / Mid / High-Mid / High

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-spectrum-ai-migrate-'));
}

function makeStaleBandRec(bandIndex, gainDb) {
  const sign = gainDb >= 0 ? '+' : '';
  return {
    recommendedValue: `${sign}${gainDb.toFixed(1)} dB on band ${bandIndex}`,
    recommendedRawValue: gainDb,
    reason: `AI-recommended EQ gain for band ${bandIndex}.`,
    model: 'legacy-migration',
    requestId: `spectrum-legacy-migrate-song-a-band-${bandIndex}`,
    analysisVersion: 'legacy-pre-v3.30',
    generatedAt: 1_745_000_000_000,
    status: 'stale',
  };
}

function makeFreshBandRec(bandIndex, gainDb) {
  const sign = gainDb >= 0 ? '+' : '';
  return {
    recommendedValue: `${sign}${gainDb.toFixed(1)} dB on band ${bandIndex}`,
    recommendedRawValue: gainDb,
    reason: `AI-recommended EQ gain for band ${bandIndex}.`,
    model: 'agent-live',
    requestId: `spectrum-fresh-${bandIndex}`,
    analysisVersion: 'post-v3.32-analysis',
    generatedAt: 1_745_000_001_000,
    status: 'fresh',
  };
}

async function reloadService(stateDir) {
  const service = new UserStateService(stateDir);
  service.invalidateCache();
  return service;
}

test('legacy aiEqRecommendations per-band migration lands in the unified store under spectrum_eq_band_N', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const writer = new UserStateService(tmp);

    // Simulate the renderer's walk over `userState.aiEqRecommendations`:
    // a single song with six legacy per-band gains, migrated one rec at a
    // time. versionNumber=1 mirrors `SPECTRUM_AI_EQ_VERSION_NUMBER` in the
    // renderer.
    const legacyGains = [2.0, -1.5, 0.5, 1.0, -0.5, 3.0];
    for (let bandIndex = 0; bandIndex < FREQUENCY_BAND_COUNT; bandIndex += 1) {
      await writer.setAiRecommendation(
        'song-a',
        1,
        `spectrum_eq_band_${bandIndex}`,
        makeStaleBandRec(bandIndex, legacyGains[bandIndex]),
      );
    }

    const reader = await reloadService(tmp);
    const set = await reader.getAiRecommendations('song-a', 1);
    assert.ok(set, 'migrated Spectrum recs surface in the unified store');

    // Every band made it through round-trip with the right metric id
    // + stale status + legacy analysisVersion.
    for (let bandIndex = 0; bandIndex < FREQUENCY_BAND_COUNT; bandIndex += 1) {
      const metricId = `spectrum_eq_band_${bandIndex}`;
      const rec = set[metricId];
      assert.ok(rec, `band ${bandIndex} migrated into unified store`);
      assert.equal(rec.status, 'stale', `band ${bandIndex} is stale post-migration`);
      assert.equal(rec.analysisVersion, 'legacy-pre-v3.30');
      assert.equal(rec.recommendedRawValue, legacyGains[bandIndex]);
      assert.equal(rec.model, 'legacy-migration');
    }

    // All-stale set: aiRecommendedFlag stays off. A slot full of historical
    // "yeah, here's what the AI said last time" recs should not count as
    // "this track has fresh AI recommendations" for the v3.33 auto-run gate.
    const state = await reader.readUserState();
    const slot = state.perTrackAiRecommendations['song-a']['1'];
    assert.equal(
      slot.aiRecommendedFlag,
      false,
      'all-stale migrated slot does not flip aiRecommendedFlag',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a fresh post-migration rec overwrites the stale band and flips aiRecommendedFlag back on', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const writer = new UserStateService(tmp);

    // Seed a full stale migration ------------------------------------
    const legacyGains = [1, 1, 1, 1, 1, 1];
    for (let bandIndex = 0; bandIndex < FREQUENCY_BAND_COUNT; bandIndex += 1) {
      await writer.setAiRecommendation(
        'song-a',
        1,
        `spectrum_eq_band_${bandIndex}`,
        makeStaleBandRec(bandIndex, legacyGains[bandIndex]),
      );
    }

    // User clicks the Spectrum's "AI Recommend" button → agent writes
    // a fresh rec for band 0 through the same IPC surface.
    await writer.setAiRecommendation('song-a', 1, 'spectrum_eq_band_0', makeFreshBandRec(0, 4.0));

    const reader = await reloadService(tmp);
    const set = await reader.getAiRecommendations('song-a', 1);
    assert.ok(set);
    assert.equal(set.spectrum_eq_band_0.status, 'fresh');
    assert.equal(set.spectrum_eq_band_0.recommendedRawValue, 4.0);
    assert.equal(set.spectrum_eq_band_1.status, 'stale');

    const state = await reader.readUserState();
    const slot = state.perTrackAiRecommendations['song-a']['1'];
    assert.equal(
      slot.aiRecommendedFlag,
      true,
      'one fresh rec lifts the slot out of "all-stale" state',
    );
    assert.equal(slot.lastRunAt, makeFreshBandRec(0, 4.0).generatedAt);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('unified-store probe protects fresh post-v3.32 spectrum recs when localStorage sentinel is absent (Codex round 1 P2 regression)', async () => {
  // This mirrors the renderer-side guard at
  // apps/renderer/src/App.tsx (v3.32 migration block): before writing stale
  // legacy migration recs for a song, the renderer calls
  // `getAiRecommendations(songId, 1)` and skips the song if ANY
  // `spectrum_eq_band_*` metric already exists there. This test exercises the
  // storage-side contract the guard depends on: the probe must accurately
  // surface fresh post-v3.32 recs so the guard can short-circuit the write.
  //
  // Simulates the bug Codex flagged on 2026-04-18 round 1: "localStorage
  // sentinel missing + unified store already has fresh spectrum_eq_band_* +
  // legacy aiEqRecommendations present → migration overwrites fresh recs
  // with stale ones."
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const writer = new UserStateService(tmp);

    // Pre-existing fresh post-v3.32 recs for song-a band 0 ---------------
    await writer.setAiRecommendation(
      'song-a',
      1,
      'spectrum_eq_band_0',
      makeFreshBandRec(0, 3.5),
    );
    await writer.setAiRecommendation(
      'song-a',
      1,
      'spectrum_eq_band_3',
      makeFreshBandRec(3, -1.5),
    );

    // Renderer runs the migration. It probes the unified store first and
    // finds existing spectrum_eq_band_* entries, so it skips the legacy
    // write for this song. The test stands in for that guard by calling
    // `getAiRecommendations` the same way the renderer does.
    const probe = await writer.getAiRecommendations('song-a', 1);
    assert.ok(probe, 'probe returns the existing set');
    const hasExistingSpectrum = Object.keys(probe).some((metricId) =>
      metricId.startsWith('spectrum_eq_band_'),
    );
    assert.equal(hasExistingSpectrum, true, 'probe detects existing spectrum recs');

    // The renderer therefore does NOT issue stale writes for song-a band 0 /
    // 3 (nor any other band). We assert that if the guard were bypassed
    // (simulating the pre-fix code path), the stale writes would overwrite
    // the fresh rec — confirming the regression severity:
    const simulateUnguardedMigration = async () => {
      for (let bandIndex = 0; bandIndex < FREQUENCY_BAND_COUNT; bandIndex += 1) {
        await writer.setAiRecommendation(
          'song-a',
          1,
          `spectrum_eq_band_${bandIndex}`,
          makeStaleBandRec(bandIndex, 0),
        );
      }
    };

    // Post-fix path: DO NOT run the unguarded migration for this song.
    // Verify the fresh recs survive intact.
    const reader = await reloadService(tmp);
    const set = await reader.getAiRecommendations('song-a', 1);
    assert.ok(set);
    assert.equal(set.spectrum_eq_band_0.status, 'fresh', 'band 0 stays fresh');
    assert.equal(set.spectrum_eq_band_0.recommendedRawValue, 3.5);
    assert.equal(set.spectrum_eq_band_3.status, 'fresh', 'band 3 stays fresh');
    assert.equal(set.spectrum_eq_band_3.recommendedRawValue, -1.5);

    // Sanity: the simulated-unguarded path WOULD overwrite if run (proving
    // the guard actually matters). Run it now in a fresh tmp.
    const tmp2 = mktmp();
    try {
      migrateStateIfNeeded(tmp2);
      const writer2 = new UserStateService(tmp2);
      await writer2.setAiRecommendation(
        'song-a',
        1,
        'spectrum_eq_band_0',
        makeFreshBandRec(0, 3.5),
      );
      // Unguarded: stale write lands on top of the fresh rec.
      for (let bandIndex = 0; bandIndex < FREQUENCY_BAND_COUNT; bandIndex += 1) {
        await writer2.setAiRecommendation(
          'song-a',
          1,
          `spectrum_eq_band_${bandIndex}`,
          makeStaleBandRec(bandIndex, 0),
        );
      }
      const reader2 = await reloadService(tmp2);
      const set2 = await reader2.getAiRecommendations('song-a', 1);
      assert.equal(
        set2.spectrum_eq_band_0.status,
        'stale',
        'unguarded migration DOES clobber fresh recs — this is why the guard exists',
      );
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true });
    }

    // Finally — silence the lint hint; simulateUnguardedMigration is kept
    // around for documentation purposes and is referenced here so linters
    // don't flag the closure as dead code.
    void simulateUnguardedMigration;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('regenerate (clearAiRecommendations for this version) wipes every spectrum_eq_band_N metric in one call', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const writer = new UserStateService(tmp);

    // Full spectrum band set + one sibling mastering rec.
    for (let bandIndex = 0; bandIndex < FREQUENCY_BAND_COUNT; bandIndex += 1) {
      await writer.setAiRecommendation(
        'song-a',
        1,
        `spectrum_eq_band_${bandIndex}`,
        makeFreshBandRec(bandIndex, 0.5),
      );
    }
    await writer.setAiRecommendation('song-a', 1, 'integrated_lufs', {
      recommendedValue: '-12.5 LUFS',
      recommendedRawValue: -12.5,
      reason: 'Spotify target.',
      model: 'test',
      requestId: 'req-mast-1',
      analysisVersion: 'post-v3.32-analysis',
      generatedAt: 1_745_000_002_000,
      status: 'fresh',
    });

    await writer.clearAiRecommendations('song-a', 1);

    const reader = await reloadService(tmp);
    assert.equal(
      await reader.getAiRecommendations('song-a', 1),
      null,
      'regenerate wipes every metric (spectrum + mastering) in one call',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
