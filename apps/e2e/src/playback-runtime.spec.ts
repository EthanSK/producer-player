import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchProducerPlayer } from './helpers/electron-app';

function hasFfmpeg(): boolean {
  const check = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return check.status === 0;
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited with ${code}: ${stderr}`));
    });
  });
}

async function startRendererDevServer(workspaceRoot: string): Promise<ChildProcess> {
  const rendererDirectory = path.join(workspaceRoot, 'apps/renderer');

  const child = spawn('npm', ['run', 'dev'], {
    cwd: rendererDirectory,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`renderer dev server exited early (${child.exitCode}): ${stderr}`);
    }

    try {
      const response = await fetch('http://127.0.0.1:4207');
      if (response.ok) {
        return child;
      }
    } catch {
      // Keep polling until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for renderer dev server: ${stderr}`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.killed || child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');

    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
      resolve();
    }, 4_000);
  });
}

async function writeRealAudioFixtures(fixtureDirectory: string): Promise<Record<string, string>> {
  const fixtures: Array<{ format: string; outputName: string; codecArgs: string[] }> = [
    { format: 'wav', outputName: 'Probe wav v1.wav', codecArgs: ['-c:a', 'pcm_s16le'] },
    { format: 'mp3', outputName: 'Probe mp3 v1.mp3', codecArgs: ['-c:a', 'libmp3lame'] },
    { format: 'm4a', outputName: 'Probe m4a v1.m4a', codecArgs: ['-c:a', 'aac', '-b:a', '192k'] },
    { format: 'flac', outputName: 'Probe flac v1.flac', codecArgs: ['-c:a', 'flac'] },
    { format: 'aiff', outputName: 'Probe aiff v1.aiff', codecArgs: ['-c:a', 'pcm_s16be'] },
  ];

  const outputByFormat: Record<string, string> = {};

  for (const fixture of fixtures) {
    const outputPath = path.join(fixtureDirectory, fixture.outputName);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      ...fixture.codecArgs,
      outputPath,
    ]);

    outputByFormat[fixture.format] = outputPath;
  }

  return outputByFormat;
}

test.describe('playback runtime deep dive', () => {
  test.skip(!hasFfmpeg(), 'ffmpeg is required for real codec fixture generation.');

  test('uses real wav/mp3/m4a/flac/aiff fixtures and either plays or shows actionable codec guidance', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-playback-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-playback-user-data-')
    );

    const fixturePathsByFormat = await writeRealAudioFixtures(fixtureDirectory);
    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    const matrix: Array<{
      format: string;
      status: 'playing' | 'graceful-fallback';
      meta: string;
      error: string;
    }> = [];

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(5);

      const sourceProbe = await page.evaluate(async (wavPath) => {
        return (window as any).producerPlayer.resolvePlaybackSource(wavPath);
      }, fixturePathsByFormat.wav);

      expect(sourceProbe.url.startsWith('producer-media://')).toBe(true);
      expect(sourceProbe.mimeType).toBe('audio/wav');

      for (const format of ['wav', 'mp3', 'm4a', 'flac', 'aiff']) {
        await page
          .getByTestId('main-list-row')
          .filter({ hasText: `Probe ${format}` })
          .first()
          .click();

        const meta =
          (await page.getByTestId('playback-source-meta').textContent())?.trim() ?? '';

        await page.getByTestId('player-play-toggle').click();

        let status: 'playing' | 'graceful-fallback' = 'graceful-fallback';
        let errorText = '';
        let resolved = false;

        const deadline = Date.now() + 8_000;

        while (Date.now() < deadline) {
          const label = await page
            .getByTestId('player-play-toggle')
            .getAttribute('aria-label');

          if (label === 'Pause') {
            status = 'playing';
            resolved = true;
            break;
          }

          const errorNode = page.getByTestId('playback-error');
          if ((await errorNode.count()) > 0) {
            errorText = (await errorNode.first().textContent())?.trim() ?? '';
            status = 'graceful-fallback';
            resolved = true;
            break;
          }

          await page.waitForTimeout(250);
        }

        expect(resolved).toBe(true);

        if (status === 'playing') {
          await page.getByTestId('player-play-toggle').click();
          await expect(page.getByTestId('player-play-toggle')).toHaveAttribute(
            'aria-label',
            'Play'
          );
        } else {
          expect(errorText).toContain('convert to WAV/MP3/AAC-M4A');
        }

        matrix.push({
          format,
          status,
          meta,
          error: errorText,
        });
      }

      const wavResult = matrix.find((entry) => entry.format === 'wav');
      const mp3Result = matrix.find((entry) => entry.format === 'mp3');
      const m4aResult = matrix.find((entry) => entry.format === 'm4a');

      expect(wavResult?.status).toBe('playing');
      expect(mp3Result?.status).toBe('playing');
      expect(m4aResult?.status).toBe('playing');

      const matrixOutputPath = path.join(
        userDataDirectory,
        'playback-runtime-matrix.json'
      );

      await fs.writeFile(matrixOutputPath, JSON.stringify(matrix, null, 2), 'utf8');
      await test.info().attach('playback-runtime-matrix', {
        path: matrixOutputPath,
        contentType: 'application/json',
      });

      expect(Object.keys(fixturePathsByFormat)).toEqual(
        expect.arrayContaining(['wav', 'mp3', 'm4a', 'flac', 'aiff'])
      );
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('playback stays stable across play/pause, rapid track switches, rescan, relink, and archived-old selection', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-playback-flow-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-playback-flow-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:duration=4',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Flow Alpha v1.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Flow Alpha v2.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=550:duration=4',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Flow Beta v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      await page.getByTestId('main-list-row').filter({ hasText: 'Flow Alpha' }).first().click();

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Play');

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.getByTestId('player-next').click();
      await page.getByTestId('player-prev').click();
      await page.getByTestId('player-next').click();
      await page.getByTestId('player-prev').click();

      await expect(page.getByTestId('playback-error')).toHaveCount(0);

      await page.getByTestId('rescan-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(page.getByTestId('playback-error')).toHaveCount(0);

      await page.getByTestId('linked-folder-item').first().click();
      page.once('dialog', async (dialog) => {
        await dialog.accept();
      });
      await page.getByRole('button', { name: 'Unlink' }).click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(0);

      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      await page.getByTestId('main-list-row').filter({ hasText: 'Flow Alpha' }).first().click();
      await expect(page.getByTestId('inspector-version-row')).toHaveCount(2);

      await page
        .getByTestId('inspector-version-row')
        .filter({ hasText: 'Archived in old/' })
        .first()
        .click();

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');
      await expect(page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('development renderer can play local files through producer-media protocol (no file:// block)', async () => {
    const workspaceRoot = path.resolve(__dirname, '../../..');
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-dev-playback-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-dev-playback-user-data-')
    );

    const rendererServer = await startRendererDevServer(workspaceRoot);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Dev Probe wav v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory, {
      devMode: true,
      rendererDevUrl: 'http://127.0.0.1:4207',
    });

    const consoleMessages: string[] = [];
    page.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await page.getByTestId('main-list-row').first().click();
      await page.getByTestId('player-play-toggle').click();

      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute(
        'aria-label',
        'Pause'
      );

      await expect(page.getByTestId('playback-error')).toHaveCount(0);

      const blockedFileMessage = consoleMessages.find((entry) =>
        entry.includes('Not allowed to load local resource: file://')
      );

      expect(blockedFileMessage).toBeUndefined();
    } finally {
      await electronApp.close();
      await stopProcess(rendererServer);
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });
});
