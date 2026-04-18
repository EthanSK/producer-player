/**
 * Regression: bug fix 2026-04-18 (Task 1)
 *
 * When a user explicitly loads a reference track whose underlying file has
 * been moved / deleted since the app last saw it, the friendly error
 * message previously showed only the file's basename:
 *   "Reference file could not be found: track.wav"
 * Ethan asked for the FULL absolute path (or the playback URL, if that's
 * the only locator the renderer has) so he can see where the app expected
 * to find the file. Assert the surfaced error string contains a path-like
 * substring (either "/" or "producer-media://").
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test('missing reference file error message shows the full path, not just the filename', async () => {
  const dirs = await createE2ETestDirectories('reference-file-missing-shows-path');

  await writeFixtureFiles(dirs.fixtureDirectory, [
    { relativePath: 'Anchor Song v1.wav', contents: 'RIFF anchor-test' },
  ]);

  // File that definitely does NOT exist on disk — we seed localStorage with
  // this path as a saved reference and then trigger an explicit load.
  const bogusReferencePath = path.join(
    dirs.fixtureDirectory,
    '__missing_reference_for_path_surface_test__.wav',
  );
  const bogusReferenceName = '__missing_reference_for_path_surface_test__.wav';

  const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

  try {
    // 1. Link a folder so we have a real song row (used as the "active" song
    //    when triggering the reference load).
    await page.evaluate(async (folderPath) => {
      await (
        window as typeof window & {
          producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
        }
      ).producerPlayer.linkFolder(folderPath);
    }, dirs.fixtureDirectory);

    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // 2. Seed the saved-reference-tracks MRU with the bogus path so the UI
    //    exposes the "apply saved reference" button / path. We then invoke
    //    the app's internal reference loader directly via the preload
    //    bridge so this test doesn't depend on the specific DOM widget
    //    surfacing the load button.
    await page.evaluate(
      (bogusPath) => {
        window.localStorage.setItem(
          'producer-player.saved-reference-tracks.v1',
          JSON.stringify([
            {
              filePath: bogusPath,
              fileName: '__missing_reference_for_path_surface_test__.wav',
              dateLastUsed: new Date().toISOString(),
              integratedLufs: null,
            },
          ]),
        );
      },
      bogusReferencePath,
    );

    await page.reload();
    await page.waitForSelector('[data-testid="app-shell"]');
    await expect(page.getByTestId('main-list-row')).toHaveCount(1, { timeout: 15_000 });

    // 3. Select the song so reference-track controls become visible.
    await page.getByTestId('main-list-row').first().click();

    // 4. Explicitly trigger a reference load for the missing path. We use
    //    the saved-reference-tracks button in the reference panel; if the
    //    panel surface has changed, we fall back to calling the renderer's
    //    own handler via the window bridge.
    //
    //    First attempt: click a saved-reference entry. These are rendered
    //    as buttons with the filename text inside the mastering reference
    //    panel's MRU list.
    const savedRefEntry = page
      .getByRole('button', { name: new RegExp(bogusReferenceName.replace(/[.+*?^$()|[\]\\]/g, '\\$&'), 'i') })
      .first();

    const savedRefExists = await savedRefEntry.count().then((n) => n > 0);
    if (savedRefExists) {
      await savedRefEntry.click();
    } else {
      // Fallback: call resolvePlaybackSource + the renderer's load path
      // directly. The renderer exposes a test-friendly setter via the
      // pickReferenceTrack IPC; we simulate the user-picked flow by
      // dispatching a synthetic event that the renderer handler wraps.
      // (If neither path triggers the error, the test will fail the
      // subsequent assertion with a clear message.)
      await page.evaluate(async (bogusPath) => {
        const bridge = (
          window as typeof window & {
            producerPlayer: {
              resolvePlaybackSource: (p: string) => Promise<unknown>;
            };
          }
        ).producerPlayer;
        // Prime the renderer with a missing playback source by asking the
        // main process to resolve it. The resulting exists=false is what
        // the explicit-load code path checks.
        await bridge.resolvePlaybackSource(bogusPath).catch(() => undefined);
      }, bogusReferencePath);
    }

    // 5. Expect an error somewhere on screen that includes a path-like
    //    substring containing the bogus path (NOT just the filename). Give
    //    the reference-load pipeline time to run + surface its error.
    //    Accept either the absolute filesystem path or a producer-media://
    //    URL — both satisfy the "full location, not just basename" spec.
    await expect
      .poll(
        async () => {
          const errText = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('*'))
              .map((el) => el.textContent ?? '')
              .join('\n');
          });
          if (!errText.includes('Reference file could not be found')) return null;
          // Find the specific error line containing the trigger phrase.
          const match = errText
            .split('\n')
            .find((line) => line.includes('Reference file could not be found'));
          return match ?? null;
        },
        { timeout: 10_000, intervals: [500] },
      )
      .not.toBeNull();

    const errorLine = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*'))
        .map((el) => el.textContent ?? '')
        .find((t) => t.includes('Reference file could not be found'));
    });
    expect(errorLine).toBeTruthy();

    // The full-path assertion — reject the filename-only form.
    expect(errorLine).toMatch(/Reference file could not be found: .+/);
    // Must contain either a forward-slash filesystem path OR a
    // producer-media:// URL — i.e. NOT just the bare filename.
    const containsPathOrUrl = /\/|producer-media:\/\//.test(errorLine!);
    expect(containsPathOrUrl).toBe(true);
    // The specific bogus path should be surfaced.
    const containsTheBogusPath =
      errorLine!.includes(bogusReferencePath) ||
      errorLine!.includes('producer-media://');
    expect(containsTheBogusPath).toBe(true);
  } finally {
    await electronApp.close();
    await cleanupE2ETestDirectories(dirs);
  }
});
