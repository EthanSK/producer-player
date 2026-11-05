// Launch isolated Electron test profiles and expose bounded renderer errors in CI.
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  type ElectronApplication,
} from '@playwright/test';

// macOS app activation is the main source of local focus-stealing during Electron E2Es,
// so default to a fully hidden app there unless a spec/debug session overrides it.
const DEFAULT_E2E_WINDOW_MODE = process.platform === 'darwin' ? 'hidden' : 'background';

function resolveE2EWindowMode(extraEnv?: Record<string, string>): string {
  return (
    extraEnv?.PRODUCER_PLAYER_E2E_WINDOW_MODE ??
    process.env.PRODUCER_PLAYER_E2E_WINDOW_MODE ??
    process.env.PLAYWRIGHT_ELECTRON_WINDOW_MODE ??
    DEFAULT_E2E_WINDOW_MODE
  );
}

export interface LaunchedApp {
  electronApp: ElectronApplication;
  page: Page;
}

export interface LaunchProducerPlayerOptions {
  devMode?: boolean;
  rendererDevUrl?: string;
  extraEnv?: Record<string, string>;
}

export interface FixtureFile {
  relativePath: string;
  contents?: string;
  modifiedAtMs?: number;
}

export interface E2ETestDirectories {
  fixtureDirectory: string;
  userDataDirectory: string;
}

export async function launchProducerPlayer(
  userDataDirectory: string,
  options: LaunchProducerPlayerOptions = {}
): Promise<LaunchedApp> {
  const workspaceRoot = path.resolve(__dirname, '../../../..');
  const electronEntry = path.join(workspaceRoot, 'apps/electron/dist/main.cjs');

  // Exercise the real media pipeline without sending test tones to the
  // developer's speakers. Chromium still advances media and emits playback
  // events under this switch, so continuity assertions remain meaningful.
  const launchArgs = [electronEntry, '--mute-audio'];
  if (process.platform === 'linux' && process.env.CI) {
    launchArgs.unshift('--disable-setuid-sandbox');
    launchArgs.unshift('--no-sandbox');
  }

  const electronApp = await electron.launch({
    args: launchArgs,
    env: {
      ...process.env,
      PRODUCER_PLAYER_USER_DATA_DIR: userDataDirectory,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      PRODUCER_PLAYER_TEST_ID: randomUUID(),
      PRODUCER_PLAYER_E2E_WINDOW_MODE: resolveE2EWindowMode(options.extraEnv),
      ...(options.devMode ? { ELECTRON_DEV: 'true' } : {}),
      ...(options.rendererDevUrl ? { RENDERER_DEV_URL: options.rendererDevUrl } : {}),
      ...(options.extraEnv ?? {}),
    },
  });

  const page = await electronApp.firstWindow();
  if (process.env.CI) {
    let reportedErrors = 0;
    const reportError = (message: string): void => {
      if (reportedErrors++ < 10) console.error('[electron-renderer-error]', message);
    };
    page.on('pageerror', (error) => reportError(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') reportError(message.text());
    });
  }
  await page.waitForSelector('[data-testid="app-shell"]');

  return {
    electronApp,
    page,
  };
}

// Extraction of existing inspector-drawer.spec.ts onboarding setup, shared
// by tests that need first-launch Agent Chat out of the way. Flags and reload
// are unchanged; the production app and its onboarding behavior are unchanged.
// Suppress the first-launch auto-open of the Agent Chat Panel (which would
// otherwise cover the bottom-right corner of the viewport and intercept
// clicks on the inspector-toggle button). We do this by setting the same
// localStorage flag the panel itself writes after its first appearance, then
// reloading so the panel initializes with that flag in scope.
export async function suppressAgentPanelOnboarding(
  page: Awaited<ReturnType<typeof launchProducerPlayer>>['page']
): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.setItem('producer-player.agent-panel-seen', 'true');
    window.localStorage.setItem(
      'producer-player.agent-panel-onboarding-armed',
      'true'
    );
  });
  await page.reload();
  await page.waitForSelector('[data-testid="app-shell"]');
}

export async function createE2ETestDirectories(prefix: string): Promise<E2ETestDirectories> {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-fixture-`));
  const userDataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-user-data-`));

  return {
    fixtureDirectory,
    userDataDirectory,
  };
}

export async function writeFixtureFiles(
  rootDirectory: string,
  files: FixtureFile[]
): Promise<void> {
  for (const file of files) {
    const absolutePath = path.join(rootDirectory, file.relativePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.contents ?? 'stub-audio-data');

    if (typeof file.modifiedAtMs === 'number') {
      const timestamp = new Date(file.modifiedAtMs);
      await fs.utimes(absolutePath, timestamp, timestamp);
    }
  }
}

export async function cleanupE2ETestDirectories(
  directories: E2ETestDirectories
): Promise<void> {
  await fs.rm(directories.fixtureDirectory, { recursive: true, force: true });
  await fs.rm(directories.userDataDirectory, { recursive: true, force: true });
}

export async function createMessyFolderFixture(
  fixtureDirectory: string,
  topLevelAudio: FixtureFile[]
): Promise<void> {
  await writeFixtureFiles(fixtureDirectory, [
    ...topLevelAudio,
    {
      relativePath: 'random-junk/subfolder/Ignore Me v1.wav',
      modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z'),
    },
    {
      relativePath: 'random-junk/subfolder/deeper/Ignore Me v2.wav',
      modifiedAtMs: Date.parse('2026-01-01T00:00:11.000Z'),
    },
    {
      relativePath: '.hidden/Ignore Hidden v1.wav',
      modifiedAtMs: Date.parse('2026-01-01T00:00:12.000Z'),
    },
    {
      relativePath: 'docs/notes.txt',
      contents: 'not audio',
    },
  ]);
}
