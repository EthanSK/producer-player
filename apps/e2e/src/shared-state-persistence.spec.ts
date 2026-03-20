import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

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
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }, 2000);
  });
}

test('ratings and checklist items survive switching between dev and packaged app', async () => {
  const workspaceRoot = path.resolve(__dirname, '../../..');
  const dirs = await createE2ETestDirectories('shared-state-cross-mode');

  await writeFixtureFiles(dirs.fixtureDirectory, [
    { relativePath: 'Shared State Song v1.wav', contents: 'RIFF shared-state-audio' },
  ]);

  const devServerPort = 4700 + Math.floor(Math.random() * 200);
  const rendererServer = await startRendererDevServer(workspaceRoot, devServerPort);

  try {
    const devLaunch = await launchProducerPlayer(dirs.userDataDirectory, {
      devMode: true,
      rendererDevUrl: `http://127.0.0.1:${devServerPort}`,
    });

    let songId = '';

    try {
      await devLaunch.page.evaluate(async (folderPath) => {
        await (window as any).producerPlayer.linkFolder(folderPath);
      }, dirs.fixtureDirectory);

      await expect(devLaunch.page.getByTestId('main-list-row')).toHaveCount(1, {
        timeout: 15_000,
      });

      songId =
        (await devLaunch.page
          .getByTestId('main-list-row')
          .first()
          .getAttribute('data-song-id')) ?? '';
      expect(songId).not.toBe('');

      await devLaunch.page.getByTestId('song-rating-slider').first().evaluate((element) => {
        const slider = element as HTMLInputElement;
        slider.value = '8';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await expect(devLaunch.page.getByTestId('song-rating-slider').first()).toHaveValue('8');

      const devMainRow = devLaunch.page.getByTestId('main-list-row').first();
      await devMainRow.getByTestId('song-checklist-button').click();
      await expect(devLaunch.page.getByTestId('song-checklist-modal')).toBeVisible();

      await devLaunch.page.getByTestId('song-checklist-input').fill('Cross-mode checklist note');
      await devLaunch.page.getByTestId('song-checklist-add').click();
      await expect(devLaunch.page.getByTestId('song-checklist-item-text')).toHaveValue(
        'Cross-mode checklist note'
      );

      await devLaunch.page
        .getByTestId('song-checklist-modal')
        .getByRole('button', { name: 'Done' })
        .click();
      await expect(devLaunch.page.getByTestId('song-checklist-modal')).toHaveCount(0);

      await devLaunch.page.waitForTimeout(1200);

    } finally {
      await devLaunch.electronApp.close();
    }

    await stopProcess(rendererServer);

    const sharedStatePath = path.join(
      dirs.userDataDirectory,
      'producer-player-shared-user-state.json'
    );

    const sharedStateRaw = await fs.readFile(sharedStatePath, 'utf8');
    const sharedState = JSON.parse(sharedStateRaw) as {
      ratings?: Record<string, number>;
      checklists?: Record<
        string,
        Array<{
          id: string;
          text: string;
          completed: boolean;
          timestampSeconds: number | null;
        }>
      >;
    };

    expect(sharedState.ratings?.[songId]).toBe(8);
    expect(sharedState.checklists?.[songId]?.[0]?.text).toBe('Cross-mode checklist note');

    const packagedLaunch = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await expect(packagedLaunch.page.getByTestId('main-list-row')).toHaveCount(1, {
        timeout: 15_000,
      });

      await expect(packagedLaunch.page.getByTestId('song-rating-slider').first()).toHaveValue('8');

      const packagedMainRow = packagedLaunch.page.getByTestId('main-list-row').first();
      await packagedMainRow.getByTestId('song-checklist-button').click();
      await expect(packagedLaunch.page.getByTestId('song-checklist-item-text')).toHaveCount(1);
      await expect(packagedLaunch.page.getByTestId('song-checklist-item-text').first()).toHaveValue(
        'Cross-mode checklist note'
      );
    } finally {
      await packagedLaunch.electronApp.close();
    }
  } finally {
    await stopProcess(rendererServer).catch(() => undefined);
    await cleanupE2ETestDirectories(dirs);
  }
});
