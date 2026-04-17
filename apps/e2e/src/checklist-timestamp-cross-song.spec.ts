import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

// Regression test for: clicking a timestamp in Song A's checklist while Song B
// is the current playback song used to seek on Song B (wrong song, right
// time). The fix routes the click through a song-switch first, then seeks —
// enforcing the same "checklist song == selected song" invariant as
// handleQuickSwitcherSelect and syncChecklistModalToQueueMoveTarget.
// See apps/renderer/src/App.tsx → handleChecklistTimestampClick.

async function writeTestWav(
  filePath: string,
  options: { frequencyHz?: number; durationMs?: number; sampleRate?: number } = {}
): Promise<void> {
  const sampleRate = options.sampleRate ?? 44_100;
  const durationMs = options.durationMs ?? 4_000;
  const frequencyHz = options.frequencyHz ?? 440;
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);

  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = sampleCount * blockAlign;

  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  buffer.write('RIFF', offset);
  offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset);
  offset += 4;
  buffer.write('WAVE', offset);
  offset += 4;
  buffer.write('fmt ', offset);
  offset += 4;
  buffer.writeUInt32LE(16, offset);
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(channels, offset);
  offset += 2;
  buffer.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buffer.writeUInt32LE(byteRate, offset);
  offset += 4;
  buffer.writeUInt16LE(blockAlign, offset);
  offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset);
  offset += 2;
  buffer.write('data', offset);
  offset += 4;
  buffer.writeUInt32LE(dataSize, offset);
  offset += 4;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate);
    const value = Math.max(-1, Math.min(1, sample)) * 0.3;
    buffer.writeInt16LE(Math.floor(value * 32767), offset);
    offset += 2;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

async function linkFixtureFolder(
  page: Awaited<ReturnType<typeof launchProducerPlayer>>['page'],
  fixtureDirectory: string
): Promise<void> {
  await page.evaluate(async (folderPath) => {
    await (window as typeof window & {
      producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
    }).producerPlayer.linkFolder(folderPath);
  }, fixtureDirectory);
}

async function cueSongVersion(
  page: Awaited<ReturnType<typeof launchProducerPlayer>>['page'],
  songTitle: string,
  fileName: string
): Promise<void> {
  await page.getByTestId('main-list-row').filter({ hasText: songTitle }).first().click();
  await page
    .getByTestId('inspector-version-row')
    .filter({ hasText: fileName })
    .getByRole('button', { name: 'Cue' })
    .click();
  await expect(page.getByTestId('player-track-name')).toContainText(fileName);
}

test.describe('checklist timestamp click switches to the checklist song', () => {
  test('clicking a timestamp in Song A checklist while Song B is playing switches to A and seeks', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-checklist-timestamp-cross-song'
    );

    // 30 s tracks: long enough that Track B cannot naturally reach its end
    // mid-test (6s was too short — the queue would auto-advance from B to A
    // when B ended, making the repro look like a successful "switch" even
    // without the fix).
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track A v1.wav'), {
      durationMs: 30_000,
      frequencyHz: 330,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'Track B v1.wav'), {
      durationMs: 30_000,
      frequencyHz: 550,
    });

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      // Add a timestamped checklist item to Track A first.
      await cueSongVersion(page, 'Track A', 'Track A v1.wav');
      await page.getByTestId('transport-checklist-button').click();
      const checklistModal = page.getByTestId('song-checklist-modal');
      await expect(checklistModal).toBeVisible();
      await expect(checklistModal.locator('h2')).toContainText('Track A');

      // Wait for the audio source to finish loading so duration > 0 and
      // the mini-player scrubber becomes enabled (needed to freeze the
      // timestamp preview deterministically).
      const miniScrubber = page.getByTestId('song-checklist-mini-player-scrubber');
      await expect(miniScrubber).toBeEnabled({ timeout: 10_000 });

      // Seek to 3s via the mini-player scrubber.
      await miniScrubber.evaluate((node, value) => {
        const el = node as HTMLInputElement;
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        nativeSetter?.call(el, String(value));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, 3);

      // Click "Set now" to capture the current playback time (3s) into the
      // preview. Set now is only visible when a captured timestamp exists,
      // which is true immediately after the modal opens.
      await page.getByTestId('song-checklist-set-now').click();

      // Now type the item text and add. We're in "frozen" mode after Set
      // now, so typing will NOT re-capture the timestamp.
      const composer = page.getByTestId('song-checklist-input');
      await composer.click();
      await composer.type('Track A item at 0:03');
      await page.getByTestId('song-checklist-add').click();

      // Verify the timestamp badge reads 0:03 on the new item.
      const itemRow = checklistModal
        .getByTestId('song-checklist-items')
        .locator('li')
        .filter({ hasText: 'Track A item at 0:03' })
        .first();
      await expect(itemRow).toBeVisible();
      const timestampBadge = itemRow.getByTestId('song-checklist-item-timestamp');
      await expect(timestampBadge).toHaveText('0:03');

      // Close the checklist, then cue Track B so it's the current playback.
      await page.keyboard.press('Escape');
      await expect(checklistModal).toBeHidden();

      await cueSongVersion(page, 'Track B', 'Track B v1.wav');
      await expect(page.getByTestId('player-track-name')).toContainText('Track B v1.wav');

      // Open Track A's checklist full-screen WITHOUT using the quick switcher.
      // The per-song "Checklist" button on each main-list row opens that
      // song's checklist regardless of what is currently playing, which is
      // the exact repro for the bug.
      const trackARow = page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Track A' })
        .first();
      await trackARow.getByTestId('song-checklist-button').click();

      await expect(checklistModal).toBeVisible();
      await expect(checklistModal.locator('h2')).toContainText('Track A');

      // Sanity: the player is still showing Track B before the click —
      // the checklist overlay is on A, but playback is still on B.
      const beforeClickName = await page
        .getByTestId('player-track-name')
        .textContent();
      expect(beforeClickName).toBe('Track B v1.wav');

      await page.screenshot({
        path: '/tmp/pp-timestamp-song-switch/before-click.png',
      });

      // Click the 0:03 timestamp badge in Track A's checklist.
      await timestampBadge.click();

      // Expected: playback switches to Track A. Poll the DOM directly
      // (`textContent` + retry loop) because Playwright's `toHaveText`
      // auto-wait gave spurious passes in this codebase when the element
      // never matched — a plain string comparison is unambiguous.
      const deadline = Date.now() + 5_000;
      let finalName: string | null = null;
      while (Date.now() < deadline) {
        finalName = await page.getByTestId('player-track-name').textContent();
        if (finalName === 'Track A v1.wav') break;
        await page.waitForTimeout(50);
      }
      if (finalName !== 'Track A v1.wav') {
        throw new Error(
          `Expected player-track-name to become "Track A v1.wav" after the checklist timestamp click, got "${finalName}"`
        );
      }

      await page.screenshot({
        path: '/tmp/pp-timestamp-song-switch/after-click.png',
      });
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
