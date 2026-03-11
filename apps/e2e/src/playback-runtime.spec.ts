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

      await page.getByTestId('main-list-row').filter({ hasText: 'Warm Master' }).first().click();
      await expect(page.getByTestId('analysis-panel')).toContainText('Mastering + Reference');
      await expect(page.getByTestId('analysis-status')).toContainText('Loading');

      const initialPanelHeight = await page.getByTestId('analysis-panel').evaluate((element) => {
        return Math.round(element.getBoundingClientRect().height);
      });

      await expect(page.getByTestId('analysis-integrated-stat')).not.toContainText('Loading');
      await expect(page.getByTestId('analysis-integrated-stat')).toContainText('LUFS');
      await expect(page.getByTestId('analysis-true-peak-stat')).toContainText('dBFS');
      await expect(page.getByTestId('analysis-reference-summary')).toContainText(
        'Choose a reference file'
      );

      await page.getByTestId('main-list-row').filter({ hasText: 'Bright Ref' }).first().click();
      await expect(page.getByTestId('analysis-track-label')).toContainText('Bright Ref v1.wav');
      await expect(page.getByTestId('analysis-status')).toContainText('Loading');

      const loadingPanelHeight = await page.getByTestId('analysis-panel').evaluate((element) => {
        return Math.round(element.getBoundingClientRect().height);
      });
      expect(Math.abs(initialPanelHeight - loadingPanelHeight)).toBeLessThanOrEqual(6);

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
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(referenceDirectory, { recursive: true, force: true });
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
      },
      {
        label: 'Aiff 24',
        outputName: 'Variant Aiff 24 v1.aiff',
        codecArgs: ['-c:a', 'pcm_s24be'],
      },
      {
        label: 'Aif 16',
        outputName: 'Variant Aif 16 v1.aif',
        codecArgs: ['-c:a', 'pcm_s16be'],
      },
    ];

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

      await page.getByTestId('main-list-row').filter({ hasText: 'Near End Beta' }).first().click();
      await expect(page.getByTestId('player-track-name')).toContainText('Near End Beta');
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.getByTestId('main-list-row').filter({ hasText: 'Near End Alpha' }).first().click();
      await expect(page.getByTestId('player-track-name')).toContainText('Near End Alpha');
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute('aria-label', 'Pause');

      await page.waitForTimeout(700);

      const restartedSeconds = Number(await page.getByTestId('player-scrubber').inputValue());
      expect(restartedSeconds).toBeGreaterThan(0.05);
      expect(restartedSeconds).toBeLessThan(1.1);
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
        .click();
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
        .click();
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

  test('search finds older versions and keeps single-result row height stable', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-search-versions-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-search-versions-user-data-')
    );

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=300:duration=6',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Search Alpha v1.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=400:duration=6',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Search Alpha v2.wav'),
    ]);

    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=500:duration=6',
      '-c:a',
      'pcm_s16le',
      path.join(fixtureDirectory, 'Search Beta v1.wav'),
    ]);

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(2);

      const baselineRowHeight = await page
        .getByTestId('main-list-row')
        .first()
        .evaluate((element) => element.getBoundingClientRect().height);

      await page.getByTestId('search-input').fill('Search Alpha v1');

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(page.getByTestId('main-list-row').first()).toContainText('Matched versions:');
      await expect(page.getByTestId('main-list-row').first()).toContainText('Search Alpha v1.wav');

      const singleResultRowHeight = await page
        .getByTestId('main-list-row')
        .first()
        .evaluate((element) => element.getBoundingClientRect().height);

      expect(singleResultRowHeight).toBeLessThanOrEqual(baselineRowHeight + 8);
      expect(singleResultRowHeight).toBeGreaterThan(56);
    } finally {
      await electronApp.close();
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
