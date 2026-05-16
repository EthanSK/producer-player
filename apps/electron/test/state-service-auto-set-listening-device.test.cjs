/**
 * v3.215 — regression pins for the per-song
 * `songAutoSetListeningDeviceOnOpen` toggle (voice 3129 / 3130).
 *
 * Behavioral contract this file pins:
 *
 *   1. The field is registered in `PER_TRACK_KEYS` so the split-to-disk
 *      pipeline hoists each song's value into its own per-track bucket
 *      (matches the songDawOffsets / perSongRestoreReferenceEnabled model
 *      and prevents accidental regression to an app-global field).
 *   2. `parseUserState` round-trips a sparse `Record<string, boolean>` map
 *      — only explicit values are persisted; absent songs default to ON
 *      at the read layer (which lives in the renderer, NOT the parser).
 *   3. Malformed values (non-boolean, missing key, empty songId) drop
 *      gracefully without throwing or corrupting other songs' entries.
 *   4. `splitStateForDisk` routes each song's toggle into its own bucket
 *      and not into the global field set or the wrong song's bucket.
 *   5. `createDefaultUserState` initializes the field to an empty object
 *      so renderer reads always succeed without an "undefined" guard.
 */
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PER_TRACK_KEYS,
  createDefaultUserState,
  parseUserState,
  splitStateForDisk,
} = require('../dist/state-service.test.cjs');

test('songAutoSetListeningDeviceOnOpen is registered as a PER_TRACK_KEY', () => {
  assert.ok(
    PER_TRACK_KEYS.includes('songAutoSetListeningDeviceOnOpen'),
    'songAutoSetListeningDeviceOnOpen MUST live in PER_TRACK_KEYS so the ' +
      'split-to-disk pipeline hoists per-song values into per-track files. ' +
      'If this assertion fails, the toggle has regressed to app-global storage.',
  );
});

test('createDefaultUserState initializes songAutoSetListeningDeviceOnOpen as an empty map', () => {
  const state = createDefaultUserState();
  assert.deepEqual(state.songAutoSetListeningDeviceOnOpen, {});
});

test('parseUserState preserves per-song shape with distinct boolean values per songId', () => {
  const parsed = parseUserState({
    ...createDefaultUserState(),
    songAutoSetListeningDeviceOnOpen: {
      'song-on': true,
      'song-off': false,
    },
  });
  assert.deepEqual(parsed.songAutoSetListeningDeviceOnOpen, {
    'song-on': true,
    'song-off': false,
  });
});

test('parseUserState drops non-boolean entries without affecting valid ones', () => {
  const parsed = parseUserState({
    ...createDefaultUserState(),
    songAutoSetListeningDeviceOnOpen: {
      'song-good': false,
      'song-bad': 'yes',
      'song-bad-2': 1,
      '': true, // empty songId is also invalid
    },
  });
  assert.deepEqual(parsed.songAutoSetListeningDeviceOnOpen, {
    'song-good': false,
  });
});

test('parseUserState falls back to empty map when input is not an object', () => {
  const parsedNull = parseUserState({
    ...createDefaultUserState(),
    songAutoSetListeningDeviceOnOpen: null,
  });
  assert.deepEqual(parsedNull.songAutoSetListeningDeviceOnOpen, {});

  const parsedArr = parseUserState({
    ...createDefaultUserState(),
    songAutoSetListeningDeviceOnOpen: ['nope'],
  });
  assert.deepEqual(parsedArr.songAutoSetListeningDeviceOnOpen, {});

  const parsedMissing = parseUserState({
    ...createDefaultUserState(),
  });
  // Default behavior: missing field becomes empty object.
  assert.deepEqual(parsedMissing.songAutoSetListeningDeviceOnOpen, {});
});

test('splitStateForDisk hoists each songId into its own per-track bucket', () => {
  const state = {
    ...createDefaultUserState(),
    songOrder: ['song-on', 'song-off'],
    songAutoSetListeningDeviceOnOpen: {
      'song-on': true,
      'song-off': false,
    },
  };

  const { globalFields, trackBuckets } = splitStateForDisk(state);
  // Field MUST NOT survive in the global bucket — that would re-introduce
  // app-global storage and break per-song isolation.
  assert.ok(
    !('songAutoSetListeningDeviceOnOpen' in globalFields),
    'songAutoSetListeningDeviceOnOpen leaked into globalFields — split-to-disk ' +
      'pipeline failure',
  );

  const songOn = trackBuckets.get('song-on');
  const songOff = trackBuckets.get('song-off');
  assert.ok(songOn, 'song-on bucket missing');
  assert.ok(songOff, 'song-off bucket missing');
  assert.equal(songOn.songAutoSetListeningDeviceOnOpen, true);
  assert.equal(songOff.songAutoSetListeningDeviceOnOpen, false);
});

test('splitStateForDisk does not create buckets for songs that lack an entry', () => {
  const state = {
    ...createDefaultUserState(),
    songOrder: ['song-a', 'song-b'],
    songAutoSetListeningDeviceOnOpen: {
      'song-a': false,
      // song-b has no entry; should NOT get a bucket from this field alone.
    },
  };
  const { trackBuckets } = splitStateForDisk(state);
  assert.ok(trackBuckets.has('song-a'), 'song-a bucket missing');
  assert.ok(
    !trackBuckets.has('song-b'),
    'song-b should not get a bucket purely from missing autoSet entry — ' +
      'absence === ON default at render time',
  );
});

test('parseUserState keeps song-a and song-b values independent (no cross-bleed)', () => {
  const parsed = parseUserState({
    ...createDefaultUserState(),
    songAutoSetListeningDeviceOnOpen: {
      'song-a': false,
      'song-b': true,
    },
  });
  assert.equal(parsed.songAutoSetListeningDeviceOnOpen['song-a'], false);
  assert.equal(parsed.songAutoSetListeningDeviceOnOpen['song-b'], true);
});
