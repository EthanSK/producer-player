import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchProducerPlayer } from './helpers/electron-app';

function hasFfmpeg(): boolean {
  const check = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return check.status === 0;
}

function resolveFfmpegBinaryPath(): string | null {
  const check = spawnSync('which', ['ffmpeg'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  });

  if (check.status !== 0) {
    return null;
  }

  const resolvedPath = check.stdout.trim();
  return resolvedPath.length > 0 ? resolvedPath : null;
}

function hasFfprobe(): boolean {
  const check = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' });
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

async function runFfmpegCapture(args: string[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    let stderr = '';

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
        return;
      }

      reject(new Error(`ffmpeg exited with ${code}: ${stderr}`));
    });
  });
}

async function probeAudioCodecName(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';

    ffprobe.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    ffprobe.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with ${code}: ${stderr}`));
        return;
      }

      const codecName = stdout.trim().split(/\s+/)[0] ?? '';
      if (codecName.length === 0) {
        reject(new Error(`ffprobe returned no codec for ${filePath}.`));
        return;
      }

      resolve(codecName);
    });
  });
}

async function decodeAudioToPcmS16le(filePath: string): Promise<Buffer> {
  return runFfmpegCapture([
    '-v',
    'error',
    '-i',
    filePath,
    '-vn',
    '-f',
    's16le',
    '-acodec',
    'pcm_s16le',
    '-',
  ]);
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function hashUrlInRenderer(page: import('@playwright/test').Page, url: string): Promise<string> {
  return page.evaluate(async (targetUrl) => {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${targetUrl}: ${response.status}`);
    }

    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);

    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  }, url);
}

async function startRendererDevServer(
  workspaceRoot: string,
  port: number
): Promise<ChildProcess> {
  const rendererDirectory = path.join(workspaceRoot, 'apps/renderer');

  const child = spawn(
    'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: rendererDirectory,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

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
      const response = await fetch(`http://127.0.0.1:${port}`);
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

  test('surfaces 44.1/48 kHz sample rates in inspector + player even when ffprobe is unavailable', async () => {
    const ffmpegBinaryPath = resolveFfmpegBinaryPath();
    test.skip(!ffmpegBinaryPath, 'ffmpeg binary path is required for ffprobe-is-missing simulation.');

    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-sample-rate-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-sample-rate-user-data-')
    );

    const fixtures = [
      {
        songTitle: 'Sample Rate 44.1',
        fileName: 'Sample Rate 44.1 v1.wav',
        sampleRateHz: '44100',
        expectedLabel: '44.1 kHz',
      },
      {
        songTitle: 'Sample Rate 48',
        fileName: 'Sample Rate 48 v1.wav',
        sampleRateHz: '48000',
        expectedLabel: '48 kHz',
      },
    ] as const;

    for (const fixture of fixtures) {
      await runFfmpeg([
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=4',
        '-ar',
        fixture.sampleRateHz,
        '-c:a',
        'pcm_s16le',
        path.join(fixtureDirectory, fixture.fileName),
      ]);
    }

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory, {
      extraEnv: {
        PATH: '/usr/bin:/bin',
        PRODUCER_PLAYER_FFMPEG_PATH: ffmpegBinaryPath!,
      },
    });

    try {
      await page.evaluate(async (targetPath) => {
        await (window as any).producerPlayer.linkFolder(targetPath);
      }, fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(fixtures.length);

      for (const fixture of fixtures) {
        const escapedTitle = fixture.songTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const row = page.getByTestId('main-list-row').filter({
          has: page
            .getByTestId('main-list-row-title')
            .filter({ hasText: new RegExp(`^${escapedTitle}$`) }),
        });

        await expect(row).toHaveCount(1);
        await row.first().click();
        await page
          .getByTestId('inspector-version-row')
          .first()
          .getByRole('button', { name: 'Cue' })
          .click();

        await expect(page.getByTestId('player-track-name')).toContainText(fixture.fileName);
        await expect(page.getByTestId('inspector-song-sample-rate')).not.toContainText('—');
        await expect(page.getByTestId('player-track-sample-rate')).not.toContainText('—');
        await expect(page.getByTestId('inspector-song-sample-rate')).toContainText(
          fixture.expectedLabel
        );
        await expect(page.getByTestId('player-track-sample-rate')).toContainText(
          fixture.expectedLabel
        );
      }
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('uses real wav/mp3/m4a/flac/aiff fixtures and plays all of them, including AIFF via local preparation', async () => {
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
      status: 'playing' | 'error';
      error: string;
    }> = [];

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(5);

      const sourceProbe = await page.evaluate(async (wavPath) => {
        return (window as any).producerPlayer.resolvePlaybackSource(wavPath);
      }, fixturePathsByFormat.wav);

      const aiffSourceProbe = await page.evaluate(async (aiffPath) => {
        return (window as any).producerPlayer.resolvePlaybackSource(aiffPath);
      }, fixturePathsByFormat.aiff);

      expect(sourceProbe.url.startsWith('producer-media://')).toBe(true);
      expect(sourceProbe.mimeType).toBe('audio/wav');
      expect(sourceProbe.sourceStrategy).toBe('direct-file');

      const expectedWavHash = sha256Hex(await fs.readFile(fixturePathsByFormat.wav));
      const streamedWavHash = await hashUrlInRenderer(page, sourceProbe.url);
      expect(streamedWavHash).toBe(expectedWavHash);

      expect(aiffSourceProbe.url.startsWith('producer-media://')).toBe(true);
      expect(aiffSourceProbe.mimeType).toBe('audio/wav');
      expect(aiffSourceProbe.sourceStrategy).toBe('transcoded-cache');
      expect(aiffSourceProbe.originalFilePath).toBe(fixturePathsByFormat.aiff);

      const originalAiffPcmHash = sha256Hex(
        await decodeAudioToPcmS16le(fixturePathsByFormat.aiff)
      );
      const transcodedAiffPcmHash = sha256Hex(
        await decodeAudioToPcmS16le(aiffSourceProbe.filePath)
      );
      expect(transcodedAiffPcmHash).toBe(originalAiffPcmHash);

      for (const format of ['wav', 'mp3', 'm4a', 'flac', 'aiff']) {
        await page
          .getByTestId('main-list-row')
          .filter({ hasText: `Probe ${format}` })
          .first()
          .click();

        await expect(page.getByTestId('playback-source-meta')).toHaveCount(0);

        await page.getByTestId('player-play-toggle').click();

        let status: 'playing' | 'error' = 'error';
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
            status = 'error';
            resolved = true;
            break;
          }

          await page.waitForTimeout(250);
        }

        expect(resolved).toBe(true);

        expect(status).toBe('playing');
        expect(errorText).toBe('');

        await page.getByTestId('player-play-toggle').click();
        await expect(page.getByTestId('player-play-toggle')).toHaveAttribute(
          'aria-label',
          'Play'
        );

        matrix.push({
          format,
          status,
          error: errorText,
        });
      }

      const wavResult = matrix.find((entry) => entry.format === 'wav');
      const mp3Result = matrix.find((entry) => entry.format === 'mp3');
      const m4aResult = matrix.find((entry) => entry.format === 'm4a');
      const aiffResult = matrix.find((entry) => entry.format === 'aiff');

      expect(wavResult?.status).toBe('playing');
      expect(mp3Result?.status).toBe('playing');
      expect(m4aResult?.status).toBe('playing');
      expect(aiffResult?.status).toBe('playing');

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

      await page.getByTestId('inspector-version-row').nth(1).click();

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');
      await expect(page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('inspector version history scrolls, double-clicking a song starts playback, and the volume slider sits beside repeat', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-playback-ux-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-playback-ux-user-data-')
    );

    for (let version = 1; version <= 18; version += 1) {
      await runFfmpeg([
        '-y',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${320 + version * 10}:duration=4`,
        '-c:a',
        'pcm_s16le',
        path.join(fixtureDirectory, `Scroll Track v${version}.wav`),
      ]);
    }

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=640:duration=4',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Companion Track v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      const scrollTrackRow = page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Scroll Track' })
        .first();

      await scrollTrackRow.click();
      await expect(page.getByTestId('inspector-version-row')).toHaveCount(18);

      const scrollMetricsBefore = await page.getByTestId('inspector-scroll-region').evaluate((element) => {
        const target = element as HTMLDivElement;
        return {
          clientHeight: target.clientHeight,
          scrollHeight: target.scrollHeight,
          scrollTop: target.scrollTop,
        };
      });

      expect(scrollMetricsBefore.scrollHeight).toBeGreaterThan(scrollMetricsBefore.clientHeight);
      expect(scrollMetricsBefore.scrollTop).toBe(0);

      await page.getByTestId('inspector-scroll-region').evaluate((element) => {
        const target = element as HTMLDivElement;
        target.scrollTop = target.scrollHeight;
      });

      await expect
        .poll(async () => {
          return page.getByTestId('inspector-scroll-region').evaluate((element) => {
            return (element as HTMLDivElement).scrollTop;
          });
        })
        .toBeGreaterThan(0);

      const volumeControlIsAdjacentToRepeat = await page.evaluate(() => {
        const repeatButton = document.querySelector('[data-testid="player-repeat"]');
        const volumeControl = document.querySelector('[data-testid="player-volume-control"]');
        return !!repeatButton && repeatButton.nextElementSibling === volumeControl;
      });

      expect(volumeControlIsAdjacentToRepeat).toBe(true);

      await scrollTrackRow.dblclick();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.getByTestId('player-volume-slider').evaluate((element) => {
        const input = element as HTMLInputElement;
        input.value = '25';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await expect(page.getByTestId('player-volume-slider')).toHaveValue('25');
      await expect(page.getByTestId('player-volume-control')).toContainText('Vol 25%');
      await expect(page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('player UI hides debug playback details and redundant archived labels', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-prod-ui-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-prod-ui-user-data-')
    );

    const oldDirectory = path.join(fixtureDirectory, 'old');
    await fs.mkdir(oldDirectory, { recursive: true });

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=480:duration=4',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Archive Check v2.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=360:duration=4',
      '-c:a',
      'pcm_s16le',
      path.join(oldDirectory, 'Archive Check v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await page.getByTestId('main-list-row').filter({ hasText: 'Archive Check' }).first().click();
      await expect(page.getByTestId('inspector-version-row')).toHaveCount(2);
      await expect(page.getByTestId('playback-source-meta')).toHaveCount(0);
      await expect(page.getByText('Archived in old/')).toHaveCount(0);

      await page
        .getByTestId('inspector-version-row')
        .filter({ hasText: 'Archive Check v1.wav' })
        .getByRole('button', { name: 'Cue' })
        .click();

      await expect(page.getByTestId('player-track-name')).toContainText('Archive Check v1.wav');
      await expect(page.getByTestId('playback-source-meta')).toHaveCount(0);
      await expect(page.getByText('Archived in old/')).toHaveCount(0);

      const screenshotPath = path.join(userDataDirectory, 'prod-ui-polish.png');
      await page.screenshot({ path: screenshotPath });
      await test.info().attach('prod-ui-polish', {
        path: screenshotPath,
        contentType: 'image/png',
      });
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('shows mastering analysis with a stable panel and explicit reference-track workflow', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-mastering-preview-fixture-')
    );
    const referenceDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-mastering-reference-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-mastering-preview-user-data-')
    );

    const warmMasterPath = path.join(fixtureDirectory, 'Warm Master v1.wav');
    const brightRefPath = path.join(fixtureDirectory, 'Bright Ref v1.wav');
    const externalReferencePath = path.join(referenceDirectory, 'External Reference.wav');

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=140:duration=6',
      '-filter:a',
      'volume=0.85',
      '-c:a',
      'pcm_s16le',
      warmMasterPath,
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=5200:duration=6',
      '-filter:a',
      'volume=0.35',
      '-c:a',
      'pcm_s16le',
      brightRefPath,
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=2200:duration=6',
      '-filter:a',
      'volume=0.6',
      '-c:a',
      'pcm_s16le',
      externalReferencePath,
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory, {
      extraEnv: {
        PRODUCER_PLAYER_E2E_REFERENCE_IMPORT_PATH: externalReferencePath,
        PRODUCER_PLAYER_ANALYSIS_DELAY_MS: '900',
      },
    });

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      const cueSongVersion = async (songTitle: string, fileName: string): Promise<void> => {
        await page.getByTestId('main-list-row').filter({ hasText: songTitle }).first().click();
        await page
          .getByTestId('inspector-version-row')
          .filter({ hasText: fileName })
          .getByRole('button', { name: 'Cue' })
          .click();
        await expect(page.getByTestId('analysis-track-label')).toContainText(fileName);
      };

      await cueSongVersion('Warm Master', 'Warm Master v1.wav');
      await expect(page.getByTestId('analysis-panel')).toContainText('Mastering + Reference');
      await expect
        .poll(async () => {
          const status = page.getByTestId('analysis-status');
          const count = await status.count();
          if (count === 0) {
            return '';
          }
          return ((await status.textContent()) ?? '').trim();
        })
        .toMatch(/^(|Loading mastering analysis…|Preparing mastering analysis…)$/);

      const initialPanelHeight = await page.getByTestId('analysis-panel').evaluate((element) => {
        return Math.round(element.getBoundingClientRect().height);
      });

      await expect(page.getByTestId('analysis-integrated-stat')).not.toContainText('Loading');
      await expect(page.getByTestId('analysis-integrated-stat')).toContainText('LUFS');
      await expect(page.getByTestId('analysis-true-peak-stat')).toContainText('dBFS');
      await expect(page.getByTestId('analysis-reference-summary')).toContainText(
        'No reference'
      );

      await cueSongVersion('Bright Ref', 'Bright Ref v1.wav');

      const switchedPanelHeight = await page.getByTestId('analysis-panel').evaluate((element) => {
        return Math.round(element.getBoundingClientRect().height);
      });
      expect(Math.abs(initialPanelHeight - switchedPanelHeight)).toBeLessThanOrEqual(6);

      await expect(page.getByTestId('analysis-integrated-stat')).not.toContainText('Loading');

      await page.getByTestId('analysis-choose-reference').click();
      await expect(page.getByTestId('analysis-reference-summary')).toContainText(
        'External Reference.wav'
      );

      await page.getByTestId('analysis-ab-reference').click();
      await expect(page.getByTestId('player-track-name')).toContainText('External Reference.wav');
      await page.getByTestId('analysis-ab-mix').click();
      await expect(page.getByTestId('player-track-name')).toContainText('Bright Ref v1.wav');

      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
      await expect(page.getByTestId('analysis-reference-slot-a')).toContainText(
        'External Reference.wav'
      );
      await expect(page.getByTestId('analysis-active-reference')).toContainText('difference');
      await expect(page.getByTestId('analysis-active-reference')).toContainText(
        'External Reference.wav'
      );

      await expect(page.getByTestId('analysis-overlay-normalization-panel')).toBeVisible();
      const overlayNormalizationToggle = page.getByTestId('analysis-overlay-normalization-toggle');
      await expect(overlayNormalizationToggle).toHaveText('Preview Off');
      await overlayNormalizationToggle.click();
      await expect(overlayNormalizationToggle).toHaveText('Preview On');
      await expect(page.getByTestId('analysis-overlay-normalization-summary')).toContainText(
        'preview on'
      );

      await page.getByTestId('analysis-overlay-platform-youtube').click();
      await expect(page.getByTestId('analysis-overlay-platform-youtube')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(page.getByTestId('analysis-overlay-normalization-summary')).toContainText(
        'YouTube selected'
      );

      await page.getByTestId('analysis-close-button').click();
      await expect(page.getByTestId('analysis-modal')).toHaveCount(0);
      await expect(page.getByTestId('analysis-platform-youtube')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('analysis-normalization-summary')).toContainText('YouTube selected');
      await expect(page.getByTestId('analysis-normalization-summary')).toContainText('preview on');
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(referenceDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('supports use-current and clear-reference controls across inline and full-screen mastering views', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-reference-controls-fixture-')
    );
    const referenceDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-reference-controls-reference-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-reference-controls-user-data-')
    );

    const alphaPath = path.join(fixtureDirectory, 'Reference Alpha v1.wav');
    const betaPath = path.join(fixtureDirectory, 'Reference Beta v1.wav');
    const externalReferencePath = path.join(referenceDirectory, 'Overlay Reference.wav');

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=300:duration=6',
      '-c:a',
      'pcm_s16le',
      alphaPath,
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=480:duration=6',
      '-c:a',
      'pcm_s16le',
      betaPath,
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=2200:duration=6',
      '-c:a',
      'pcm_s16le',
      externalReferencePath,
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory, {
      extraEnv: {
        PRODUCER_PLAYER_E2E_REFERENCE_IMPORT_PATH: externalReferencePath,
      },
    });

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);
      await page.getByTestId('main-list-row').filter({ hasText: 'Reference Alpha' }).first().click();
      await page
        .getByTestId('inspector-version-row')
        .filter({ hasText: 'Reference Alpha v1.wav' })
        .getByRole('button', { name: 'Cue' })
        .click();
      await expect(page.getByTestId('player-track-name')).toContainText('Reference Alpha v1.wav');

      await expect(page.getByTestId('analysis-integrated-stat')).not.toContainText('Loading', {
        timeout: 12_000,
      });
      await expect(page.getByTestId('analysis-reference-summary')).toContainText('No reference');
      await expect(page.getByTestId('analysis-ab-reference')).toBeDisabled();

      await page.getByTestId('analysis-use-current-reference').click();
      await expect(page.getByTestId('analysis-reference-summary')).toContainText('Reference Alpha v1.wav');
      await expect(page.getByTestId('analysis-reference-summary')).toContainText('linked');
      await expect(page.getByTestId('analysis-ab-reference')).toBeEnabled();
      await expect(page.getByTestId('analysis-active-reference-inline')).not.toContainText(
        'No reference loaded'
      );

      await page.getByTestId('analysis-clear-reference').click();
      await expect(page.getByTestId('analysis-reference-summary')).toContainText('No reference');
      await expect(page.getByTestId('analysis-ab-reference')).toBeDisabled();

      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();

      await page.getByTestId('analysis-choose-reference-overlay').click();
      await expect(page.getByTestId('analysis-reference-slot-a')).toContainText('Overlay Reference.wav');

      await page.getByTestId('analysis-close-button').click();
      await expect(page.getByTestId('analysis-modal')).toHaveCount(0);

      await expect(page.getByTestId('analysis-reference-summary')).toContainText('Overlay Reference.wav');
      await expect(page.getByTestId('analysis-reference-summary')).toContainText('external');

      await page.getByTestId('analysis-ab-reference').click();
      await expect(page.getByTestId('player-track-name')).toContainText('Overlay Reference.wav');
      await page.getByTestId('analysis-ab-mix').click();
      await expect(page.getByTestId('player-track-name')).toContainText('Reference Alpha v1.wav');

      await page.getByTestId('analysis-clear-reference').click();
      await expect(page.getByTestId('analysis-reference-summary')).toContainText('No reference');
      await expect(page.getByTestId('analysis-ab-reference')).toBeDisabled();

      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-reference-slot-a')).toContainText('No reference loaded.');
      await page.getByTestId('analysis-close-button').click();
      await expect(page.getByTestId('analysis-modal')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(referenceDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('covers analysis panel controls, inline reference workflow, and overlay normalization details', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-analysis-controls-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-analysis-controls-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=7',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Coverage Mix v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await expect(page.getByTestId('analysis-empty-state')).toBeVisible();

      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await page.getByTestId('main-list-row').first().click();
      await page
        .getByTestId('inspector-version-row')
        .first()
        .getByRole('button', { name: 'Cue' })
        .click();

      await expect(page.getByTestId('analysis-track-label')).toContainText('Coverage Mix v1.wav');
      await expect(page.getByTestId('analysis-integrated-stat')).not.toContainText('Loading');
      await expect(page.getByTestId('analysis-ab-toggle')).toBeVisible();
      await expect(page.getByTestId('analysis-lra-stat')).toContainText('LU');
      await expect(page.getByTestId('analysis-max-short-term-stat')).toContainText('LUFS');
      await expect(page.getByTestId('analysis-max-momentary-stat')).toContainText('LUFS');
      await expect(page.getByTestId('analysis-short-term-stat')).toContainText('LUFS');
      await expect(page.getByTestId('analysis-tonal-balance')).toContainText('Low');
      await expect(page.getByTestId('analysis-normalization-cap')).toBeVisible();
      await expect(page.getByTestId('analysis-use-current-reference')).toBeEnabled();

      await page.getByTestId('analysis-use-current-reference').click();
      await expect(page.getByTestId('analysis-reference-summary')).toContainText('Coverage Mix v1.wav');
      await expect(page.getByTestId('analysis-active-reference-inline')).toContainText(
        'Loudness difference'
      );

      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-modal')).toBeVisible();
      await expect(page.getByTestId('analysis-overlay-status')).toHaveCount(0);
      await expect(page.getByTestId('analysis-overlay-preview-mode')).toContainText('reference ready');
      await expect(page.getByTestId('analysis-choose-reference-overlay')).toBeVisible();
      await expect(page.getByTestId('analysis-overlay-normalization-change')).toBeVisible();
      await expect(page.getByTestId('analysis-overlay-normalization-projected')).toBeVisible();
      await expect(page.getByTestId('analysis-overlay-normalization-cap')).toBeVisible();
      await expect(page.getByTestId('analysis-overlay-normalization-target')).toContainText('LUFS');
      await expect(page.getByTestId('analysis-overlay-normalization-policy')).toBeVisible();

      await page.getByTestId('analysis-close-button').click();
      await expect(page.getByTestId('analysis-modal')).toHaveCount(0);

      await page.getByTestId('analysis-clear-reference').click();
      await expect(page.getByTestId('analysis-reference-summary')).toContainText('No reference');
      await expect(page.getByTestId('analysis-active-reference-inline')).toContainText(
        'No reference loaded'
      );
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('shows analysis + reference error states for broken audio and missing reference files', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-analysis-errors-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-analysis-errors-user-data-')
    );

    const brokenTrackPath = path.join(fixtureDirectory, 'Broken Analysis v1.wav');
    const missingReferencePath = path.join(
      os.tmpdir(),
      `producer-player-missing-reference-${Date.now()}.wav`
    );

    await fs.writeFile(brokenTrackPath, 'this is intentionally not valid audio data');

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory, {
      extraEnv: {
        PRODUCER_PLAYER_E2E_REFERENCE_IMPORT_PATH: missingReferencePath,
      },
    });

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('main-list-row').first().click();
      await page
        .getByTestId('inspector-version-row')
        .first()
        .getByRole('button', { name: 'Cue' })
        .click();

      await expect
        .poll(async () => ((await page.getByTestId('analysis-status').textContent()) ?? '').trim())
        .toBe('Analysis failed.');
      await expect(page.getByTestId('analysis-error')).toBeVisible();

      await page.getByTestId('analysis-expand-button').click();
      await expect(page.getByTestId('analysis-overlay-status')).toContainText('Analysis failed.');
      await expect(page.getByTestId('analysis-overlay-error')).toBeVisible();
      await page.getByTestId('analysis-close-button').click();

      await page.getByTestId('analysis-choose-reference').click();
      await expect(page.getByTestId('analysis-reference-error')).toBeVisible();
      await expect(page.getByTestId('analysis-reference-error')).not.toHaveText('');
      await expect(page.getByTestId('app-shell')).toBeVisible();
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('quick A/B restores mix playhead after auditioning a reference', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-ab-restore-fixture-')
    );
    const referenceDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-ab-restore-reference-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-ab-restore-user-data-')
    );

    const alphaPath = path.join(fixtureDirectory, 'AB Alpha v1.wav');
    const betaPath = path.join(fixtureDirectory, 'AB Beta v1.wav');
    const externalReferencePath = path.join(referenceDirectory, 'AB Reference.wav');

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=360:duration=14',
      '-c:a',
      'pcm_s16le',
      alphaPath,
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=460:duration=14',
      '-c:a',
      'pcm_s16le',
      betaPath,
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=2200:duration=14',
      '-c:a',
      'pcm_s16le',
      externalReferencePath,
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory, {
      extraEnv: {
        PRODUCER_PLAYER_E2E_REFERENCE_IMPORT_PATH: externalReferencePath,
      },
    });

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      await page.getByTestId('main-list-row').filter({ hasText: 'AB Alpha' }).first().click();
      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.waitForTimeout(700);

      await page.getByTestId('player-scrubber').evaluate((element) => {
        const input = element as HTMLInputElement;
        input.value = '5.2';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await page.waitForTimeout(250);

      await page.getByTestId('analysis-choose-reference').click();
      await expect(page.getByTestId('analysis-reference-summary')).toContainText('AB Reference.wav');

      await page.getByTestId('analysis-ab-reference').click();
      await expect(page.getByTestId('player-track-name')).toContainText('AB Reference.wav');
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.waitForTimeout(550);

      await page.getByTestId('analysis-ab-mix').click();
      await expect(page.getByTestId('player-track-name')).toContainText('AB Alpha v1.wav');
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await expect
        .poll(async () => Number(await page.getByTestId('player-scrubber').inputValue()), {
          timeout: 4_000,
        })
        .toBeGreaterThanOrEqual(4.7);

      await expect(page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(referenceDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('measures integrated LUFS correctly across supported formats and sweeps normalization presets', async () => {
    const workspaceRoot = path.resolve(__dirname, '../../..');
    const fixtureDirectory = path.join(
      workspaceRoot,
      'artifacts/e2e-fixtures',
      `mastering-format-sweep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    await fs.mkdir(fixtureDirectory, { recursive: true });
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-mastering-format-sweep-user-data-')
    );

    const analysisFixtureBase = path.join(fixtureDirectory, 'Format Sweep v1');

    const formatFixtures: Array<{ label: string; extension: string; outputPath: string; encodeArgs: string[] }> =
      [
        {
          label: 'wav',
          extension: 'wav',
          outputPath: `${analysisFixtureBase}.wav`,
          encodeArgs: ['-c:a', 'pcm_s16le'],
        },
        {
          label: 'aiff',
          extension: 'aiff',
          outputPath: `${analysisFixtureBase}.aiff`,
          encodeArgs: ['-c:a', 'pcm_s16le'],
        },
        {
          label: 'flac',
          extension: 'flac',
          outputPath: `${analysisFixtureBase}.flac`,
          encodeArgs: ['-c:a', 'flac'],
        },
        {
          label: 'mp3',
          extension: 'mp3',
          outputPath: `${analysisFixtureBase}.mp3`,
          encodeArgs: ['-c:a', 'libmp3lame', '-q:a', '2'],
        },
        {
          label: 'm4a',
          extension: 'm4a',
          outputPath: `${analysisFixtureBase}.m4a`,
          encodeArgs: ['-c:a', 'aac', '-b:a', '192k'],
        },
      ];

    for (const fixture of formatFixtures) {
      await runFfmpeg([
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=6',
        '-filter:a',
        'volume=0.2',
        ...fixture.encodeArgs,
        fixture.outputPath,
      ]);
    }

    const proofPath = path.join(
      workspaceRoot,
      'artifacts/manual-verification/2026-03-11/mastering-lufs-format-sweep.json'
    );
    await fs.mkdir(path.dirname(proofPath), { recursive: true });

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await page.getByTestId('main-list-row').first().click();

      await expect(page.getByTestId('analysis-integrated-stat')).not.toContainText('Loading', {
        timeout: 12_000,
      });

      const integratedText = (await page
        .getByTestId('analysis-integrated-stat')
        .locator('strong')
        .textContent())?.trim();
      expect(integratedText).toBeTruthy();
      expect(integratedText).not.toContain('-70');

      const measurements: Record<string, unknown> = {};
      const snapshot = await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).producerPlayer;
        return api.getLibrarySnapshot();
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const songVersions = ((snapshot as any)?.songs?.[0]?.versions ?? []) as Array<{ filePath: string }>;
      expect(songVersions).toHaveLength(formatFixtures.length);

      for (const fixture of formatFixtures) {
        const version = songVersions.find((candidate) => candidate.filePath.endsWith(`.${fixture.extension}`));
        expect(version, `missing linked version for .${fixture.extension}`).toBeTruthy();

        const analysis = await page.evaluate(async (filePath) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const api = (window as any).producerPlayer;
          return api.analyzeAudioFile(filePath);
        }, version!.filePath);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const integratedLufs = (analysis as any)?.integratedLufs as number | null | undefined;

        measurements[fixture.label] = {
          filePath: version!.filePath,
          analysis,
        };

        expect(integratedLufs).not.toBeNull();
        expect(typeof integratedLufs).toBe('number');
        expect(integratedLufs as number).toBeGreaterThan(-65);
        expect(integratedLufs as number).toBeLessThan(0);
        expect(integratedLufs as number).not.toBe(-70);
      }

      await page.getByTestId('analysis-platform-spotify').click();
      await expect(page.getByTestId('analysis-platform-spotify')).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('analysis-platform-appleMusic').click();
      await expect(page.getByTestId('analysis-platform-appleMusic')).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('analysis-platform-youtube').click();
      await expect(page.getByTestId('analysis-platform-youtube')).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('analysis-platform-tidal').click();
      await expect(page.getByTestId('analysis-platform-tidal')).toHaveAttribute('aria-pressed', 'true');

      const normalizationToggle = page.getByTestId('analysis-normalization-toggle');
      await expect(normalizationToggle).toHaveText('Preview Off');
      await normalizationToggle.click();
      await expect(normalizationToggle).toHaveText('Preview On');
      await normalizationToggle.click();
      await expect(normalizationToggle).toHaveText('Preview Off');

      await fs.writeFile(
        proofPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            fixtures: formatFixtures.map((fixture) => ({
              label: fixture.label,
              extension: fixture.extension,
              outputPath: fixture.outputPath,
            })),
            measurements,
          },
          null,
          2
        ),
        'utf8'
      );

      await test.info().attach('mastering-lufs-format-sweep', {
        path: proofPath,
        contentType: 'application/json',
      });
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('shows platform normalization preview controls and captures proof screenshot', async () => {
    const workspaceRoot = path.resolve(__dirname, '../../..');
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-normalization-preview-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-normalization-preview-user-data-')
    );

    const screenshotPath = path.join(
      workspaceRoot,
      'artifacts/manual-verification/2026-03-10/normalization-preview-proof.png'
    );

    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=6',
      '-filter:a',
      'volume=0.2',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Normalization Probe v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('analysis-normalization-panel')).toBeVisible();
      await expect(page.getByTestId('analysis-integrated-stat')).not.toContainText('Loading', {
        timeout: 12_000,
      });

      await expect(page.getByTestId('analysis-platform-spotify')).toBeVisible();
      await expect(page.getByTestId('analysis-platform-appleMusic')).toBeVisible();
      await expect(page.getByTestId('analysis-platform-youtube')).toBeVisible();
      await expect(page.getByTestId('analysis-platform-tidal')).toBeVisible();

      await expect(page.getByTestId('analysis-platform-spotify')).toHaveAttribute('aria-pressed', 'true');

      const appliedChangeOnSpotify =
        (
          await page
            .getByTestId('analysis-normalization-change')
            .locator('strong')
            .first()
            .textContent()
        )?.trim() ?? '';

      await page.getByTestId('analysis-platform-youtube').click();
      await expect(page.getByTestId('analysis-platform-youtube')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('analysis-platform-spotify')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('analysis-normalization-summary')).toContainText('YouTube selected');

      const appliedChangeOnYoutube =
        (
          await page
            .getByTestId('analysis-normalization-change')
            .locator('strong')
            .first()
            .textContent()
        )?.trim() ?? '';

      expect(appliedChangeOnSpotify).not.toBe('');
      expect(appliedChangeOnYoutube).toContain('dB');
      expect(appliedChangeOnYoutube).not.toBe(appliedChangeOnSpotify);
      await expect(page.getByTestId('analysis-normalization-projected')).toContainText('LUFS');

      const normalizationToggle = page.getByTestId('analysis-normalization-toggle');
      await expect(normalizationToggle).toBeEnabled();
      await expect(normalizationToggle).toHaveText('Preview Off');
      await expect(page.getByTestId('analysis-normalization-summary')).toContainText('preview off');
      await expect(page.getByTestId('analysis-normalization-change')).toContainText(
        'Bypassed until Preview On'
      );

      await normalizationToggle.click();
      await expect(normalizationToggle).toHaveText('Preview On');
      await expect(page.getByTestId('analysis-normalization-summary')).toContainText('preview on');
      await expect(page.getByTestId('analysis-normalization-change')).toContainText(
        'Active on current playback'
      );

      await page.screenshot({ path: screenshotPath });
      await test.info().attach('normalization-preview-proof', {
        path: screenshotPath,
        contentType: 'image/png',
      });
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('shows album duration, support links, and persists song-row ratings', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-ratings-duration-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-ratings-duration-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:duration=6',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Alpha v1.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=660:duration=6',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Beta v1.wav'),
    ]);

    let firstLaunch: Awaited<ReturnType<typeof launchProducerPlayer>> | null = null;
    let secondLaunch: Awaited<ReturnType<typeof launchProducerPlayer>> | null = null;

    try {
      firstLaunch = await launchProducerPlayer(userDataDirectory);
      await firstLaunch.page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await firstLaunch.page.getByTestId('link-folder-path-button').click();

      await expect(firstLaunch.page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(firstLaunch.page.getByTestId('album-duration-label')).toContainText('0:12');
      await expect(firstLaunch.page.getByTestId('support-feedback-card')).toBeVisible();
      await expect(firstLaunch.page.getByTestId('support-feedback-bug')).toBeVisible();
      await expect(firstLaunch.page.getByTestId('support-feedback-feature')).toBeVisible();

      await firstLaunch.page
        .getByTestId('song-rating-slider')
        .first()
        .evaluate((element) => {
          const input = element as HTMLInputElement;
          input.value = '9';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      await expect(firstLaunch.page.getByTestId('song-rating-control').first()).toContainText('9/10');
      await firstLaunch.electronApp.close();
      firstLaunch = null;

      secondLaunch = await launchProducerPlayer(userDataDirectory);
      await expect(secondLaunch.page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(secondLaunch.page.getByTestId('album-duration-label')).toContainText('0:12');
      await expect(secondLaunch.page.getByTestId('song-rating-control').first()).toContainText('9/10');
    } finally {
      await firstLaunch?.electronApp.close();
      await secondLaunch?.electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('plays multiple AIFF variants by preparing them into local WAV cache', async () => {
    test.skip(!hasFfprobe(), 'ffprobe is required for codec verification in AIFF preparation tests.');

    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-aiff-variants-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-aiff-variants-user-data-')
    );

    const variants = [
      {
        label: 'Aiff 16',
        outputName: 'Variant Aiff 16 v1.aiff',
        codecArgs: ['-c:a', 'pcm_s16be'],
        expectedPreparedCodec: 'pcm_s16le',
      },
      {
        label: 'Aiff 24',
        outputName: 'Variant Aiff 24 v1.aiff',
        codecArgs: ['-c:a', 'pcm_s24be'],
        expectedPreparedCodec: 'pcm_s24le',
      },
      {
        label: 'Aif 16',
        outputName: 'Variant Aif 16 v1.aif',
        codecArgs: ['-c:a', 'pcm_s16be'],
        expectedPreparedCodec: 'pcm_s16le',
      },
    ] as const;

    for (const variant of variants) {
      await runFfmpeg([
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=4',
        ...variant.codecArgs,
        path.join(fixtureDirectory, variant.outputName),
      ]);
    }

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(3);

      for (const variant of variants) {
        const variantPath = path.join(fixtureDirectory, variant.outputName);

        await page.getByTestId('main-list-row').filter({ hasText: variant.label }).first().click();

        const preparedSource = await page.evaluate(async (targetPath) => {
          return (window as any).producerPlayer.resolvePlaybackSource(targetPath);
        }, variantPath);

        expect(preparedSource.sourceStrategy).toBe('transcoded-cache');
        expect(preparedSource.originalFilePath).toBe(variantPath);

        const preparedCodecName = await probeAudioCodecName(preparedSource.filePath);
        expect(preparedCodecName).toBe(variant.expectedPreparedCodec);

        await expect(page.getByTestId('playback-source-meta')).toHaveCount(0);

        await page.getByTestId('player-play-toggle').click();
        await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');
        await expect(page.getByTestId('playback-error')).toHaveCount(0);

        await page.getByTestId('player-play-toggle').click();
        await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Play');
      }
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

    const devServerPort = 4300 + Math.floor(Math.random() * 400);
    const rendererServer = await startRendererDevServer(workspaceRoot, devServerPort);

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
      rendererDevUrl: `http://127.0.0.1:${devServerPort}`,
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

  test('drag reorder shows insertion preview and keeps active playback running with scrub position continuity', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-reorder-continuity-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-reorder-continuity-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:duration=12',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Continuity Alpha v1.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=12',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Continuity Bravo v1.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=550:duration=12',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Continuity Charlie v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(3);

      const rows = await page.getByTestId('main-list-row').evaluateAll((elements) => {
        return elements.map((element) => ({
          id: element.getAttribute('data-song-id') ?? '',
          text: element.textContent ?? '',
        }));
      });

      const alpha = rows.find((row) => row.text.includes('Continuity Alpha'));

      if (!alpha || !alpha.id) {
        throw new Error('Could not resolve rows for reorder continuity test.');
      }

      const firstRowSongIdBeforeDrop =
        (await page.getByTestId('main-list-row').first().getAttribute('data-song-id')) ?? '';

      await page.getByTestId('main-list-row').filter({ hasText: 'Continuity Alpha' }).first().click();
      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      const playingTrackBefore =
        (await page.getByTestId('player-track-name').textContent())?.trim() ?? '';

      await page.waitForTimeout(1_200);

      const scrubberBefore = Number(
        (await page.getByTestId('player-scrubber').inputValue()).trim() || '0'
      );

      const sourceBox = await page.getByTestId('main-list-row').nth(2).boundingBox();
      const targetBox = await page.getByTestId('main-list-row').nth(0).boundingBox();

      if (!sourceBox || !targetBox) {
        throw new Error('Could not resolve drag source/target bounds.');
      }

      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetBox.x + 12, targetBox.y + 2, { steps: 12 });

      await expect(page.locator('.main-list-item.drop-preview-before')).toHaveCount(1);

      await page.mouse.up();

      await page.getByTestId('main-list-row').nth(2).dragTo(page.getByTestId('main-list-row').nth(0), {
        targetPosition: { x: 12, y: 2 },
      });

      await expect(page.getByTestId('main-list-row').first()).not.toHaveAttribute(
        'data-song-id',
        firstRowSongIdBeforeDrop
      );
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      const playingTrackAfter =
        (await page.getByTestId('player-track-name').textContent())?.trim() ?? '';
      expect(playingTrackAfter).toBe(playingTrackBefore);

      await page.waitForTimeout(900);
      const scrubberAfter = Number(
        (await page.getByTestId('player-scrubber').inputValue()).trim() || '0'
      );
      expect(scrubberAfter).toBeGreaterThan(scrubberBefore + 0.3);

      const firstRowTextBeforeSecondDrop =
        (await page.getByTestId('main-list-row').first().textContent())?.trim() ?? '';

      const sourceBoxSecond = await page.getByTestId('main-list-row').nth(0).boundingBox();
      const targetBoxSecond = await page.getByTestId('main-list-row').nth(2).boundingBox();

      if (!sourceBoxSecond || !targetBoxSecond) {
        throw new Error('Could not resolve drag bounds for second drop.');
      }

      await page.mouse.move(
        sourceBoxSecond.x + sourceBoxSecond.width / 2,
        sourceBoxSecond.y + sourceBoxSecond.height / 2
      );
      await page.mouse.down();
      await page.mouse.move(targetBoxSecond.x + 14, targetBoxSecond.y + targetBoxSecond.height - 3, {
        steps: 16,
      });
      await expect(page.locator('.main-list-item.drop-preview-after')).toHaveCount(1);
      await page.mouse.up();

      await page.getByTestId('main-list-row').first().dragTo(page.getByTestId('main-list-row').nth(2), {
        targetPosition: { x: 14, y: 46 },
      });

      const firstRowTextAfterSecondDrop =
        (await page.getByTestId('main-list-row').first().textContent())?.trim() ?? '';
      expect(firstRowTextAfterSecondDrop).not.toBe(firstRowTextBeforeSecondDrop);

      await page.getByTestId('track-order-hint').click();
      await page.keyboard.press('Space');
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Play');
      await page.keyboard.press('Space');
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');
      await expect(page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('finished tracks restart from zero after switching away and back', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-playhead-finished-reset-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-playhead-finished-reset-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=360:duration=1.3',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Reset Alpha v1.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=460:duration=1.3',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Reset Beta v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      await page.getByTestId('main-list-row').filter({ hasText: 'Reset Alpha' }).first().click();
      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await expect
        .poll(async () => (await page.getByTestId('player-play-toggle').getAttribute('aria-label')) ?? '', {
          timeout: 6_000,
        })
        .toBe('Play');

      expect(Number(await page.getByTestId('player-scrubber').inputValue())).toBeGreaterThan(1.15);

      await page.getByTestId('main-list-row').filter({ hasText: 'Reset Beta' }).first().click();
      await page.getByTestId('main-list-row').filter({ hasText: 'Reset Alpha' }).first().click();
      await page.getByTestId('player-play-toggle').click();

      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');
      await page.waitForTimeout(450);

      const restartedSeconds = Number(await page.getByTestId('player-scrubber').inputValue());
      expect(restartedSeconds).toBeGreaterThan(0.05);
      expect(restartedSeconds).toBeLessThan(0.9);
      await expect(page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('near-end tracks in the last second restart from zero after switching away and back', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-playhead-near-end-reset-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-playhead-near-end-reset-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:duration=6',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Near End Alpha v1.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=530:duration=6',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Near End Beta v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      await page.getByTestId('main-list-row').filter({ hasText: 'Near End Alpha' }).first().click();
      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.getByTestId('player-scrubber').evaluate((element) => {
        const input = element as HTMLInputElement;
        input.value = '5.4';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await page.waitForTimeout(250);

      await page.getByTestId('main-list-row').filter({ hasText: 'Near End Beta' }).first().dblclick();
      await expect(page.getByTestId('player-track-name')).toContainText('Near End Beta');
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.getByTestId('main-list-row').filter({ hasText: 'Near End Alpha' }).first().dblclick();
      await expect(page.getByTestId('player-track-name')).toContainText('Near End Alpha');
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.waitForTimeout(700);

      const restartedSeconds = Number(await page.getByTestId('player-scrubber').inputValue());
      expect(restartedSeconds).toBeGreaterThan(0.05);
      expect(restartedSeconds).toBeLessThan(1.15);
      await expect(page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('restores per-song playhead position within a session, but not after restarting the app', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-playhead-restore-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-playhead-restore-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=360:duration=14',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Restore Alpha v1.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=460:duration=14',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Restore Beta v1.wav'),
    ]);

    const firstLaunch = await launchProducerPlayer(userDataDirectory);

    try {
      await firstLaunch.page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await firstLaunch.page.getByTestId('link-folder-path-button').click();
      await expect(firstLaunch.page.getByTestId('main-list-row')).toHaveCount(2);

      await firstLaunch.page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Restore Alpha' })
        .first()
        .click();
      await firstLaunch.page.getByTestId('player-play-toggle').click();
      await expect(firstLaunch.page.getByTestId('player-play-toggle')).toHaveAttribute(
        'aria-label',
        'Pause'
      );

      await firstLaunch.page.waitForTimeout(900);

      await firstLaunch.page.getByTestId('player-scrubber').evaluate((element) => {
        const input = element as HTMLInputElement;
        input.value = '5.2';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await firstLaunch.page.waitForTimeout(250);

      await firstLaunch.page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Restore Beta' })
        .first()
        .dblclick();
      await expect(firstLaunch.page.getByTestId('player-track-name')).toContainText('Restore Beta');
      await expect(firstLaunch.page.getByTestId('player-play-toggle')).toHaveAttribute(
        'aria-label',
        'Pause'
      );

      await firstLaunch.page.waitForTimeout(550);

      await firstLaunch.page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Restore Alpha' })
        .first()
        .dblclick();
      await expect(firstLaunch.page.getByTestId('player-track-name')).toContainText('Restore Alpha');
      await expect(firstLaunch.page.getByTestId('player-play-toggle')).toHaveAttribute(
        'aria-label',
        'Pause'
      );

      await expect
        .poll(async () => Number(await firstLaunch.page.getByTestId('player-scrubber').inputValue()), {
          timeout: 4_000,
        })
        .toBeGreaterThan(4.7);

      await expect(firstLaunch.page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await firstLaunch.electronApp.close();
    }

    const secondLaunch = await launchProducerPlayer(userDataDirectory);

    try {
      if ((await secondLaunch.page.getByTestId('main-list-row').count()) === 0) {
        await secondLaunch.page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
        await secondLaunch.page.getByTestId('link-folder-path-button').click();
      }

      await expect(secondLaunch.page.getByTestId('main-list-row')).toHaveCount(2);

      await secondLaunch.page
        .getByTestId('main-list-row')
        .filter({ hasText: 'Restore Alpha' })
        .first()
        .click();
      await secondLaunch.page.getByTestId('player-play-toggle').click();
      await expect(secondLaunch.page.getByTestId('player-play-toggle')).toHaveAttribute(
        'aria-label',
        'Pause'
      );

      await expect
        .poll(async () => Number(await secondLaunch.page.getByTestId('player-scrubber').inputValue()), {
          timeout: 2_500,
        })
        .toBeLessThan(1.5);

      await expect(secondLaunch.page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await secondLaunch.electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('repeat-all wraps from the last track back to the first track', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-repeat-all-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-repeat-all-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=300:duration=1.2',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Repeat Alpha v1.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=500:duration=1.2',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Repeat Beta v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      await page.getByTestId('main-list-row').filter({ hasText: 'Repeat Alpha' }).first().click();

      await page.getByTestId('player-repeat').click();
      await page.getByTestId('player-repeat').click();
      await expect(page.getByTestId('player-repeat')).toContainText('Repeat: All');

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await expect
        .poll(
          async () =>
            ((await page.getByTestId('player-track-name').textContent()) ?? '').trim(),
          { timeout: 8_000 }
        )
        .toContain('Repeat Beta');

      await expect
        .poll(
          async () =>
            ((await page.getByTestId('player-track-name').textContent()) ?? '').trim(),
          { timeout: 8_000 }
        )
        .toContain('Repeat Alpha');

      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');
      await expect(page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('previous restarts current track first, then goes to previous track on the next press', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-previous-track-behavior-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-previous-track-behavior-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=300:duration=8',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Back Alpha v1.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=520:duration=8',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Back Beta v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    const readScrubberValue = async (): Promise<number> => {
      return Number.parseFloat(await page.getByTestId('player-scrubber').inputValue());
    };

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      const firstTrackName =
        ((await page.getByTestId('main-list-row').nth(0).locator('strong').textContent()) ?? '').trim();
      const secondTrackName =
        ((await page.getByTestId('main-list-row').nth(1).locator('strong').textContent()) ?? '').trim();

      await page.getByTestId('main-list-row').nth(1).click();
      await page
        .getByTestId('inspector-version-row')
        .first()
        .getByRole('button', { name: 'Cue' })
        .click();
      await expect(page.getByTestId('player-track-name')).toContainText(secondTrackName);

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await expect
        .poll(
          async () =>
            Number.parseFloat((await page.getByTestId('player-scrubber').getAttribute('max')) ?? '0')
        )
        .toBeGreaterThan(7);

      await expect.poll(readScrubberValue, { timeout: 12_000 }).toBeGreaterThan(2.3);

      await page.getByTestId('player-prev').click();
      await expect(page.getByTestId('player-track-name')).toContainText(secondTrackName);
      await expect.poll(readScrubberValue).toBeLessThan(0.25);

      await page.getByTestId('player-prev').click();
      await expect(page.getByTestId('player-track-name')).toContainText(firstTrackName);
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await expect.poll(readScrubberValue, { timeout: 8_000 }).toBeGreaterThan(1);

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Play');

      await page.getByTestId('player-prev').click();
      await expect(page.getByTestId('player-track-name')).toContainText(firstTrackName);
      await expect.poll(readScrubberValue).toBeLessThan(0.25);

      await expect(page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('single-clicking another track while playback is active only selects it until play is pressed', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-selection-playback-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-selection-playback-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:duration=8',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Select Alpha v1.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=610:duration=8',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Select Beta v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    const readScrubberValue = async (): Promise<number> => {
      return Number.parseFloat(await page.getByTestId('player-scrubber').inputValue());
    };

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      const firstRow = page.getByTestId('main-list-row').nth(0);
      const secondRow = page.getByTestId('main-list-row').nth(1);
      const firstTrackName = ((await firstRow.locator('strong').textContent()) ?? '').trim();
      const secondTrackName = ((await secondRow.locator('strong').textContent()) ?? '').trim();

      await firstRow.click();
      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');
      await expect(page.getByTestId('player-track-name')).toContainText(firstTrackName);
      await expect.poll(readScrubberValue, { timeout: 12_000 }).toBeGreaterThan(1.2);

      await secondRow.click();
      await expect(secondRow).toHaveClass(/selected/);
      await expect(page.getByTestId('player-track-name')).toContainText(firstTrackName);
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Play');
      await expect(page.getByTestId('player-track-name')).toContainText(firstTrackName);

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');
      await expect(page.getByTestId('player-track-name')).toContainText(secondTrackName);

      await expect(page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('responds to main-process transport command events (media-key command path)', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-transport-events-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-transport-events-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=380:duration=6',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Transport Alpha v1.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=580:duration=6',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Transport Beta v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      await page.getByTestId('main-list-row').filter({ hasText: 'Transport Alpha' }).first().click();
      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window?.webContents.send('producer-player:transport-command', 'play-pause');
      });

      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Play');

      await electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window?.webContents.send('producer-player:transport-command', 'play-pause');
      });

      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.getByTestId('player-scrubber').evaluate((element) => {
        const scrubber = element as HTMLInputElement;
        scrubber.value = '0.4';
        scrubber.dispatchEvent(new Event('input', { bubbles: true }));
        scrubber.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await expect
        .poll(async () => Number.parseFloat(await page.getByTestId('player-scrubber').inputValue()))
        .toBeLessThan(1);

      await electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window?.webContents.send('producer-player:transport-command', 'previous-track');
      });

      await expect(page.getByTestId('player-track-name')).toContainText('Transport Beta');
      await expect(page.getByTestId('playback-error')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });
});
