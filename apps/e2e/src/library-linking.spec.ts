import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const STATE_FILE_NAME = 'producer-player-electron-state.json';

interface LaunchedApp {
  electronApp: ElectronApplication;
  page: Page;
}

async function writeTestWav(
  filePath: string,
  options: { frequencyHz?: number; durationMs?: number } = {}
): Promise<void> {
  const sampleRate = 44_100;
  const durationMs = options.durationMs ?? 900;
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
    const value = Math.max(-1, Math.min(1, sample)) * 0.4;
    buffer.writeInt16LE(Math.floor(value * 32767), offset);
    offset += 2;
  }

  await fs.writeFile(filePath, buffer);
}

async function launchProducerPlayer(userDataDirectory: string): Promise<LaunchedApp> {
  const workspaceRoot = path.resolve(__dirname, '../../..');
  const electronEntry = path.join(workspaceRoot, 'apps/electron/dist/main.cjs');

  const electronApp = await electron.launch({
    args: [electronEntry],
    env: {
      ...process.env,
      PRODUCER_PLAYER_USER_DATA_DIR: userDataDirectory,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      PRODUCER_PLAYER_TEST_ID: randomUUID(),
    },
  });

  const page = await electronApp.firstWindow();
  await page.waitForSelector('[data-testid="app-shell"]');

  return {
    electronApp,
    page,
  };
}

test.describe('Producer Player desktop shell', () => {
  test('shows naming guidance, scans top-level + old, and groups v-suffix versions', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-user-data-')
    );

    const nestedDirectory = path.join(fixtureDirectory, 'random', 'sub');
    await fs.mkdir(nestedDirectory, { recursive: true });

    await writeTestWav(path.join(fixtureDirectory, 'Midnight Echo v1.wav'));
    await writeTestWav(path.join(nestedDirectory, 'Should Not Load v1.wav'));

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await expect(page.getByTestId('naming-guide')).toContainText('v1');
      await expect(page.getByTestId('naming-guide')).toContainText('v2');
      await expect(page.getByTestId('naming-guide')).toContainText('v3');
      await expect(page.getByTestId('naming-guide')).not.toContainText('opinionated by design');

      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      // Nested folders are ignored by scan policy.
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('inspector-song-title')).toContainText('Midnight Echo');
      await expect(page.getByTestId('inspector-version-row')).toHaveCount(1);

      // No-space suffix should still group with Midnight Echo.
      await writeTestWav(path.join(fixtureDirectory, 'Midnight Echov2.wav'), {
        frequencyHz: 520,
      });

      const archivedVersionPath = path.join(fixtureDirectory, 'old', 'Midnight Echo v1.wav');

      await expect
        .poll(async () => {
          try {
            await fs.access(archivedVersionPath);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(true);

      // Version history includes archived old/ files.
      await expect(page.getByTestId('inspector-version-row')).toHaveCount(2);
      await expect(page.getByText('Archived in old/')).toHaveCount(1);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('persists linked folder + track order in user data and keeps order after rescan/restart', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-user-data-')
    );

    await writeTestWav(path.join(fixtureDirectory, 'Alpha v1.wav'), { frequencyHz: 330 });
    await writeTestWav(path.join(fixtureDirectory, 'Beta v1.wav'), { frequencyHz: 660 });

    let expectedFirstTrackAfterRestart = 'Beta';

    let firstLaunch: LaunchedApp | null = null;

    try {
      firstLaunch = await launchProducerPlayer(userDataDirectory);

      await firstLaunch.page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await firstLaunch.page.getByTestId('link-folder-path-button').click();

      await expect(firstLaunch.page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(firstLaunch.page.getByTestId('main-list-row')).toHaveCount(2);

      const rowData = await firstLaunch.page
        .getByTestId('main-list-row')
        .evaluateAll((elements) =>
          elements
            .map((element) => ({
              id: element.getAttribute('data-song-id') ?? '',
              text: element.textContent ?? '',
            }))
            .filter((entry) => entry.id.length > 0)
        );

      const betaEntry = rowData.find((entry) => entry.text.includes('Beta'));

      if (betaEntry) {
        const orderedSongIds = [
          betaEntry.id,
          ...rowData.filter((entry) => entry.id !== betaEntry.id).map((entry) => entry.id),
        ];

        await firstLaunch.page.evaluate(async (ids) => {
          await (window as any).producerPlayer.reorderSongs(ids);
        }, orderedSongIds);
      }

      await expect(firstLaunch.page.getByTestId('main-list-row').first()).toContainText('Beta');

      await firstLaunch.page.getByTestId('rescan-button').click();
      await expect(firstLaunch.page.getByTestId('main-list-row').first()).toContainText('Beta');

      expectedFirstTrackAfterRestart =
        (await firstLaunch.page.getByTestId('main-list-row').first().textContent())?.trim() ??
        expectedFirstTrackAfterRestart;
    } finally {
      await firstLaunch?.electronApp.close();
    }

    const statePath = path.join(userDataDirectory, STATE_FILE_NAME);
    const stateRaw = await fs.readFile(statePath, 'utf8');
    const persistedState = JSON.parse(stateRaw) as {
      linkedFolderPaths?: string[];
      songOrder?: string[];
    };

    expect(persistedState.linkedFolderPaths).toContain(fixtureDirectory);
    expect(Array.isArray(persistedState.songOrder)).toBe(true);
    expect((persistedState.songOrder ?? []).length).toBeGreaterThan(0);

    let secondLaunch: LaunchedApp | null = null;

    try {
      secondLaunch = await launchProducerPlayer(userDataDirectory);

      await expect(secondLaunch.page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(secondLaunch.page.getByTestId('linked-folder-item').first()).toContainText(
        fixtureDirectory
      );

      await expect(secondLaunch.page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(secondLaunch.page.getByTestId('main-list-row').first()).toContainText(
        expectedFirstTrackAfterRestart
      );
    } finally {
      await secondLaunch?.electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('plays valid test audio and supports producer transport controls', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-user-data-')
    );

    await writeTestWav(path.join(fixtureDirectory, 'Pulse v1.wav'), { frequencyHz: 440 });
    await writeTestWav(path.join(fixtureDirectory, 'Pulse v2.wav'), { frequencyHz: 520 });

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('player-dock')).toBeVisible();

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toContainText('Pause');
      await expect(page.getByTestId('playback-error')).toHaveCount(0);

      // Previous/next should be functional controls even when queue length is 1.
      await page.getByTestId('player-prev').click();
      await page.getByTestId('player-next').click();

      await page.getByTestId('player-repeat').click();
      await expect(page.getByTestId('player-repeat')).toContainText('Repeat: One');

      await page.getByTestId('player-repeat').click();
      await expect(page.getByTestId('player-repeat')).toContainText('Repeat: All');

      await page.getByTestId('player-repeat').click();
      await expect(page.getByTestId('player-repeat')).toContainText('Repeat: Off');

      const scrubber = page.getByTestId('player-scrubber');
      await expect(scrubber).toBeEnabled();
      await scrubber.fill('0.2');
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });
});
