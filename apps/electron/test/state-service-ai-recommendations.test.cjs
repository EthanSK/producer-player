/**
 * v3.30 AI mastering recommendation storage unit tests.
 *
 * Exercises `UserStateService.getAiRecommendations`,
 * `setAiRecommendation`, `clearAiRecommendations`, and
 * `markAiRecommendationsStale` against the split-layout persistence pipeline
 * introduced in v3.29. Every test round-trips through disk via
 * `writeUserState` / `readUserState` (after invalidating the in-memory cache)
 * so the contract tests persistence, not just the in-memory mutation.
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
  STATE_SUBDIR,
  TRACKS_SUBDIR,
} = require('../dist/state-service.test.cjs');

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ai-rec-'));
}

function makeRec(overrides = {}) {
  return {
    recommendedValue: '-14.0 LUFS',
    recommendedRawValue: -14.0,
    reason: 'Matches the streaming-target for the Spotify loudness norm.',
    model: 'claude-opus-4-6',
    requestId: 'req-12345',
    analysisVersion: 'analysis-v1-abc',
    generatedAt: 1745_000_000_000,
    status: 'fresh',
    ...overrides,
  };
}

// Reload the service from disk to guarantee we're exercising the round-trip
// through persistence, not an in-memory cache.
async function reloadService(stateDir) {
  const service = new UserStateService(stateDir);
  service.invalidateCache();
  return service;
}

test('setAiRecommendation persists a rec that survives a read-back', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const writer = new UserStateService(tmp);

    const rec = makeRec({ recommendedValue: '-12.5 LUFS', generatedAt: 1 });
    await writer.setAiRecommendation('song-alpha', 3, 'integrated_lufs', rec);

    const reader = await reloadService(tmp);
    const set = await reader.getAiRecommendations('song-alpha', 3);

    assert.ok(set, 'recommendation set exists for (song-alpha, v3)');
    assert.equal(set.integrated_lufs.recommendedValue, '-12.5 LUFS');
    assert.equal(set.integrated_lufs.recommendedRawValue, -14.0);
    assert.equal(set.integrated_lufs.status, 'fresh');
    assert.equal(set.integrated_lufs.model, 'claude-opus-4-6');

    // Slot metadata was also persisted (not just the metric map).
    const state = await reader.readUserState();
    const slot = state.perTrackAiRecommendations['song-alpha']['3'];
    assert.equal(slot.aiRecommendedFlag, true, 'fresh rec flips the flag on');
    assert.equal(slot.lastRunAt, 1, 'lastRunAt mirrors the rec generatedAt');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('setAiRecommendation merges additional metrics without dropping prior ones', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);

    await service.setAiRecommendation('song-a', 1, 'integrated_lufs', makeRec({ generatedAt: 10 }));
    await service.setAiRecommendation(
      'song-a',
      1,
      'true_peak',
      makeRec({ recommendedValue: '-1.0 dBTP', generatedAt: 11 }),
    );

    const reloaded = await reloadService(tmp);
    const set = await reloaded.getAiRecommendations('song-a', 1);
    assert.ok(set);
    assert.ok(set.integrated_lufs, 'first rec preserved');
    assert.ok(set.true_peak, 'second rec persisted');
    assert.equal(set.true_peak.recommendedValue, '-1.0 dBTP');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('clearAiRecommendations wipes one version and leaves other versions untouched', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);

    await service.setAiRecommendation('song-a', 1, 'integrated_lufs', makeRec());
    await service.setAiRecommendation('song-a', 2, 'integrated_lufs', makeRec());
    await service.setAiRecommendation('song-a', 3, 'integrated_lufs', makeRec());

    await service.clearAiRecommendations('song-a', 2);

    const reloaded = await reloadService(tmp);
    assert.ok(await reloaded.getAiRecommendations('song-a', 1), 'v1 survives');
    assert.equal(
      await reloaded.getAiRecommendations('song-a', 2),
      null,
      'v2 is cleared',
    );
    assert.ok(await reloaded.getAiRecommendations('song-a', 3), 'v3 survives');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('clearAiRecommendations without a versionNumber wipes the whole song', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);

    await service.setAiRecommendation('song-a', 1, 'integrated_lufs', makeRec());
    await service.setAiRecommendation('song-a', 4, 'true_peak', makeRec());
    await service.setAiRecommendation('song-b', 1, 'integrated_lufs', makeRec());

    await service.clearAiRecommendations('song-a');

    const reloaded = await reloadService(tmp);
    assert.equal(await reloaded.getAiRecommendations('song-a', 1), null);
    assert.equal(await reloaded.getAiRecommendations('song-a', 4), null);
    assert.ok(
      await reloaded.getAiRecommendations('song-b', 1),
      'different song unaffected',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('markAiRecommendationsStale flips only mismatching analysisVersion entries', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);

    await service.setAiRecommendation(
      'song-a',
      2,
      'integrated_lufs',
      makeRec({ analysisVersion: 'old-analysis', status: 'fresh' }),
    );
    await service.setAiRecommendation(
      'song-a',
      2,
      'true_peak',
      makeRec({ analysisVersion: 'old-analysis', status: 'fresh' }),
    );
    // A rec that was already regenerated against the new analysis must NOT be
    // demoted to stale by the bulk flip — that would undo the fresh signal.
    await service.setAiRecommendation(
      'song-a',
      2,
      'crest_factor',
      makeRec({ analysisVersion: 'new-analysis', status: 'fresh' }),
    );
    // A rec on a sibling slot that should be ignored entirely.
    await service.setAiRecommendation(
      'song-a',
      3,
      'integrated_lufs',
      makeRec({ analysisVersion: 'old-analysis', status: 'fresh' }),
    );

    await service.markAiRecommendationsStale('song-a', 2, 'new-analysis');

    const reloaded = await reloadService(tmp);
    const setV2 = await reloaded.getAiRecommendations('song-a', 2);
    const setV3 = await reloaded.getAiRecommendations('song-a', 3);

    assert.equal(setV2.integrated_lufs.status, 'stale', 'mismatching v2 rec → stale');
    assert.equal(setV2.true_peak.status, 'stale', 'second mismatching v2 rec → stale');
    assert.equal(setV2.crest_factor.status, 'fresh', 'matching v2 rec kept fresh');
    assert.equal(setV3.integrated_lufs.status, 'fresh', 'different version untouched');

    const state = await reloaded.readUserState();
    const v2Slot = state.perTrackAiRecommendations['song-a']['2'];
    assert.equal(
      v2Slot.aiRecommendedFlag,
      true,
      'flag stays true while crest_factor remains fresh',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('markAiRecommendationsStale clears aiRecommendedFlag when every rec becomes stale', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);

    await service.setAiRecommendation(
      'song-a',
      1,
      'integrated_lufs',
      makeRec({ analysisVersion: 'old', status: 'fresh' }),
    );
    await service.setAiRecommendation(
      'song-a',
      1,
      'true_peak',
      makeRec({ analysisVersion: 'old', status: 'fresh' }),
    );

    await service.markAiRecommendationsStale('song-a', 1, 'new');

    const reloaded = await reloadService(tmp);
    const state = await reloaded.readUserState();
    const slot = state.perTrackAiRecommendations['song-a']['1'];
    assert.equal(slot.aiRecommendedFlag, false, 'no fresh recs → flag cleared');
    assert.equal(slot.recommendations.integrated_lufs.status, 'stale');
    assert.equal(slot.recommendations.true_peak.status, 'stale');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('round-trips recs with unicode metric IDs and songIds', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);

    const unicodeSong = 'song-αβγ/with slashes';
    const unicodeMetric = 'spectral_balance__μ_band_🎛';

    await service.setAiRecommendation(
      unicodeSong,
      7,
      unicodeMetric,
      makeRec({ recommendedValue: 'reduce 1.5 dB on μ band' }),
    );

    const reloaded = await reloadService(tmp);
    const set = await reloaded.getAiRecommendations(unicodeSong, 7);
    assert.ok(set, 'set returned for unicode song id');
    assert.ok(set[unicodeMetric], 'unicode metric key preserved');
    assert.equal(set[unicodeMetric].recommendedValue, 'reduce 1.5 dB on μ band');

    // The per-track file must be named safely (base64url of utf8 bytes).
    const tracksDir = path.join(tmp, STATE_SUBDIR, TRACKS_SUBDIR);
    const expectedFilename = `${Buffer.from(unicodeSong, 'utf8').toString('base64url')}.json`;
    assert.ok(
      fs.existsSync(path.join(tracksDir, expectedFilename)),
      'unicode-safe filename used on disk',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('tracks without an aiRecommendations field round-trip cleanly', async () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);

    // Simulate an older track file from pre-v3.30 that has other per-track
    // fields but no perTrackAiRecommendations payload.
    const tracksDir = path.join(tmp, STATE_SUBDIR, TRACKS_SUBDIR);
    fs.mkdirSync(tracksDir, { recursive: true });
    const legacyFilename = `${Buffer.from('legacy-song', 'utf8').toString('base64url')}.json`;
    fs.writeFileSync(
      path.join(tracksDir, legacyFilename),
      JSON.stringify(
        {
          songRatings: 8,
          songChecklists: [
            {
              id: 'c1',
              text: 'tighten low end',
              completed: false,
              timestampSeconds: null,
              versionNumber: null,
              listeningDeviceId: null,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const service = await reloadService(tmp);
    const state = await service.readUserState();
    assert.equal(state.songRatings['legacy-song'], 8, 'legacy fields still load');
    assert.deepEqual(
      state.perTrackAiRecommendations,
      {},
      'missing perTrackAiRecommendations parses to empty record',
    );

    // A fresh set/read cycle on the same song must not corrupt the legacy data.
    await service.setAiRecommendation('legacy-song', 1, 'integrated_lufs', makeRec());

    const after = await reloadService(tmp);
    const afterState = await after.readUserState();
    assert.equal(afterState.songRatings['legacy-song'], 8, 'legacy rating preserved');
    const set = await after.getAiRecommendations('legacy-song', 1);
    assert.ok(set.integrated_lufs, 'new rec landed alongside legacy fields');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('concurrent patchUserState calls do not stomp a concurrent setAiRecommendation (regression: codex 2026-04-18 round 3)', async () => {
  // Round-3 codex finding: unrelated patchUserState callers (window bounds,
  // dialog directory, etc.) read cached state, merge their patch, and write.
  // A setAiRecommendation landing between the read and the write would be
  // clobbered by the stale AI-rec slice inside the patch writer's snapshot.
  // The shared state-mutation queue (renamed from the AI-rec queue) now
  // covers every read-modify-write.
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);

    await service.setAiRecommendation('song-p', 1, 'seed', makeRec({ generatedAt: 1 }));

    await Promise.all([
      service.patchUserState({ lastFileDialogDirectory: '/tmp/a' }),
      service.setAiRecommendation('song-p', 1, 'racer_1', makeRec({ generatedAt: 100 })),
      service.patchUserState({ albumTitle: 'Racing Album' }),
      service.setAiRecommendation('song-p', 1, 'racer_2', makeRec({ generatedAt: 101 })),
      service.patchUserState({ lastFileDialogDirectory: '/tmp/b' }),
    ]);

    const reloaded = await reloadService(tmp);
    const set = await reloaded.getAiRecommendations('song-p', 1);
    assert.ok(set.seed, 'seed rec preserved');
    assert.ok(set.racer_1, 'racer_1 preserved across concurrent patches');
    assert.ok(set.racer_2, 'racer_2 preserved across concurrent patches');

    const final = await reloaded.readUserState();
    assert.equal(final.albumTitle, 'Racing Album', 'albumTitle patch landed');
    // Either `/tmp/a` or `/tmp/b` is acceptable since the two patches race
    // by definition — we just require that it's one of the two, not wiped.
    assert.ok(
      ['/tmp/a', '/tmp/b'].includes(final.lastFileDialogDirectory),
      `lastFileDialogDirectory resolved to one of the racing values (got ${final.lastFileDialogDirectory})`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('writeUserStatePreservingAiRecommendations does not stomp a concurrent setAiRecommendation (regression: codex 2026-04-18 round 2)', async () => {
  // Round-2 codex finding: the SET_USER_STATE handler in main.ts read
  // `existing.perTrackAiRecommendations` before writing the merged state.
  // If a setAiRecommendation landed between those steps, the full-state
  // sync would write back the stale (pre-rec) AI-rec slice and lose the
  // new rec. The service method below routes both writers through the
  // same queue; the test interleaves them on purpose.
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);

    // Seed with an initial rec so there's a non-empty slice on disk.
    await service.setAiRecommendation('song-x', 1, 'initial', makeRec({ generatedAt: 1 }));

    // Build the sync payload by reading the current state and overwriting
    // `perTrackAiRecommendations` with an empty placeholder (this is what
    // the renderer's debounced sync effectively sends).
    const snapshot = await service.readUserState();
    const syncPayload = { ...snapshot, perTrackAiRecommendations: {} };

    await Promise.all([
      // Renderer's debounced full-state sync — placeholder {} for AI recs.
      service.writeUserStatePreservingAiRecommendations(syncPayload),
      // In-flight per-metric writes firing at roughly the same time.
      service.setAiRecommendation('song-x', 1, 'racer_a', makeRec({ generatedAt: 10 })),
      service.setAiRecommendation('song-x', 1, 'racer_b', makeRec({ generatedAt: 11 })),
      service.setAiRecommendation('song-x', 1, 'racer_c', makeRec({ generatedAt: 12 })),
    ]);

    const reloaded = await reloadService(tmp);
    const set = await reloaded.getAiRecommendations('song-x', 1);
    assert.ok(set, 'rec set exists after interleaved full-state sync');
    assert.ok(set.initial, 'seed rec preserved');
    assert.ok(set.racer_a, 'racer_a preserved');
    assert.ok(set.racer_b, 'racer_b preserved');
    assert.ok(set.racer_c, 'racer_c preserved');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('concurrent setAiRecommendation calls preserve every sibling metric (regression: codex 2026-04-18)', async () => {
  // Codex caught this in pre-commit review: a Promise.all over per-metric
  // writes raced on the read-modify-write cycle and dropped sibling metrics
  // (and occasionally ENOENT'd on the atomic temp file rename). The service
  // now serializes these mutations through an internal write queue.
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);
    const service = new UserStateService(tmp);

    const metricIds = Array.from({ length: 20 }, (_, i) => `metric_${i}`);
    await Promise.all(
      metricIds.map((m, i) =>
        service.setAiRecommendation(
          'song-race',
          5,
          m,
          makeRec({ recommendedValue: `v${i}`, generatedAt: 100 + i }),
        ),
      ),
    );

    const reloaded = await reloadService(tmp);
    const set = await reloaded.getAiRecommendations('song-race', 5);
    assert.ok(set, 'set exists after concurrent writes');
    for (const m of metricIds) {
      assert.ok(set[m], `metric ${m} survived concurrent writes`);
    }
    assert.equal(Object.keys(set).length, metricIds.length);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('parseUserState safely drops malformed recommendation entries', () => {
  const raw = {
    schemaVersion: 1,
    updatedAt: '2026-04-18T12:00:00.000Z',
    perTrackAiRecommendations: {
      'song-a': {
        '1': {
          recommendations: {
            good_metric: {
              recommendedValue: '-14 LUFS',
              reason: 'matches target',
              model: 'claude-opus-4-6',
              requestId: 'r1',
              analysisVersion: 'av1',
              generatedAt: 123,
              status: 'fresh',
            },
            // Missing `reason`.
            bad_metric_missing_reason: {
              recommendedValue: '-14 LUFS',
              model: 'claude-opus-4-6',
              requestId: 'r1',
              analysisVersion: 'av1',
              generatedAt: 123,
              status: 'fresh',
            },
            // Unknown status.
            bad_metric_bad_status: {
              recommendedValue: '-14 LUFS',
              reason: 'x',
              model: 'claude-opus-4-6',
              requestId: 'r1',
              analysisVersion: 'av1',
              generatedAt: 123,
              status: 'totally-invalid-status',
            },
          },
          aiRecommendedFlag: true,
          lastRunAt: 456,
        },
        // Non-integer version key is dropped.
        'not-a-number': {
          recommendations: {},
          aiRecommendedFlag: false,
          lastRunAt: null,
        },
      },
    },
  };

  const parsed = parseUserState(raw);
  const perSong = parsed.perTrackAiRecommendations['song-a'];
  assert.ok(perSong);
  assert.ok(perSong['1']);
  assert.equal(Object.keys(perSong['1'].recommendations).length, 1);
  assert.ok(perSong['1'].recommendations.good_metric);
  assert.equal(
    Object.prototype.hasOwnProperty.call(perSong, 'not-a-number'),
    false,
    'non-integer version key dropped',
  );
});
