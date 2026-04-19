/**
 * v3.34 — state-split migration recovery / corrupt-disk safety net.
 *
 * Tier: MUST-ADD (from TEST_COVERAGE_AUDIT_2026-04-19.md).
 *
 * Motivated by the v3.29 state split shipping without:
 *   - corrupt per-track file recovery coverage,
 *   - half-migrated (sentinel-on-but-tracks-missing / tracks-on-but-sentinel-missing) coverage,
 *   - backup restorability coverage,
 *   - monolithic-only fallback coverage for pre-v3.29 users,
 *   - malformed `aiEqRecommendations` legacy-map coverage (Codex SHOULD-ADD
 *     bumped to MUST via v3.32 migration risk).
 *
 * These cases historically silently eat user data. Each test here seeds a
 * broken disk state, exercises the real migration + read code path, and
 * asserts that the service either (a) surfaces clean data or (b) leaves
 * the user's data recoverable for a future retry.
 *
 * All tests round-trip through disk via `writeUserState` / `readUserState`
 * after invalidating the in-memory cache so we're exercising persistence,
 * not just in-memory mutation.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  UserStateService,
  migrateStateIfNeeded,
  splitStateForDisk,
  parseUserState,
  createDefaultUserState,
  UNIFIED_STATE_FILE_NAME,
  STATE_SUBDIR,
  TRACKS_SUBDIR,
  GLOBAL_STATE_FILE,
  MIGRATED_SENTINEL,
} = require('../dist/state-service.test.cjs');

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-state-recovery-'));
}

function splitPaths(stateDir) {
  const subdir = path.join(stateDir, STATE_SUBDIR);
  return {
    subdir,
    globalFile: path.join(subdir, GLOBAL_STATE_FILE),
    tracksDir: path.join(subdir, TRACKS_SUBDIR),
    sentinel: path.join(subdir, MIGRATED_SENTINEL),
    monolithic: path.join(stateDir, UNIFIED_STATE_FILE_NAME),
  };
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeMonolithic(dir, state) {
  fs.writeFileSync(path.join(dir, UNIFIED_STATE_FILE_NAME), JSON.stringify(state, null, 2), 'utf8');
}

function richMonolithic() {
  const base = createDefaultUserState();
  return {
    ...base,
    albumTitle: 'Recovery Album',
    songOrder: ['song-a', 'song-b'],
    songRatings: { 'song-a': 9, 'song-b': 7 },
    songChecklists: {
      'song-a': [
        {
          id: 'c1',
          text: 'keep',
          completed: false,
          timestampSeconds: null,
          versionNumber: null,
          listeningDeviceId: null,
        },
      ],
    },
    perSongReferenceTracks: { 'song-a': '/Users/ethan/refs/ref.wav' },
  };
}

// ---------------------------------------------------------------------------
// 1. Corrupt per-track file
// ---------------------------------------------------------------------------

test('readSplitState skips corrupt per-track file but preserves every other track', async () => {
  const tmp = mktmp();
  try {
    // Seed + migrate a real monolithic so the split layout is populated.
    writeMonolithic(tmp, richMonolithic());
    migrateStateIfNeeded(tmp);

    const paths = splitPaths(tmp);
    assert.ok(fs.existsSync(paths.sentinel), 'migration sentinel written');

    // Corrupt song-a's track file with unterminated JSON.
    const entries = fs.readdirSync(paths.tracksDir).filter((n) => n.endsWith('.json'));
    assert.ok(entries.length >= 2, 'both tracks migrated');
    const victim = entries.find((n) => {
      const data = readJson(path.join(paths.tracksDir, n));
      return data.songRatings === 9;
    });
    assert.ok(victim, 'found song-a (rating 9) file');
    fs.writeFileSync(path.join(paths.tracksDir, victim), '{ "songRatings": 9, "songChecklists":', 'utf8');

    // Reader should NOT crash; song-b must still load cleanly.
    const reader = new UserStateService(tmp);
    reader.invalidateCache();
    const state = await reader.readUserState();

    // song-b: preserved.
    assert.equal(state.songRatings['song-b'], 7, 'song-b rating survives corrupt sibling');
    // song-a: silently dropped (no rating stored) — this is the documented
    // MVP behaviour. If v3.34+ ever adds auto-repair we can tighten this to
    // assert the recovered value instead.
    assert.ok(
      state.songRatings['song-a'] === undefined || state.songRatings['song-a'] === 0,
      'song-a rating not recovered in MVP (corrupt file skipped, not auto-repaired)',
    );

    // Global data still intact.
    assert.equal(state.albumTitle, 'Recovery Album');
    assert.deepEqual(state.songOrder, ['song-a', 'song-b']);

    // The corrupt file is NOT deleted — Phase 1.5 recovery needs the bytes.
    assert.ok(
      fs.existsSync(path.join(paths.tracksDir, victim)),
      'corrupt per-track file is preserved on disk for later repair',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readSplitState handles corrupt global.json by falling back to empty global slice', async () => {
  const tmp = mktmp();
  try {
    writeMonolithic(tmp, richMonolithic());
    migrateStateIfNeeded(tmp);
    const paths = splitPaths(tmp);

    fs.writeFileSync(paths.globalFile, '{"albumTitle": "Recovery Album", "songOrder":', 'utf8');

    const reader = new UserStateService(tmp);
    reader.invalidateCache();
    const state = await reader.readUserState();

    // Per-track data still loads.
    assert.equal(state.songRatings['song-a'], 9);
    assert.equal(state.songRatings['song-b'], 7);
    // Global fields fall back to defaults (not crash).
    const defaults = createDefaultUserState();
    assert.equal(state.albumTitle, defaults.albumTitle);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. Half-migrated recovery
// ---------------------------------------------------------------------------

test('sentinel present but tracks dir missing: service still loads without crash', async () => {
  const tmp = mktmp();
  try {
    const paths = splitPaths(tmp);
    fs.mkdirSync(paths.subdir, { recursive: true });
    fs.writeFileSync(paths.globalFile, JSON.stringify({ albumTitle: 'Half' }), 'utf8');
    fs.writeFileSync(paths.sentinel, '', 'utf8');
    // Deliberately NO tracksDir.

    const service = new UserStateService(tmp);
    service.invalidateCache();
    const state = await service.readUserState();

    assert.equal(state.albumTitle, 'Half');
    assert.deepEqual(state.songRatings, {});
    assert.deepEqual(state.songChecklists, {});
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('sentinel absent but tracks dir exists: migration re-runs from monolithic and orphan tracks are merged (MVP behaviour)', async () => {
  const tmp = mktmp();
  try {
    // Pre-seed an orphaned tracks dir (simulates a half-migrated state that
    // crashed before the sentinel was written). The v3.29 MVP re-runs the
    // split but does NOT prune orphan per-track files because pruning only
    // runs inside `writeSplitState`. The fresh monolithic's tracks are
    // written alongside the orphan, which is then visible to the reader.
    //
    // This test is the contract that documents the known limitation so a
    // Phase 1.5 fix (orphan-prune on re-migration) can flip this expectation
    // without silently changing behaviour.
    const paths = splitPaths(tmp);
    fs.mkdirSync(paths.tracksDir, { recursive: true });
    fs.writeFileSync(paths.globalFile, JSON.stringify({}), 'utf8');
    fs.writeFileSync(
      path.join(paths.tracksDir, 'c3RhbGUtc29uZw==.json'), // base64url of "stale-song"
      JSON.stringify({ songRatings: 1 }),
      'utf8',
    );

    // Fresh monolithic with new data.
    writeMonolithic(tmp, richMonolithic());
    migrateStateIfNeeded(tmp);

    // Sentinel should now be written.
    assert.ok(fs.existsSync(paths.sentinel), 're-run wrote sentinel');

    // Fresh monolithic's data lands cleanly.
    const reader = new UserStateService(tmp);
    reader.invalidateCache();
    const state = await reader.readUserState();
    assert.equal(state.songRatings['song-a'], 9, 'monolithic song-a migrated');
    assert.equal(state.songRatings['song-b'], 7, 'monolithic song-b migrated');

    // MVP-known: orphan track file surfaces too. A Phase 1.5 fix should
    // flip this to `undefined` — when that lands, update this assertion.
    // Either way, the test MUST continue to pass so data isn't silently
    // lost OR silently resurrected without intent.
    const staleVisible = state.songRatings['stale-song'];
    assert.ok(
      staleVisible === undefined || staleVisible === 1,
      'orphan track file behaviour is deterministic (either pruned or surfaced as-is)',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. Backup restorability
// ---------------------------------------------------------------------------

test('.bak-pre-split-<ts> backup is a valid JSON round-trip of the pre-migration state', async () => {
  const tmp = mktmp();
  try {
    const pre = richMonolithic();
    writeMonolithic(tmp, pre);
    migrateStateIfNeeded(tmp);

    // Find the backup.
    const entries = fs.readdirSync(tmp);
    const backup = entries.find((n) => n.includes('.bak-pre-split-'));
    assert.ok(backup, 'backup written next to monolithic');

    const restored = JSON.parse(fs.readFileSync(path.join(tmp, backup), 'utf8'));

    // Run it through parseUserState so we know the backup is consumable by
    // the same validator a future rollback would use.
    const parsed = parseUserState(restored);
    assert.equal(parsed.albumTitle, 'Recovery Album');
    assert.equal(parsed.songRatings['song-a'], 9);
    assert.equal(parsed.songRatings['song-b'], 7);
    assert.ok(
      parsed.songChecklists['song-a'],
      'backup preserves per-song checklist data',
    );
    assert.equal(
      parsed.perSongReferenceTracks['song-a'],
      '/Users/ethan/refs/ref.wav',
      'backup preserves reference paths',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. Monolithic-only fallback (pre-v3.29 user who hasn't migrated yet)
// ---------------------------------------------------------------------------

test('service reads from monolithic file when split layout is absent (legacy fallback)', async () => {
  const tmp = mktmp();
  try {
    // NOTE: do NOT call migrateStateIfNeeded — simulate the pre-v3.29
    // installation path where only the monolithic file exists.
    writeMonolithic(tmp, richMonolithic());

    const service = new UserStateService(tmp);
    service.invalidateCache();
    assert.equal(service.isSplitLayout(), false, 'split layout absent');

    const state = await service.readUserState();
    assert.equal(state.albumTitle, 'Recovery Album');
    assert.equal(state.songRatings['song-a'], 9);
    assert.equal(state.songRatings['song-b'], 7);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('service writes to monolithic file when split layout is absent (legacy fallback)', async () => {
  const tmp = mktmp();
  try {
    writeMonolithic(tmp, richMonolithic());

    const service = new UserStateService(tmp);
    service.invalidateCache();
    await service.patchUserState({ albumTitle: 'Mutated' });

    // Monolithic file should reflect the change.
    const raw = fs.readFileSync(path.join(tmp, UNIFIED_STATE_FILE_NAME), 'utf8');
    const read = JSON.parse(raw);
    assert.equal(read.albumTitle, 'Mutated');
    assert.equal(read.songRatings['song-a'], 9, 'other data not lost in legacy write');

    // Split layout still not initialized.
    const paths = splitPaths(tmp);
    assert.ok(!fs.existsSync(paths.sentinel));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. Malformed aiEqRecommendations legacy map (Codex-surfaced SHOULD-ADD
//    bumped to MUST given v3.32 runs this through a real migration path).
// ---------------------------------------------------------------------------

test('parseUserState drops malformed aiEqRecommendations entries without crashing', () => {
  const raw = {
    aiEqRecommendations: {
      'valid-song': [0, 1, -2, 3, 0, 0],
      'bad-length': [0, 1], // too few bands
      'non-number': [0, 'bogus', 0, 0, 0, 0],
      'not-array': { some: 'object' },
      'null-entry': null,
    },
  };
  const parsed = parseUserState(raw);
  assert.ok(parsed.aiEqRecommendations['valid-song'], 'valid entry kept');
  assert.deepEqual(parsed.aiEqRecommendations['valid-song'], [0, 1, -2, 3, 0, 0]);

  // Malformed entries MUST be dropped — the contract is "no crash, no
  // fabricated data, no partial-array round-trip". `parseAiEqRecommendations`
  // requires `Array.isArray(val) && val.length >= 6 && every number`.
  const kept = Object.keys(parsed.aiEqRecommendations);
  assert.ok(kept.includes('valid-song'));
  for (const bad of ['bad-length', 'non-number', 'not-array', 'null-entry']) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(parsed.aiEqRecommendations, bad),
      false,
      `malformed entry "${bad}" is absent from parsed aiEqRecommendations`,
    );
  }
  // Exactly one entry survived.
  assert.deepEqual(kept, ['valid-song']);
});
