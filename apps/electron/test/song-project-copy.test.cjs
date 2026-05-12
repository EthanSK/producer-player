/**
 * v3.189.0 — Unit tests for save-copy of a song's project file.
 *
 * Covers the pure filename + collision-bumping logic and the
 * dependency-injected file-system handler. We avoid touching the real
 * filesystem so the suite stays hermetic in CI.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

const {
  saveSongProjectCopy,
  SAVE_COPY_MAX_COLLISION_ATTEMPTS,
  __testing__,
} = require('../dist/song-project-copy.test.cjs');

const {
  buildSaveCopyFileName,
  stripVersionSuffix,
  splitExtension,
  applyCollisionSuffix,
  extractVersionNumberFromFileName,
  computeNextSaveCopyVersion,
} = __testing__;

// ---------------------------------------------------------------------------
// Pure filename helpers
// ---------------------------------------------------------------------------

test('splitExtension only treats the final dotted segment as the extension', () => {
  assert.deepEqual(splitExtension('barber smith.als'), {
    stem: 'barber smith',
    extension: '.als',
  });
  assert.deepEqual(splitExtension('foo.bar.als'), {
    stem: 'foo.bar',
    extension: '.als',
  });
  assert.deepEqual(splitExtension('no-extension'), {
    stem: 'no-extension',
    extension: '',
  });
});

test('stripVersionSuffix removes trailing version tokens (case-insensitive)', () => {
  assert.equal(stripVersionSuffix('barber smith v47'), 'barber smith');
  assert.equal(stripVersionSuffix('barber smith V12'), 'barber smith');
  assert.equal(stripVersionSuffix('barber smith v3 archived 2'), 'barber smith');
  assert.equal(stripVersionSuffix('intro-v9'), 'intro');
  assert.equal(stripVersionSuffix('barber smith'), 'barber smith');
});

test('buildSaveCopyFileName cleans an existing version suffix before re-applying', () => {
  assert.equal(buildSaveCopyFileName('barber smith.als', 48), 'barber smith v48.als');
  assert.equal(buildSaveCopyFileName('barber smith v47.als', 48), 'barber smith v48.als');
  assert.equal(buildSaveCopyFileName('barber smith V3.als', 4), 'barber smith v4.als');
  assert.equal(buildSaveCopyFileName('foo.bar.als', 2), 'foo.bar v2.als');
});

test('buildSaveCopyFileName handles a stem with no extension', () => {
  // When the source has no extension the result has none either.
  assert.equal(buildSaveCopyFileName('mystery', 7), 'mystery v7');
});

test('buildSaveCopyFileName leaves dotfile-style names alone (extname == "")', () => {
  // Node's path.extname treats `.als` as a dotfile with no extension,
  // so the entire string stays in the stem.
  assert.equal(buildSaveCopyFileName('.als', 2), '.als v2');
});

test('buildSaveCopyFileName rejects invalid target versions', () => {
  assert.throws(() => buildSaveCopyFileName('foo.als', 0), /Invalid target version/);
  assert.throws(() => buildSaveCopyFileName('foo.als', -1), /Invalid target version/);
  assert.throws(() => buildSaveCopyFileName('foo.als', Number.NaN), /Invalid target version/);
});

test('applyCollisionSuffix inserts an (N) disambiguator before the extension', () => {
  assert.equal(applyCollisionSuffix('barber smith v48.als', 1), 'barber smith v48.als');
  assert.equal(applyCollisionSuffix('barber smith v48.als', 2), 'barber smith v48 (2).als');
  assert.equal(applyCollisionSuffix('barber smith v48.als', 7), 'barber smith v48 (7).als');
});

test('extractVersionNumberFromFileName mirrors the renderer regex', () => {
  assert.equal(extractVersionNumberFromFileName('barber smith.wav'), null);
  assert.equal(extractVersionNumberFromFileName('barber smith v47.wav'), 47);
  assert.equal(extractVersionNumberFromFileName('barber smith V3.wav'), 3);
  assert.equal(extractVersionNumberFromFileName('barber smith v9 archived 2.wav'), 9);
  assert.equal(extractVersionNumberFromFileName('barber smith.als'), null);
});

test('computeNextSaveCopyVersion picks max(existing) + 1, falling back to 1', () => {
  assert.equal(computeNextSaveCopyVersion([]), 1);
  assert.equal(computeNextSaveCopyVersion(['barber smith.wav']), 1);
  assert.equal(
    computeNextSaveCopyVersion(['barber smith v3.wav', 'barber smith v5.wav', 'barber smith v2.wav']),
    6
  );
  assert.equal(
    computeNextSaveCopyVersion(['intro v1.wav', 'intro v1 archived 1.wav', 'intro v10.wav']),
    11
  );
});

// ---------------------------------------------------------------------------
// saveSongProjectCopy() handler (dependency-injected filesystem)
// ---------------------------------------------------------------------------

function makeFakeFs(existingPaths) {
  const existing = new Set(existingPaths);
  const copies = [];
  return {
    copies,
    async exists(filePath) {
      return existing.has(filePath);
    },
    async copyFile(source, destination) {
      if (existing.has(destination)) {
        throw new Error(`refusing to overwrite ${destination}`);
      }
      copies.push({ source, destination });
      existing.add(destination);
    },
  };
}

test('save-copy of foo.als with no existing copy lands at foo v<N>.als', async () => {
  const fakeFs = makeFakeFs(['/songs/foo.als']);
  const result = await saveSongProjectCopy(
    { originalPath: '/songs/foo.als', targetVersion: 4 },
    fakeFs
  );

  assert.equal(result.ok, true);
  assert.equal(result.newPath, join('/songs', 'foo v4.als'));
  assert.equal(result.newFileName, 'foo v4.als');
  assert.equal(result.targetVersion, 4);
  assert.deepEqual(fakeFs.copies, [
    { source: '/songs/foo.als', destination: join('/songs', 'foo v4.als') },
  ]);
});

test('save-copy of foo v3.als strips the existing suffix before re-applying', async () => {
  const fakeFs = makeFakeFs(['/songs/foo v3.als']);
  const result = await saveSongProjectCopy(
    { originalPath: '/songs/foo v3.als', targetVersion: 12 },
    fakeFs
  );

  assert.equal(result.ok, true);
  assert.equal(result.newFileName, 'foo v12.als');
  assert.equal(result.newPath, join('/songs', 'foo v12.als'));
});

test('destination collisions auto-bump (2), (3), ... until free', async () => {
  const fakeFs = makeFakeFs([
    '/songs/foo.als',
    '/songs/foo v4.als',
    '/songs/foo v4 (2).als',
  ]);
  const result = await saveSongProjectCopy(
    { originalPath: '/songs/foo.als', targetVersion: 4 },
    fakeFs
  );

  assert.equal(result.ok, true);
  assert.equal(result.newFileName, 'foo v4 (3).als');
  assert.equal(result.newPath, join('/songs', 'foo v4 (3).als'));
});

test('save-copy returns ok:false when the source file is missing', async () => {
  const fakeFs = makeFakeFs([]);
  const result = await saveSongProjectCopy(
    { originalPath: '/songs/missing.als', targetVersion: 2 },
    fakeFs
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /no longer exists/);
  assert.equal(fakeFs.copies.length, 0);
});

test('save-copy returns ok:false on an empty original path', async () => {
  const fakeFs = makeFakeFs([]);
  const result = await saveSongProjectCopy(
    { originalPath: '   ', targetVersion: 2 },
    fakeFs
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /empty/);
});

test('save-copy returns ok:false on a non-finite target version', async () => {
  const fakeFs = makeFakeFs(['/songs/foo.als']);
  const result = await saveSongProjectCopy(
    { originalPath: '/songs/foo.als', targetVersion: Number.NaN },
    fakeFs
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid target version/);
});

test('save-copy falls back to v1 inputs (caller-supplied) for songs with no audio versions', async () => {
  // computeNextSaveCopyVersion([]) === 1, exercised end-to-end here.
  assert.equal(computeNextSaveCopyVersion([]), 1);

  const fakeFs = makeFakeFs(['/songs/intro.als']);
  const result = await saveSongProjectCopy(
    { originalPath: '/songs/intro.als', targetVersion: 1 },
    fakeFs
  );

  assert.equal(result.ok, true);
  assert.equal(result.newFileName, 'intro v1.als');
});

test('save-copy handles filenames with spaces and multiple dots', async () => {
  const fakeFs = makeFakeFs(['/My Songs/cool track v2.bar.als']);
  const result = await saveSongProjectCopy(
    { originalPath: '/My Songs/cool track v2.bar.als', targetVersion: 3 },
    fakeFs
  );

  assert.equal(result.ok, true);
  // Only the final `.als` is the extension; `.bar` stays in the stem.
  assert.equal(result.newFileName, 'cool track v2.bar v3.als');
  assert.equal(result.newPath, join('/My Songs', 'cool track v2.bar v3.als'));
});

test('save-copy gives up after SAVE_COPY_MAX_COLLISION_ATTEMPTS', async () => {
  const blocked = new Set(['/songs/foo.als']);
  blocked.add('/songs/foo v4.als');
  for (let n = 2; n <= SAVE_COPY_MAX_COLLISION_ATTEMPTS; n += 1) {
    blocked.add(join('/songs', `foo v4 (${n}).als`));
  }
  const fakeFs = {
    async exists(filePath) {
      return blocked.has(filePath);
    },
    async copyFile() {
      throw new Error('should not be reached when all slots are full');
    },
  };

  const result = await saveSongProjectCopy(
    { originalPath: '/songs/foo.als', targetVersion: 4 },
    fakeFs
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /free filename after/i);
});

test('save-copy surfaces copyFile errors to the caller', async () => {
  const fakeFs = {
    async exists(filePath) {
      return filePath === '/songs/foo.als';
    },
    async copyFile() {
      throw new Error('disk full');
    },
  };

  const result = await saveSongProjectCopy(
    { originalPath: '/songs/foo.als', targetVersion: 2 },
    fakeFs
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /disk full/);
});
