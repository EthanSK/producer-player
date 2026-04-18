/**
 * Regression: bug fix 2026-04-18
 *
 * Before the fix, launching Producer Player with a persisted per-song
 * reference track pointing at a file that had been moved / deleted /
 * unmounted caused the renderer to auto-restore it on song select. The
 * reference-track fetch hit the producer-media:// protocol (which
 * returned 404 because the file wasn't there) and the resulting
 * `Failed to fetch analysis source (404).` error was set as
 * `referenceError` and rendered as a red banner inside the compact
 * mastering reference panel — even though the user hadn't just tried
 * to load anything.
 *
 * Expected behaviour: an auto-restored reference that can't be found
 * should fall through to the idle empty state, prune the stale
 * persisted pointer so the same error doesn't re-fire next launch, and
 * leave no error banner visible.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test('missing persisted reference track falls through to empty state, no error banner', async () => {
  const dirs = await createE2ETestDirectories('reference-track-empty-state');

  await writeFixtureFiles(dirs.fixtureDirectory, [
    { relativePath: 'Test Song v1.wav', contents: 'RIFF reference-test' },
  ]);

  const bogusReferencePath = path.join(
    dirs.fixtureDirectory,
    '__this_file_has_been_moved_away__.wav'
  );

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    // 1. Link the fixture folder so we have a real song row.
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // Capture the real generated song id so we can key localStorage to it.
    const songId = await page
      .getByTestId('main-list-row')
      .first()
      .getAttribute('data-song-id');
    expect(songId).not.toBeNull();
    expect(songId).not.toBe('');

    // 2. Seed localStorage with a saved reference + per-song reference entry
    //    that both point at a path that does NOT exist on disk. This is the
    //    exact state a user would land in after deleting / moving an
    //    external reference file between sessions.
    //
    //    v3.16.0: also flip the per-song "restore reference on open" toggle
    //    ON, because the restore-on-switch path is now opt-in and this
    //    regression test exists precisely to cover the restore-then-prune
    //    flow. Without this flag the restore pipeline never runs, no 404 is
    //    hit, no pruning happens — and the test would spuriously "pass"
    //    (stale pointer would still be on disk, but nothing would trigger
    //    the banner we're guarding against either).
    await page.evaluate(
      (args) => {
        const { songId, bogusPath } = args;
        window.localStorage.setItem(
          'producer-player.saved-reference-tracks.v1',
          JSON.stringify([
            {
              filePath: bogusPath,
              fileName: '__this_file_has_been_moved_away__.wav',
              dateLastUsed: new Date().toISOString(),
              integratedLufs: null,
            },
          ])
        );
        window.localStorage.setItem(
          `producer-player.reference-track.${songId}`,
          bogusPath
        );
        // v3.16.0 opt-in for auto-restore on song switch.
        window.localStorage.setItem(
          `producer-player.restore-reference.${songId}`,
          '1'
        );
      },
      { songId: songId as string, bogusPath: bogusReferencePath }
    );

    // 3. Reload so the renderer boots with the seeded stale state.
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // 4. Select the song. This is what triggers the auto-restore useEffect
    //    that calls handleLoadReferenceByFilePath -> loadReferenceTrack.
    await page.getByTestId('main-list-row').first().click();

    // Give the async resolve + analyze pipeline plenty of time to fail in
    // the legacy path before we assert the banner is NOT there.
    await page.waitForTimeout(2500);

    // 5. Assert: no red reference-error banner anywhere in the DOM.
    await expect(page.getByTestId('analysis-reference-error')).toHaveCount(0);

    // 6. Assert: the stale per-song pointer was pruned so we don't
    //    re-error on next launch. (The saved-list entry is also pruned;
    //    we check both.)
    const prunedState = await page.evaluate((sid) => ({
      perSong: window.localStorage.getItem(
        `producer-player.reference-track.${sid}`
      ),
      savedRaw: window.localStorage.getItem(
        'producer-player.saved-reference-tracks.v1'
      ),
    }), songId as string);

    expect(prunedState.perSong).toBeNull();
    const savedParsed = prunedState.savedRaw
      ? (JSON.parse(prunedState.savedRaw) as Array<{ filePath: string }>)
      : [];
    expect(savedParsed.find((entry) => entry.filePath === bogusReferencePath)).toBeUndefined();

    // 7. The unified user-state file on disk must also be pruned. Without
    //    this, the `producer-player-user-state.json` migration block would
    //    re-seed the stale entry into localStorage on the next launch and
    //    the same error banner would re-surface. Give the debounced sync
    //    (500ms) plenty of room before reading.
    await page.waitForTimeout(1500);
    const userStatePath = path.join(
      dirs.userDataDirectory,
      'producer-player-user-state.json'
    );
    const rawUserState = await fs.readFile(userStatePath, 'utf8');
    const parsedUserState = JSON.parse(rawUserState) as {
      perSongReferenceTracks?: Record<string, string>;
    };
    // Either the key was removed entirely, or the map simply doesn't contain it.
    expect(parsedUserState.perSongReferenceTracks?.[songId as string]).toBeUndefined();
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
