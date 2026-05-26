import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  launchProducerPlayer,
  createE2ETestDirectories,
  cleanupE2ETestDirectories,
} from './helpers/electron-app';

function writeMinimalWav(filePath: string): Promise<void> {
  const sampleRate = 44_100;
  const durationMs = 500;
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
  const bitsPerSample = 16;
  const blockAlign = bitsPerSample / 8;
  const dataSize = sampleCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(sampleRate * blockAlign, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;
  return fs.writeFile(filePath, buffer);
}

async function writeMinimalWavFixtures(rootDirectory: string, relativePaths: string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    await writeMinimalWav(path.join(rootDirectory, relativePath));
  }
}

async function linkFolderPath(
  page: Awaited<ReturnType<typeof launchProducerPlayer>>['page'],
  folderPath: string
): Promise<void> {
  await page.evaluate(async (pathToLink) => {
    await (window as any).producerPlayer.linkFolder(pathToLink);
  }, folderPath);
}

async function tryLinkFolderPath(
  page: Awaited<ReturnType<typeof launchProducerPlayer>>['page'],
  folderPath: string
): Promise<void> {
  await page.evaluate(async (pathToLink) => {
    try {
      await (window as any).producerPlayer.linkFolder(pathToLink);
    } catch {
      // These edge cases intentionally feed invalid paths; the app just needs
      // to stay alive and keep rendering after the expected rejection.
    }
  }, folderPath);
}

test.describe('Producer Player edge cases', () => {
  test('empty folder shows 0 rows gracefully', async () => {
    const dirs = await createE2ETestDirectories('break-empty');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

      await expect(page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(page.getByTestId('main-list-row')).toHaveCount(0);
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('linking the same folder twice deduplicates or handles gracefully', async () => {
    const dirs = await createE2ETestDirectories('break-dedupe');

    await writeMinimalWav(path.join(dirs.fixtureDirectory, 'Alpha v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

      await expect(page.getByTestId('linked-folder-item')).toHaveCount(1);

      await linkFolderPath(page, dirs.fixtureDirectory);

      // Should not crash and should not duplicate rows beyond what exists
      await expect(page.getByTestId('app-shell')).toBeVisible();
      const folderCount = await page.getByTestId('linked-folder-item').count();
      expect(folderCount).toBeLessThanOrEqual(2);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('long filename (200+ chars) appears in list', async () => {
    const dirs = await createE2ETestDirectories('break-longname');
    const longName = 'A'.repeat(180) + ' v1.wav';

    await writeMinimalWav(path.join(dirs.fixtureDirectory, longName));

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('unicode filenames appear in list', async () => {
    const dirs = await createE2ETestDirectories('break-unicode');

    await writeMinimalWavFixtures(dirs.fixtureDirectory, [
      'Ñoño Beat v1.wav',
      'Café Track v1.wav',
    ]);

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('rapid rescan does not crash', async () => {
    const dirs = await createE2ETestDirectories('break-rescan');

    await writeMinimalWav(path.join(dirs.fixtureDirectory, 'Alpha v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      for (let i = 0; i < 5; i++) {
        await page.getByTestId('rescan-button').click();
      }

      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('non-existent folder path does not crash', async () => {
    const dirs = await createE2ETestDirectories('break-nonexistent');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await tryLinkFolderPath(page, '/tmp/does-not-exist-99999');

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('reorderSongs with empty array does not crash', async () => {
    const dirs = await createE2ETestDirectories('break-reorder-empty');

    await writeMinimalWav(path.join(dirs.fixtureDirectory, 'Alpha v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.evaluate(async () => {
        await (window as any).producerPlayer.reorderSongs([]);
      });

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('reorderSongs with fake IDs does not crash', async () => {
    const dirs = await createE2ETestDirectories('break-reorder-fake');

    await writeMinimalWav(path.join(dirs.fixtureDirectory, 'Alpha v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await linkFolderPath(page, dirs.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.evaluate(async () => {
        await (window as any).producerPlayer.reorderSongs(['fake-id-1', 'fake-id-2']);
      });

      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });
});
