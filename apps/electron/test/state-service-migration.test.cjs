/**
 * v3.29 MVP state split migration unit tests.
 *
 * Uses the Node built-in test runner (`node --test`) to stay consistent with
 * `packages/domain/test/*.test.cjs`. The state-service TypeScript is bundled
 * into `dist/state-service.test.cjs` by `scripts/build-state-service-cjs.mjs`
 * so Node can require it without the Electron runtime.
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
  PER_TRACK_KEYS,
  STATE_SUBDIR,
  TRACKS_SUBDIR,
  GLOBAL_STATE_FILE,
  MIGRATED_SENTINEL,
} = require('../dist/state-service.test.cjs');

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-state-split-'));
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeMonolithic(dir, state) {
  fs.writeFileSync(
    path.join(dir, UNIFIED_STATE_FILE_NAME),
    JSON.stringify(state, null, 2),
    'utf8',
  );
}

function makeRichState() {
  const base = createDefaultUserState();
  return {
    ...base,
    updatedAt: '2026-04-18T12:00:00.000Z',
    linkedFolders: [{ path: '/Users/ethan/Music/Album' }],
    songOrder: ['song-a', 'song-b', 'song-weird/with slash'],
    albumTitle: 'Test Album',
    songRatings: {
      'song-a': 9,
      'song-b': 7,
      'song-weird/with slash': 8,
    },
    songChecklists: {
      'song-a': [
        {
          id: 'c1',
          text: 'tighten low end',
          completed: false,
          timestampSeconds: 42.5,
          versionNumber: 3,
          listeningDeviceId: null,
        },
      ],
      'song-b': [
        {
          id: 'c2',
          text: 'check stereo',
          completed: true,
          timestampSeconds: null,
          versionNumber: null,
          listeningDeviceId: null,
        },
      ],
    },
    songProjectFilePaths: {
      'song-a': '/Users/ethan/Projects/song-a.logic',
    },
    perSongReferenceTracks: {
      'song-a': '/Users/ethan/refs/reference.wav',
    },
    perSongRestoreReferenceEnabled: {
      'song-a': true,
      'song-b': false,
    },
    eqSnapshots: {
      'song-a': [{ id: 'eq1', gains: [0, 1, -2, 3, 0, 0], timestamp: 1700000000000 }],
    },
    eqLiveStates: {
      'song-a': {
        gains: [0, 1, -2, 3, 0, 0],
        eqEnabled: true,
        showAiEqCurve: false,
        showRefDiffCurve: false,
        showEqTonalBalance: false,
      },
    },
    aiEqRecommendations: {
      'song-b': [0, 0, 0, 0, 0, 0],
    },
    songDawOffsets: {
      'song-a': { seconds: 42, enabled: true },
    },
  };
}

test('PER_TRACK_KEYS surface is stable and matches expected songId-keyed fields', () => {
  assert.deepEqual(Array.from(PER_TRACK_KEYS), [
    'songRatings',
    'songChecklists',
    'songProjectFilePaths',
    'perSongReferenceTracks',
    'perSongRestoreReferenceEnabled',
    'eqSnapshots',
    'eqLiveStates',
    'aiEqRecommendations',
    'songDawOffsets',
  ]);
});

test('splitStateForDisk hoists songId-keyed fields into per-track buckets', () => {
  const rich = makeRichState();
  const { globalFields, trackBuckets } = splitStateForDisk(rich);

  for (const key of PER_TRACK_KEYS) {
    assert.ok(!(key in globalFields), `globalFields should not contain "${key}"`);
  }
  assert.equal(globalFields.albumTitle, 'Test Album');
  assert.deepEqual(globalFields.songOrder, ['song-a', 'song-b', 'song-weird/with slash']);

  // song-a has the most data
  const songA = trackBuckets.get('song-a');
  assert.ok(songA, 'song-a bucket exists');
  assert.equal(songA.songRatings, 9);
  assert.ok(Array.isArray(songA.songChecklists));
  assert.equal(songA.songProjectFilePaths, '/Users/ethan/Projects/song-a.logic');
  assert.ok(songA.eqSnapshots);
  assert.ok(songA.eqLiveStates);
  assert.deepEqual(songA.songDawOffsets, { seconds: 42, enabled: true });

  // song-b — partial
  const songB = trackBuckets.get('song-b');
  assert.equal(songB.songRatings, 7);
  assert.equal(songB.perSongRestoreReferenceEnabled, false);
  assert.deepEqual(songB.aiEqRecommendations, [0, 0, 0, 0, 0, 0]);

  // song with filesystem-unsafe id survives splitting
  const weird = trackBuckets.get('song-weird/with slash');
  assert.ok(weird, 'song with slash in id still gets a bucket');
  assert.equal(weird.songRatings, 8);
});

test('fresh install: no monolithic file creates empty split layout with sentinel', () => {
  const tmp = mktmp();
  try {
    migrateStateIfNeeded(tmp);

    const stateDir = path.join(tmp, STATE_SUBDIR);
    assert.ok(fs.existsSync(stateDir), 'state/ dir exists');
    assert.ok(fs.existsSync(path.join(stateDir, TRACKS_SUBDIR)), 'state/tracks/ dir exists');
    assert.ok(
      fs.existsSync(path.join(stateDir, GLOBAL_STATE_FILE)),
      'state/global.json exists',
    );
    assert.ok(fs.existsSync(path.join(stateDir, MIGRATED_SENTINEL)), 'sentinel exists');
    assert.deepEqual(readJson(path.join(stateDir, GLOBAL_STATE_FILE)), {});
    assert.equal(
      fs.readdirSync(path.join(stateDir, TRACKS_SUBDIR)).length,
      0,
      'no per-track files on fresh install',
    );
    assert.ok(
      !fs.existsSync(path.join(tmp, UNIFIED_STATE_FILE_NAME)),
      'no monolithic produced on fresh install',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('populated monolithic: migrates to split layout, writes backup, preserves data', async () => {
  const tmp = mktmp();
  try {
    const original = makeRichState();
    writeMonolithic(tmp, original);

    migrateStateIfNeeded(tmp);

    const stateDir = path.join(tmp, STATE_SUBDIR);
    const tracksDir = path.join(stateDir, TRACKS_SUBDIR);

    // Sentinel + global + tracks dir all present
    assert.ok(fs.existsSync(path.join(stateDir, MIGRATED_SENTINEL)));
    assert.ok(fs.existsSync(path.join(stateDir, GLOBAL_STATE_FILE)));
    assert.ok(fs.existsSync(tracksDir));

    // Monolithic KEPT as-is for backwards compatibility
    assert.ok(
      fs.existsSync(path.join(tmp, UNIFIED_STATE_FILE_NAME)),
      'monolithic file is preserved',
    );

    // Backup file exists
    const backups = fs
      .readdirSync(tmp)
      .filter((n) => n.startsWith(`${UNIFIED_STATE_FILE_NAME}.bak-pre-split-`));
    assert.equal(backups.length, 1, 'exactly one pre-split backup was written');
    // Backup content matches original monolithic byte-for-byte
    assert.equal(
      fs.readFileSync(path.join(tmp, backups[0]), 'utf8'),
      fs.readFileSync(path.join(tmp, UNIFIED_STATE_FILE_NAME), 'utf8'),
    );

    // Global file has non-per-track fields only
    const globalOnDisk = readJson(path.join(stateDir, GLOBAL_STATE_FILE));
    for (const key of PER_TRACK_KEYS) {
      assert.ok(!(key in globalOnDisk), `global.json leaked per-track key "${key}"`);
    }
    assert.equal(globalOnDisk.albumTitle, 'Test Album');

    // Per-track files exist for every songId that had data — including the
    // filesystem-unsafe one.
    const trackFiles = fs.readdirSync(tracksDir);
    assert.equal(trackFiles.length, 3, 'one per-track file per unique songId');

    // Read-back via UserStateService rebuilds an equivalent shape.
    const service = new UserStateService(tmp);
    const roundTripped = await service.readUserState();

    // Re-parse the original so we compare post-validator shapes.
    const expected = parseUserState(original);
    expected.updatedAt = roundTripped.updatedAt;

    for (const key of PER_TRACK_KEYS) {
      assert.deepEqual(
        roundTripped[key],
        expected[key],
        `per-track field "${key}" round-trips`,
      );
    }
    assert.equal(roundTripped.albumTitle, expected.albumTitle);
    assert.deepEqual(roundTripped.songOrder, expected.songOrder);
    assert.deepEqual(roundTripped.linkedFolders, expected.linkedFolders);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('idempotent: re-running migration on already-migrated state is a no-op', () => {
  const tmp = mktmp();
  try {
    writeMonolithic(tmp, makeRichState());
    migrateStateIfNeeded(tmp);

    // Snapshot file list + sizes + backup name after first migration
    const stateDir = path.join(tmp, STATE_SUBDIR);
    const tracksDir = path.join(stateDir, TRACKS_SUBDIR);
    const firstBackup = fs
      .readdirSync(tmp)
      .find((n) => n.startsWith(`${UNIFIED_STATE_FILE_NAME}.bak-pre-split-`));
    assert.ok(firstBackup, 'first migration produced a backup');

    const snapshotTrackFiles = fs.readdirSync(tracksDir).sort();
    const globalBefore = fs.readFileSync(path.join(stateDir, GLOBAL_STATE_FILE), 'utf8');
    const sentinelStatBefore = fs.statSync(path.join(stateDir, MIGRATED_SENTINEL));

    // Re-run — should short-circuit on sentinel
    migrateStateIfNeeded(tmp);

    // Still exactly one backup file (no new one was written)
    const allBackups = fs
      .readdirSync(tmp)
      .filter((n) => n.startsWith(`${UNIFIED_STATE_FILE_NAME}.bak-pre-split-`));
    assert.equal(allBackups.length, 1, 'no additional backup on re-run');
    assert.equal(allBackups[0], firstBackup, 'backup filename unchanged');

    // Per-track files + global.json are untouched
    assert.deepEqual(fs.readdirSync(tracksDir).sort(), snapshotTrackFiles);
    assert.equal(
      fs.readFileSync(path.join(stateDir, GLOBAL_STATE_FILE), 'utf8'),
      globalBefore,
      'global.json unchanged on re-run',
    );
    const sentinelStatAfter = fs.statSync(path.join(stateDir, MIGRATED_SENTINEL));
    assert.equal(sentinelStatAfter.mtimeMs, sentinelStatBefore.mtimeMs, 'sentinel not rewritten');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('write path: split state persists per-track fields into per-track files only', async () => {
  const tmp = mktmp();
  try {
    // Start fresh → split layout is active.
    migrateStateIfNeeded(tmp);

    const service = new UserStateService(tmp);
    await service.writeUserState(makeRichState());

    const globalOnDisk = readJson(path.join(tmp, STATE_SUBDIR, GLOBAL_STATE_FILE));
    for (const key of PER_TRACK_KEYS) {
      assert.ok(!(key in globalOnDisk), `write path leaked "${key}" into global.json`);
    }
    assert.equal(globalOnDisk.albumTitle, 'Test Album');

    const trackFiles = fs.readdirSync(path.join(tmp, STATE_SUBDIR, TRACKS_SUBDIR));
    assert.ok(trackFiles.length >= 2, 'per-track files written');

    // Second write with one song removed should prune its per-track file.
    const state = makeRichState();
    delete state.songRatings['song-b'];
    delete state.songChecklists['song-b'];
    delete state.perSongRestoreReferenceEnabled['song-b'];
    delete state.aiEqRecommendations['song-b'];

    await service.writeUserState(state);
    const after = fs.readdirSync(path.join(tmp, STATE_SUBDIR, TRACKS_SUBDIR));
    // Filenames are base64url(utf8) of songId — derive the expected name
    // explicitly so this test stays correct regardless of encoding scheme.
    const songBFilename = `${Buffer.from('song-b', 'utf8').toString('base64url')}.json`;
    assert.equal(
      after.includes(songBFilename),
      false,
      'orphaned per-track file for song-b was pruned',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
