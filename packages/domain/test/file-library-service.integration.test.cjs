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

test('rescan auto-adds the next version suffix for a newer unversioned export with changed contents', async () => {
  const fixtureDirectory = await createTemporaryDirectory('producer-player-domain-auto-version-');

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Pulse v1.wav',
        contents: 'old mix one',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Pulse v2.wav',
        contents: 'old mix two',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
    ]);

    await withService({ autoMoveOld: false }, async (service) => {
      const linked = await service.linkFolder(fixtureDirectory);
      assert.equal(linked.songs.length, 1);
      assert.equal(linked.songs[0].versions[0].fileName, 'Pulse v2.wav');

      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeFixtureFiles(fixtureDirectory, [
        {
          relativePath: 'Pulse.wav',
          contents: 'new mix three',
          modifiedAtMs: Date.parse('2026-01-01T00:00:03.000Z'),
        },
      ]);

      const rescanned = await service.rescanLibrary();

      assert.equal(rescanned.songs.length, 1);
      assert.equal(rescanned.songs[0].versions[0].fileName, 'Pulse v3.wav');
      assert.deepEqual(
        rescanned.songs[0].versions.map((version) => version.fileName).sort(),
        ['Pulse v1.wav', 'Pulse v2.wav', 'Pulse v3.wav'].sort()
      );
    });

    assert.deepEqual(await listRelativeFiles(fixtureDirectory), [
      'Pulse v1.wav',
      'Pulse v2.wav',
      'Pulse v3.wav',
    ]);
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('rescan leaves newer unversioned exports alone when their contents match the latest version', async () => {
  const fixtureDirectory = await createTemporaryDirectory('producer-player-domain-auto-version-same-');

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Pulse v1.wav',
        contents: 'old mix one',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Pulse v2.wav',
        contents: 'same mix',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
    ]);

    await withService({ autoMoveOld: false }, async (service) => {
      await service.linkFolder(fixtureDirectory);

      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeFixtureFiles(fixtureDirectory, [
        {
          relativePath: 'Pulse.wav',
          contents: 'same mix',
          modifiedAtMs: Date.parse('2026-01-01T00:00:03.000Z'),
        },
      ]);

      const rescanned = await service.rescanLibrary();

      assert.equal(rescanned.songs.length, 1);
      assert.deepEqual(
        rescanned.songs[0].versions.map((version) => version.fileName).sort(),
        ['Pulse v1.wav', 'Pulse v2.wav'].sort()
      );
    });

    assert.deepEqual(await listRelativeFiles(fixtureDirectory), [
      'Pulse v1.wav',
      'Pulse v2.wav',
      'Pulse.wav',
    ]);
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('archiving an old version drags its .asd sidecar along into old/', async () => {
  const fixtureDirectory = await createTemporaryDirectory(
    'producer-player-domain-sidecar-archive-'
  );

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Sidecar v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Sidecar v1.wav.asd',
        contents: 'fake-asd-blob',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Sidecar v2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
      {
        relativePath: 'Sidecar v2.wav.asd',
        contents: 'fake-asd-blob-two',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
    ]);

    await withService({ autoMoveOld: true }, async (service) => {
      await service.linkFolder(fixtureDirectory);
    });

    assert.deepEqual(await listRelativeFiles(fixtureDirectory), [
      'Sidecar v2.wav',
      'Sidecar v2.wav.asd',
      'old/Sidecar v1.wav',
      'old/Sidecar v1.wav.asd',
    ]);
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('archiving an audio file with no sidecars works without errors', async () => {
  const fixtureDirectory = await createTemporaryDirectory(
    'producer-player-domain-sidecar-none-'
  );

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Plain v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Plain v2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
    ]);

    await withService({ autoMoveOld: true }, async (service) => {
      await service.linkFolder(fixtureDirectory);
    });

    assert.deepEqual(await listRelativeFiles(fixtureDirectory), [
      'Plain v2.wav',
      'old/Plain v1.wav',
    ]);
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('promoting an audio file from old/ back to the top drags its sidecar with it', async () => {
  const fixtureDirectory = await createTemporaryDirectory(
    'producer-player-domain-sidecar-promote-'
  );

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Promote v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Promote v2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
      {
        relativePath: 'old/Promote-v3.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:03.000Z'),
      },
      {
        relativePath: 'old/Promote-v3.wav.asd',
        contents: 'fake-asd-blob',
        modifiedAtMs: Date.parse('2026-01-01T00:00:03.000Z'),
      },
    ]);

    await withService({ autoMoveOld: true }, async (service) => {
      await service.linkFolder(fixtureDirectory);
    });

    assert.deepEqual(await listRelativeFiles(fixtureDirectory), [
      'Promote-v3.wav',
      'Promote-v3.wav.asd',
      'old/Promote v1.wav',
      'old/Promote v2.wav',
    ]);
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('multiple sidecar types for the same audio all follow the move', async () => {
  const fixtureDirectory = await createTemporaryDirectory(
    'producer-player-domain-sidecar-multi-'
  );

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Multi v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Multi v1.wav.asd',
        contents: 'ableton',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Multi v1.wav.reapeaks',
        contents: 'reaper',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Multi v1.wav.peak',
        contents: 'logic',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Multi v2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
    ]);

    await withService({ autoMoveOld: true }, async (service) => {
      await service.linkFolder(fixtureDirectory);
    });

    assert.deepEqual(await listRelativeFiles(fixtureDirectory), [
      'Multi v2.wav',
      'old/Multi v1.wav',
      'old/Multi v1.wav.asd',
      'old/Multi v1.wav.peak',
      'old/Multi v1.wav.reapeaks',
    ]);
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('sidecar is not touched when its audio file is missing or already in old/', async () => {
  const fixtureDirectory = await createTemporaryDirectory(
    'producer-player-domain-sidecar-orphan-'
  );

  try {
    // An orphaned sidecar at the top level with no matching top-level audio.
    // The matching audio is already in old/. The audio doesn't need to be
    // moved (it's already where it belongs), so the orphan sidecar must NOT
    // be moved either by the regular organize pass.
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Orphan v1.wav.asd',
        contents: 'orphan-asd',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'old/Orphan v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Orphan v2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
    ]);

    await withService({ autoMoveOld: true }, async (service) => {
      await service.linkFolder(fixtureDirectory);
    });

    // The orphan .asd stays where it was. The current top-level audio (v2)
    // had no sidecar and stays. v1 audio was already in old/ and stays.
    assert.deepEqual(await listRelativeFiles(fixtureDirectory), [
      'Orphan v1.wav.asd',
      'Orphan v2.wav',
      'old/Orphan v1.wav',
    ]);
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('archiving drags arbitrary companion files (unknown extensions) along into old/', async () => {
  const fixtureDirectory = await createTemporaryDirectory(
    'producer-player-domain-sidecar-arbitrary-'
  );

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Custom v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        // A completely unknown / made-up extension. The old whitelist would
        // have left this stranded; the prefix-anchored match takes it.
        relativePath: 'Custom v1.wav.foobarext',
        contents: 'mystery-companion',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Custom v1.wav.bak',
        contents: 'manual-backup',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Custom v1.wav.notes',
        contents: 'producer-notes',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Custom v2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
    ]);

    await withService({ autoMoveOld: true }, async (service) => {
      await service.linkFolder(fixtureDirectory);
    });

    assert.deepEqual(await listRelativeFiles(fixtureDirectory), [
      'Custom v2.wav',
      'old/Custom v1.wav',
      'old/Custom v1.wav.bak',
      'old/Custom v1.wav.foobarext',
      'old/Custom v1.wav.notes',
    ]);
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('archiving drags many heterogeneous companions in a single move', async () => {
  const fixtureDirectory = await createTemporaryDirectory(
    'producer-player-domain-sidecar-many-'
  );

  try {
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Heavy v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Heavy v1.wav.asd',
        contents: 'ableton',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Heavy v1.wav.reapeaks',
        contents: 'reaper',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Heavy v1.wav.bak',
        contents: 'backup',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Heavy v1.wav.notes',
        contents: 'notes',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Heavy v2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
    ]);

    await withService({ autoMoveOld: true }, async (service) => {
      await service.linkFolder(fixtureDirectory);
    });

    assert.deepEqual(await listRelativeFiles(fixtureDirectory), [
      'Heavy v2.wav',
      'old/Heavy v1.wav',
      'old/Heavy v1.wav.asd',
      'old/Heavy v1.wav.bak',
      'old/Heavy v1.wav.notes',
      'old/Heavy v1.wav.reapeaks',
    ]);
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('archiving does NOT pick up same-prefix-but-different-filename audio files', async () => {
  const fixtureDirectory = await createTemporaryDirectory(
    'producer-player-domain-sidecar-prefix-collision-'
  );

  try {
    // `barber smith v45.wav` is the audio we expect to be archived. A
    // separate file `barber smith v45a.wav` has the SAME starting characters
    // but is NOT a companion (no literal-dot separator after the audio
    // filename), so it must NOT be dragged along.
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'barber smith v45.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'barber smith v45.wav.asd',
        contents: 'real-companion',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        // Same starting chars but a different audio file — not a companion.
        relativePath: 'barber smith v45a.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.500Z'),
      },
      {
        relativePath: 'barber smith v46.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
    ]);

    await withService({ autoMoveOld: true }, async (service) => {
      await service.linkFolder(fixtureDirectory);
    });

    // What this test pins down: the companion matcher uses `<audio>.` as a
    // LITERAL prefix (audio filename PLUS a trailing dot), so it must NOT
    // pick up `barber smith v45a.wav` as a companion of `barber smith v45.wav`
    // — there's no separator dot between `v45` and `a`. The real companion
    // (`barber smith v45.wav.asd`) follows its audio into old/.
    //
    // `barber smith v45a.wav` stays at top level here because the version
    // matcher treats it as its own song (the `a` after `v45` breaks the
    // `vNN` grouping rule). The point of this test is the companion match,
    // not the song grouping — what matters is that no companion of v45 grabbed
    // v45a by mistake.
    assert.deepEqual(await listRelativeFiles(fixtureDirectory), [
      'barber smith v45a.wav',
      'barber smith v46.wav',
      'old/barber smith v45.wav',
      'old/barber smith v45.wav.asd',
    ]);
  } finally {
    await cleanupDirectory(fixtureDirectory);
  }
});

test('archiving skips subdirectories whose name matches the companion prefix', async () => {
  const fixtureDirectory = await createTemporaryDirectory(
    'producer-player-domain-sidecar-subdir-'
  );

  try {
    // A directory named `Subdir v1.wav.metadata/` exists with content inside.
    // The prefix-anchored matcher must NOT try to move it as a companion.
    await writeFixtureFiles(fixtureDirectory, [
      {
        relativePath: 'Subdir v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        // Same-prefix file companion — should move.
        relativePath: 'Subdir v1.wav.asd',
        contents: 'companion',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        // Inside a same-prefix subdirectory — directory should be skipped,
        // so this nested file stays in place (and the directory survives).
        relativePath: 'Subdir v1.wav.metadata/inner.txt',
        contents: 'inside-the-dir',
        modifiedAtMs: Date.parse('2026-01-01T00:00:01.000Z'),
      },
      {
        relativePath: 'Subdir v2.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:02.000Z'),
      },
    ]);

    await withService({ autoMoveOld: true }, async (service) => {
      await service.linkFolder(fixtureDirectory);
    });

    // The `.metadata/` directory and its contents stay at the original
    // location; only the regular file companion (`.asd`) follows the audio.
    assert.deepEqual(await listRelativeFiles(fixtureDirectory), [
      'Subdir v1.wav.metadata/inner.txt',
      'Subdir v2.wav',
      'old/Subdir v1.wav',
      'old/Subdir v1.wav.asd',
    ]);
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
