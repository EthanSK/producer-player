/**
 * v3.34 — Export/import round-trip through the split-layout persistence pipeline.
 *
 * Tier: MUST-ADD (from TEST_COVERAGE_AUDIT_2026-04-19.md gap #5). The export
 * flow in main.ts calls `readUserState()` → JSON → file, and import calls
 * JSON → `writeUserState()`. Because v3.29 moved AI recs + per-track data
 * into `state/tracks/*.json`, an export that survives `parseUserState` +
 * `writeUserState` round-trip is the correct user-data-safety signal.
 *
 * These tests simulate the export/import path without the dialog layer:
 *   1. Seed rich state (AI recs + checklists + refs across two songs).
 *   2. `JSON.stringify(readUserState())` — the "export" payload.
 *   3. Wipe the state dir.
 *   4. `writeUserState(JSON.parse(payload))` into a fresh dir — the "import".
 *   5. Read back and assert every field matches.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  UserStateService,
  migrateStateIfNeeded,
  createDefaultUserState,
} = require('../dist/state-service.test.cjs');

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-export-import-'));
}

async function reloadService(stateDir) {
  const service = new UserStateService(stateDir);
  service.invalidateCache();
  return service;
}

function makeFreshRec(metricId, rawValue) {
  return {
    recommendedValue: `${rawValue} LUFS`,
    recommendedRawValue: rawValue,
    reason: `Reason for ${metricId}`,
    model: 'claude-opus-4-6',
    requestId: `req-${metricId}`,
    analysisVersion: 'analysis-v1',
    generatedAt: 1_745_000_000_000,
    status: 'fresh',
  };
}

test('export/import round-trip preserves AI recs across the split layout', async () => {
  const sourceDir = mktmp();
  const targetDir = mktmp();
  try {
    // 1. Seed source with AI recs for two songs/versions.
    migrateStateIfNeeded(sourceDir);
    const src = new UserStateService(sourceDir);
    await src.setAiRecommendation('song-a', 1, 'integrated_lufs', makeFreshRec('int_a_v1', -14.0));
    await src.setAiRecommendation('song-a', 1, 'true_peak', makeFreshRec('tp_a_v1', -1.0));
    await src.setAiRecommendation('song-a', 2, 'integrated_lufs', makeFreshRec('int_a_v2', -12.5));
    await src.setAiRecommendation('song-b', 3, 'crest_factor', makeFreshRec('cf_b_v3', 12.2));

    // Also seed non-AI data in per-track fields to catch slice leaks.
    await src.patchUserState({
      songRatings: { 'song-a': 9, 'song-b': 7 },
      perSongReferenceTracks: { 'song-a': '/ref.wav' },
    });

    // 2. "Export" — serialize the full state.
    const srcReader = await reloadService(sourceDir);
    const exported = await srcReader.readUserState();
    const payload = JSON.stringify(exported);

    // 3. Into a fresh target dir (no split layout yet).
    migrateStateIfNeeded(targetDir);
    const tgt = new UserStateService(targetDir);
    await tgt.writeUserState(JSON.parse(payload));

    // 4. Read back, assert fidelity.
    const reader = await reloadService(targetDir);
    const restored = await reader.readUserState();

    // AI recs — full fidelity including requestId + generatedAt.
    const aV1 = restored.perTrackAiRecommendations['song-a']['1'];
    assert.ok(aV1, 'song-a v1 slot present');
    assert.equal(aV1.aiRecommendedFlag, true, 'flag preserved');
    assert.equal(aV1.recommendations.integrated_lufs.recommendedRawValue, -14.0);
    assert.equal(aV1.recommendations.integrated_lufs.requestId, 'req-int_a_v1');
    assert.equal(aV1.recommendations.true_peak.recommendedRawValue, -1.0);

    const aV2 = restored.perTrackAiRecommendations['song-a']['2'];
    assert.equal(aV2.recommendations.integrated_lufs.recommendedRawValue, -12.5);

    const bV3 = restored.perTrackAiRecommendations['song-b']['3'];
    assert.equal(bV3.recommendations.crest_factor.recommendedRawValue, 12.2);

    // Non-AI per-track fields preserved.
    assert.equal(restored.songRatings['song-a'], 9);
    assert.equal(restored.songRatings['song-b'], 7);
    assert.equal(restored.perSongReferenceTracks['song-a'], '/ref.wav');

    // 5. Confirm per-track files actually hit disk in the target.
    const tracksDir = path.join(targetDir, 'state', 'tracks');
    const tracks = fs.readdirSync(tracksDir).filter((n) => n.endsWith('.json'));
    assert.ok(tracks.length >= 2, `target has per-track files on disk (got ${tracks.length})`);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test('export/import round-trip preserves stale AI recs without flipping them to fresh', async () => {
  const sourceDir = mktmp();
  const targetDir = mktmp();
  try {
    migrateStateIfNeeded(sourceDir);
    const src = new UserStateService(sourceDir);
    await src.setAiRecommendation('song-x', 1, 'integrated_lufs', {
      ...makeFreshRec('stale-metric', -14.0),
      status: 'stale',
      analysisVersion: 'legacy-pre-v3.30',
    });

    const exported = await (await reloadService(sourceDir)).readUserState();
    const payload = JSON.stringify(exported);

    migrateStateIfNeeded(targetDir);
    const tgt = new UserStateService(targetDir);
    await tgt.writeUserState(JSON.parse(payload));

    const reader = await reloadService(targetDir);
    const restored = await reader.readUserState();
    const slot = restored.perTrackAiRecommendations['song-x']['1'];
    assert.equal(
      slot.recommendations.integrated_lufs.status,
      'stale',
      'stale status is preserved across export/import',
    );
    assert.equal(
      slot.recommendations.integrated_lufs.analysisVersion,
      'legacy-pre-v3.30',
    );
    assert.equal(
      slot.aiRecommendedFlag,
      false,
      'flag stays off when only stale recs are imported',
    );
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test('export from legacy monolithic dir imports cleanly into split-layout target', async () => {
  const sourceDir = mktmp();
  const targetDir = mktmp();
  try {
    // Source: pre-v3.29 monolithic only, no split layout.
    const base = createDefaultUserState();
    base.albumTitle = 'Legacy Album';
    base.songRatings = { 'legacy-song': 8 };
    base.songChecklists = {
      'legacy-song': [
        {
          id: 'c1',
          text: 'legacy note',
          completed: false,
          timestampSeconds: null,
          versionNumber: null,
          listeningDeviceId: null,
        },
      ],
    };
    fs.writeFileSync(
      path.join(sourceDir, 'producer-player-user-state.json'),
      JSON.stringify(base),
      'utf8',
    );

    const srcReader = await reloadService(sourceDir);
    assert.equal(srcReader.isSplitLayout(), false, 'source is legacy monolithic');
    const exported = await srcReader.readUserState();
    const payload = JSON.stringify(exported);

    // Target: pre-migrated split layout.
    migrateStateIfNeeded(targetDir);
    const tgt = new UserStateService(targetDir);
    await tgt.writeUserState(JSON.parse(payload));

    const reader = await reloadService(targetDir);
    const restored = await reader.readUserState();
    assert.equal(restored.albumTitle, 'Legacy Album');
    assert.equal(restored.songRatings['legacy-song'], 8);
    assert.equal(
      restored.songChecklists['legacy-song'][0].text,
      'legacy note',
    );
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});
