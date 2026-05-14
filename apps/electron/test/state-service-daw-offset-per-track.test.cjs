/**
 * Regression pins for per-track DAW offset persistence.
 *
 * Bug report 2026-05-14 (voice 2934): Ethan saw a DAW offset value on Song B
 * after only ever setting one on Song A and wondered if the field had
 * regressed back to app-global (a known v3.8.0 misdesign that was refactored
 * to per-song in v3.9+). This file pins the per-song write+read shape at the
 * `UserStateService` layer so a future refactor cannot silently re-introduce
 * the leak.
 *
 * What it tests:
 *   1. `songDawOffsets` is in PER_TRACK_KEYS (split-layout machinery picks it
 *      up automatically). Asserted directly in case the constant ever drifts.
 *   2. `parseUserState` keeps a per-song `Record<string, {seconds, enabled}>`
 *      shape — does NOT collapse to a single global value.
 *   3. `splitStateForDisk` hoists each song's entry into its OWN per-track
 *      bucket — Song A's bucket contains Song A's offset, Song B's does not.
 *   4. Full UserStateService round-trip (write → read after invalidate):
 *      Song A's offset persists keyed by Song A's id, Song B's offset
 *      persists keyed by Song B's id, neither leaks to the other.
 *   5. Setting a value for Song B does not mutate Song A's value.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  UserStateService,
  splitStateForDisk,
  parseUserState,
  createDefaultUserState,
  PER_TRACK_KEYS,
} = require('../dist/state-service.test.cjs');

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-daw-offset-per-track-'));
}

test('songDawOffsets is registered as a PER_TRACK_KEY', () => {
  assert.ok(
    PER_TRACK_KEYS.includes('songDawOffsets'),
    'songDawOffsets MUST live in PER_TRACK_KEYS so the split-to-disk pipeline ' +
      'hoists per-song values into per-track files. If this assertion fails, ' +
      'the DAW offset has regressed to app-global storage.',
  );
});

test('parseUserState preserves per-song shape with distinct values per songId', () => {
  const raw = {
    ...createDefaultUserState(),
    songDawOffsets: {
      'song-a': { seconds: 42, enabled: true },
      'song-b': { seconds: 90, enabled: false },
      'song-c': { seconds: 0, enabled: true },
    },
  };
  const parsed = parseUserState(raw);

  assert.deepEqual(parsed.songDawOffsets, {
    'song-a': { seconds: 42, enabled: true },
    'song-b': { seconds: 90, enabled: false },
    'song-c': { seconds: 0, enabled: true },
  });

  // No collapsing to a single global value — each songId retains independent
  // seconds and enabled.
  assert.notDeepEqual(
    parsed.songDawOffsets['song-a'],
    parsed.songDawOffsets['song-b'],
    "Song A and Song B's offsets should be independent — if they're equal " +
      'after parse, the parse layer is corrupting per-song state.',
  );
});

test('splitStateForDisk routes each song offset into its own bucket only', () => {
  const state = {
    ...createDefaultUserState(),
    songOrder: ['song-a', 'song-b'],
    songDawOffsets: {
      'song-a': { seconds: 42, enabled: true },
      'song-b': { seconds: 90, enabled: false },
    },
  };

  const { globalFields, trackBuckets } = splitStateForDisk(state);

  // Per-track field must NOT appear in globalFields.
  assert.ok(
    !('songDawOffsets' in globalFields),
    'songDawOffsets should be stripped from globalFields by splitStateForDisk',
  );

  const songA = trackBuckets.get('song-a');
  const songB = trackBuckets.get('song-b');
  assert.ok(songA, 'song-a bucket should exist');
  assert.ok(songB, 'song-b bucket should exist');

  // Critical: Song A's bucket holds ONLY Song A's offset shape; Song B's
  // bucket holds ONLY Song B's. The split-to-disk pipeline lifts the
  // per-songId entry directly under the key name (the inner Record is
  // flattened to the entry value).
  assert.deepEqual(songA.songDawOffsets, { seconds: 42, enabled: true });
  assert.deepEqual(songB.songDawOffsets, { seconds: 90, enabled: false });

  // Cross-leak guard.
  assert.notDeepEqual(
    songA.songDawOffsets,
    songB.songDawOffsets,
    'Song A and Song B should have distinct offset shapes after splitStateForDisk',
  );
});

test('UserStateService round-trip preserves per-song DAW offsets without leaking', async () => {
  const tmp = mktmp();
  try {
    const service = new UserStateService(tmp);

    const initial = await service.readUserState();
    // Empty map on a fresh install.
    assert.deepEqual(initial.songDawOffsets, {});

    // --- Step 1: set Song A's offset to 42s enabled, write. ---
    const step1 = {
      ...initial,
      songDawOffsets: {
        'song-a': { seconds: 42, enabled: true },
      },
    };
    await service.writeUserState(step1);
    service.invalidateCache();

    const afterA = await service.readUserState();
    assert.deepEqual(afterA.songDawOffsets, {
      'song-a': { seconds: 42, enabled: true },
    });
    // Song B has no entry — UI fallback to last-used default is a UI concern,
    // not a persisted-state leak.
    assert.equal(
      afterA.songDawOffsets['song-b'],
      undefined,
      'Song B should have no persisted entry after only Song A was written',
    );

    // --- Step 2: set Song B's offset to 90s disabled, write. ---
    const step2 = {
      ...afterA,
      songDawOffsets: {
        ...afterA.songDawOffsets,
        'song-b': { seconds: 90, enabled: false },
      },
    };
    await service.writeUserState(step2);
    service.invalidateCache();

    const afterB = await service.readUserState();
    assert.deepEqual(afterB.songDawOffsets, {
      'song-a': { seconds: 42, enabled: true },
      'song-b': { seconds: 90, enabled: false },
    });

    // Song A's value MUST be unchanged after writing Song B.
    assert.deepEqual(
      afterB.songDawOffsets['song-a'],
      { seconds: 42, enabled: true },
      'Writing Song B must not mutate Song A — leak guard',
    );

    // --- Step 3: re-update Song A only; Song B must survive untouched. ---
    const step3 = {
      ...afterB,
      songDawOffsets: {
        ...afterB.songDawOffsets,
        'song-a': { seconds: 7, enabled: false },
      },
    };
    await service.writeUserState(step3);
    service.invalidateCache();

    const afterA2 = await service.readUserState();
    assert.deepEqual(afterA2.songDawOffsets, {
      'song-a': { seconds: 7, enabled: false },
      'song-b': { seconds: 90, enabled: false },
    });
    assert.deepEqual(
      afterA2.songDawOffsets['song-b'],
      { seconds: 90, enabled: false },
      'Updating Song A must not mutate Song B — leak guard',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('checklistDawOffsetDefault* fields are silently ignored on parse (v3.206 removed seeding)', () => {
  // Voice 2938 (v3.206): the app-global "last-used default" seed pair was
  // removed. A song with no `songDawOffsets` entry renders 0:00/disabled
  // in the UI — there is no longer any seed read from the parsed state.
  // The fields stay on disk for any v3.9–v3.205 user-state file but are
  // dropped from the parsed shape; the next debounced write naturally
  // strips them. This test pins that contract.
  const raw = {
    ...createDefaultUserState(),
    // Force-inject legacy fields onto the raw input even though they're no
    // longer in the contract. parseUserState should ignore them.
    checklistDawOffsetDefaultSeconds: 42,
    checklistDawOffsetDefaultEnabled: true,
  };
  const parsed = parseUserState(raw);
  assert.equal(
    parsed.checklistDawOffsetDefaultSeconds,
    undefined,
    'checklistDawOffsetDefaultSeconds must NOT survive parseUserState (v3.206)',
  );
  assert.equal(
    parsed.checklistDawOffsetDefaultEnabled,
    undefined,
    'checklistDawOffsetDefaultEnabled must NOT survive parseUserState (v3.206)',
  );

  // And the field is gone from the default-state shape too.
  const defaults = createDefaultUserState();
  assert.equal(
    'checklistDawOffsetDefaultSeconds' in defaults,
    false,
    'createDefaultUserState must not include checklistDawOffsetDefaultSeconds (v3.206)',
  );
  assert.equal(
    'checklistDawOffsetDefaultEnabled' in defaults,
    false,
    'createDefaultUserState must not include checklistDawOffsetDefaultEnabled (v3.206)',
  );
});

test('a song with no songDawOffsets entry has no offset value (UI must fall back to 0/disabled)', () => {
  // v3.206 contract pin: songs without an entry in `songDawOffsets` MUST
  // not get any persisted offset, so the renderer's read fallback
  // (`{ seconds: 0, enabled: false }`) is the only value such a song
  // ever displays. Pre-v3.206 the UI seeded from the app-global default;
  // voice 2938 explicitly killed that behavior.
  const raw = {
    ...createDefaultUserState(),
    songDawOffsets: {
      'song-a': { seconds: 42, enabled: true },
    },
  };
  const parsed = parseUserState(raw);
  assert.deepEqual(parsed.songDawOffsets, {
    'song-a': { seconds: 42, enabled: true },
  });
  assert.equal(parsed.songDawOffsets['song-b'], undefined);
  assert.equal(parsed.songDawOffsets['song-untouched'], undefined);
});
