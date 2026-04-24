const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { FileLibraryService } = require('../dist/file-library-service.js');
const {
  cleanupDirectory,
  createTemporaryDirectory,
  listRelativeFiles,
  writeFixtureFiles,
} = require('./helpers/messy-folder-fixture.cjs');

async function withService(options, run) {
  const service = new FileLibraryService(options);

  try {
    return await run(service);
  } finally {
    await service.dispose();
  }
}

test('scanner indexes only intended top-level audio files and ignores nested random folders', async () => {
  const fixtureDirectory = await createTemporaryDirectory('producer-player-domain-messy-');

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Signal v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Signalv2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
      {
        relativePath: 'random/deep/IgnoreMe v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:03.000Z'),
      },
      {
        relativePath: '.hidden/Hidden v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:05.000Z'),
      },
      {
        relativePath: 'notes/readme.txt',
      },
    ]);

    await withService({ autoMoveOld: false }, async (service) => {
      const snapshot = await service.linkFolder(fixtureDirectory);

      assert.equal(snapshot.songs.length, 1);
      assert.equal(snapshot.versions.length, 2);
      assert(snapshot.versions.every((version) => path.dirname(version.filePath) === fixtureDirectory));
      assert(
        snapshot.versions.every((version) =>
          ['Signal v1.wav', 'Signalv2.wav'].includes(path.basename(version.filePath))
        )
      );
    });
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('old/ version-history moves are deterministic and avoid timestamp-based archive names', async () => {
  const fixtureDirectory = await createTemporaryDirectory('producer-player-domain-old-history-');

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Leaky v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Leakyv2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
      {
        relativePath: 'Leaky-v3.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:03.000Z'),
      },
      {
        relativePath: 'old/Leaky v1.wav',
        modifiedAtMs: Date.parse('2025-12-01T00:00:00.000Z'),
      },
    ]);

    await withService({ autoMoveOld: true }, async (service) => {
      const firstSnapshot = await service.linkFolder(fixtureDirectory);

      assert.equal(firstSnapshot.songs.length, 1);
      assert.deepEqual(
        firstSnapshot.songs[0].versions.map((version) => version.fileName).sort(),
        ['Leaky v1-archived-1.wav', 'Leaky v1.wav', 'Leaky-v3.wav', 'Leakyv2.wav'].sort()
      );
      assert.equal(firstSnapshot.songs[0].versions[0].fileName, 'Leaky-v3.wav');

      // Running organize again should be stable and not create new archive variants.
      await service.organizeOldVersions();
      const rescanned = await service.rescanLibrary();

      assert.equal(rescanned.songs.length, 1);
      assert.deepEqual(
        rescanned.songs[0].versions.map((version) => version.fileName).sort(),
        ['Leaky v1-archived-1.wav', 'Leaky v1.wav', 'Leaky-v3.wav', 'Leakyv2.wav'].sort()
      );
      assert.equal(rescanned.songs[0].versions[0].fileName, 'Leaky-v3.wav');
    });

    const filesAfterOrganize = await listRelativeFiles(fixtureDirectory);

    assert.deepEqual(filesAfterOrganize, [
      'Leaky-v3.wav',
      'old/Leaky v1-archived-1.wav',
      'old/Leaky v1.wav',
      'old/Leakyv2.wav',
    ]);
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('auto-organize promotes the newest version out of old/ and archives the previous current export', async () => {
  const fixtureDirectory = await createTemporaryDirectory('producer-player-domain-old-promotion-');

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Pulse v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Pulse v2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
      {
        relativePath: 'old/Pulse-v3.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:03.000Z'),
      },
    ]);

    await withService({ autoMoveOld: true }, async (service) => {
      const firstSnapshot = await service.linkFolder(fixtureDirectory);

      assert.equal(firstSnapshot.songs.length, 1);
      assert.equal(firstSnapshot.songs[0].versions[0].fileName, 'Pulse-v3.wav');
      assert.equal(path.dirname(firstSnapshot.songs[0].versions[0].filePath), fixtureDirectory);
      assert.deepEqual(
        firstSnapshot.songs[0].versions.map((version) => version.fileName).sort(),
        ['Pulse v1.wav', 'Pulse v2.wav', 'Pulse-v3.wav'].sort()
      );

      await service.organizeOldVersions();
      const rescanned = await service.rescanLibrary();

      assert.equal(rescanned.songs.length, 1);
      assert.equal(rescanned.songs[0].versions[0].fileName, 'Pulse-v3.wav');
      assert.equal(path.dirname(rescanned.songs[0].versions[0].filePath), fixtureDirectory);
    });

    const filesAfterOrganize = await listRelativeFiles(fixtureDirectory);

    assert.deepEqual(filesAfterOrganize, [
      'Pulse-v3.wav',
      'old/Pulse v1.wav',
      'old/Pulse v2.wav',
    ]);
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('actual-song ordering persists after organize + rescan operations', async () => {
  const fixtureDirectory = await createTemporaryDirectory('producer-player-domain-order-');

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Alpha v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Alphav2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
      {
        relativePath: 'Beta v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:03.000Z'),
      },
      {
        relativePath: 'Gamma_v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:04.000Z'),
      },
    ]);

    await withService({ autoMoveOld: false }, async (service) => {
      const linked = await service.linkFolder(fixtureDirectory);
      assert.equal(linked.songs.length, 3);

      const titleToSongId = new Map(linked.songs.map((song) => [song.title, song.id]));
      const desiredOrder = ['Alpha', 'Gamma', 'Beta']
        .map((title) => titleToSongId.get(title))
        .filter(Boolean);

      assert.equal(desiredOrder.length, 3);

      const reordered = await service.reorderSongs(desiredOrder);
      assert.deepEqual(
        reordered.songs.map((song) => song.title),
        ['Alpha', 'Gamma', 'Beta']
      );

      const organized = await service.organizeOldVersions();
      assert.deepEqual(
        organized.songs.map((song) => song.title),
        ['Alpha', 'Gamma', 'Beta']
      );

      const rescanned = await service.rescanLibrary();
      assert.deepEqual(
        rescanned.songs.map((song) => song.title),
        ['Alpha', 'Gamma', 'Beta']
      );
    });
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('unlink + relink starts from fresh ordering state instead of stale reordered state', async () => {
  const fixtureDirectory = await createTemporaryDirectory('producer-player-domain-unlink-');

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Alpha v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Beta v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:04.000Z'),
      },
    ]);

    await withService({ autoMoveOld: false }, async (service) => {
      const linked = await service.linkFolder(fixtureDirectory);
      assert.deepEqual(linked.songs.map((song) => song.title), ['Beta', 'Alpha']);

      const alphaSongId = linked.songs.find((song) => song.title === 'Alpha')?.id;
      const betaSongId = linked.songs.find((song) => song.title === 'Beta')?.id;

      assert(alphaSongId);
      assert(betaSongId);

      const reordered = await service.reorderSongs([alphaSongId, betaSongId]);
      assert.deepEqual(reordered.songs.map((song) => song.title), ['Alpha', 'Beta']);

      const linkedFolderId = reordered.linkedFolders[0]?.id;
      assert(linkedFolderId);

      const afterUnlink = await service.unlinkFolder(linkedFolderId);
      assert.equal(afterUnlink.songs.length, 0);
      assert.equal(afterUnlink.linkedFolders.length, 0);

      const relinked = await service.linkFolder(fixtureDirectory);
      assert.deepEqual(relinked.songs.map((song) => song.title), ['Beta', 'Alpha']);
    });
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('old-only tracks never become album songs, and old/ typos do not fuzzy-match into top-level songs', async () => {
  const fixtureDirectory = await createTemporaryDirectory('producer-player-domain-old-only-');

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Bend the Knees v2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
      {
        relativePath: 'old/Bend the Knees v1.wav',
        modifiedAtMs: Date.parse('2025-12-01T00:00:00.000Z'),
      },
      {
        relativePath: 'old/Bend the Knee v1.wav',
        modifiedAtMs: Date.parse('2025-11-01T00:00:00.000Z'),
      },
      {
        relativePath: 'old/Orphan Song v1.wav',
        modifiedAtMs: Date.parse('2025-10-01T00:00:00.000Z'),
      },
    ]);

    await withService({ autoMoveOld: false }, async (service) => {
      const snapshot = await service.linkFolder(fixtureDirectory);

      assert.deepEqual(snapshot.songs.map((song) => song.title), ['Bend The Knees']);
      assert.equal(snapshot.versions.length, 2);
      assert.deepEqual(
        snapshot.songs[0].versions.map((version) => version.fileName).sort(),
        ['Bend the Knees v1.wav', 'Bend the Knees v2.wav']
      );
      assert.equal(
        snapshot.songs.some((song) => song.normalizedTitle === 'bend the knee'),
        false
      );
      assert.equal(
        snapshot.songs.some((song) => song.normalizedTitle === 'orphan song'),
        false
      );
    });
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('mixed v-suffix naming variants stay grouped, while no-suffix files are ignored', async () => {
  const fixtureDirectory = await createTemporaryDirectory('producer-player-domain-vsuffix-');

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Pulse v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Pulsev2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
      {
        relativePath: 'Pulse_v3.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:03.000Z'),
      },
      {
        relativePath: 'Pulse-v4.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:04.000Z'),
      },
      {
        relativePath: 'Pulse Final.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:05.000Z'),
      },
      {
        relativePath: 'v5.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:06.000Z'),
      },
    ]);

    await withService({ autoMoveOld: false }, async (service) => {
      const snapshot = await service.linkFolder(fixtureDirectory);

      const pulseSong = snapshot.songs.find((song) => song.normalizedTitle === 'pulse');

      assert.equal(snapshot.songs.length, 1);
      assert(pulseSong);
      assert.equal(pulseSong.versions.length, 4);
      assert.equal(
        snapshot.songs.some((song) => song.normalizedTitle === 'pulse final'),
        false
      );
    });
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});
