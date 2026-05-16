import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

async function writeTestWav(
  filePath: string,
  options: { frequencyHz?: number; durationMs?: number; sampleRate?: number } = {}
): Promise<void> {
  const sampleRate = options.sampleRate ?? 44_100;
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
    const value = Math.max(-1, Math.min(1, sample)) * 0.35;
    buffer.writeInt16LE(Math.floor(value * 32767), offset);
    offset += 2;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

async function linkFixtureFolder(page: Page, fixtureDirectory: string): Promise<void> {
  await page.evaluate(async (folderPath) => {
    await (
      window as typeof window & {
        producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
      }
    ).producerPlayer.linkFolder(folderPath);
  }, fixtureDirectory);
}

type QueueDump = {
  activeByPriority: { user: number; neighbor: number; background: number };
  pendingByPriority: { user: number; neighbor: number; background: number };
  runningJobs: Array<{ key: string | null; priority: 0 | 1 | 2; label: string | null }>;
};

async function readMeasuredQueueDump(page: Page): Promise<QueueDump> {
  return page.evaluate(() => {
    const dump = (
      window as typeof window & {
        __producerPlayerGetMeasuredQueueDump?: () => QueueDump;
      }
    ).__producerPlayerGetMeasuredQueueDump?.();
    if (!dump) {
      throw new Error('Measured queue test hook is unavailable.');
    }
    return dump;
  });
}

test.describe('audio-analysis USER interrupt @smoke', () => {
  test('song play interrupts measured warmup and lets warmup resume @smoke', async () => {
    const directories = await createE2ETestDirectories('producer-player-analysis-interrupt');

    await writeTestWav(path.join(directories.fixtureDirectory, 'ZZZ Interrupt Target v1.wav'), {
      frequencyHz: 880,
    });
    await writeTestWav(path.join(directories.fixtureDirectory, 'ZZZ Interrupt Target v2.wav'), {
      frequencyHz: 990,
    });
    for (let index = 1; index <= 8; index += 1) {
      await writeTestWav(
        path.join(directories.fixtureDirectory, `Warmup ${String(index).padStart(2, '0')} v1.wav`),
        { frequencyHz: 180 + index * 70 }
      );
    }

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory, {
      extraEnv: {
        PRODUCER_PLAYER_ANALYSIS_DELAY_MS: '1200',
      },
    });

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(9, { timeout: 15_000 });

      await page.waitForFunction(
        () =>
          typeof (
            window as typeof window & { __producerPlayerGetMeasuredQueueDump?: () => unknown }
          ).__producerPlayerGetMeasuredQueueDump === 'function',
        null,
        { timeout: 10_000 }
      );

      await expect
        .poll(async () => (await readMeasuredQueueDump(page)).activeByPriority.neighbor, {
          timeout: 8_000,
        })
        .toBeGreaterThan(0);

      await page
        .getByTestId('main-list-row')
        .filter({ hasText: 'ZZZ Interrupt Target' })
        .first()
        .click();
      await page
        .getByTestId('inspector-version-row')
        .filter({ hasText: 'ZZZ Interrupt Target v2.wav' })
        .getByRole('button', { name: 'Cue' })
        .click();

      await expect
        .poll(async () => {
          const dump = await readMeasuredQueueDump(page);
          return dump.runningJobs.map((job) => `${job.priority}:${job.label ?? ''}`).join('|');
        }, { timeout: 2_000 })
        .toContain('0:ZZZ Interrupt Target v2.wav');

      const dumpDuringUser = await readMeasuredQueueDump(page);
      expect(dumpDuringUser.activeByPriority.user).toBeGreaterThan(0);
      expect(dumpDuringUser.activeByPriority.neighbor).toBe(0);
      expect(dumpDuringUser.activeByPriority.background).toBe(0);

      await expect(page.getByTestId('analysis-track-label')).toContainText(
        'ZZZ Interrupt Target v2.wav',
        { timeout: 5_000 }
      );
      await expect(page.getByTestId('analysis-integrated-stat')).not.toContainText('Loading', {
        timeout: 15_000,
      });

      await expect
        .poll(async () => {
          const dump = await readMeasuredQueueDump(page);
          return dump.activeByPriority.neighbor + dump.pendingByPriority.neighbor;
        }, { timeout: 8_000 })
        .toBeGreaterThan(0);

      const rows = page.getByTestId('main-list-row');
      await rows.nth(1).dblclick({ force: true });
      await rows.nth(2).dblclick({ force: true });
      await rows.nth(3).dblclick({ force: true });

      await expect
        .poll(async () => (await readMeasuredQueueDump(page)).activeByPriority.user, {
          timeout: 2_000,
        })
        .toBeGreaterThan(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
