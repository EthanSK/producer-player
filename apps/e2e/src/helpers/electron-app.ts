// Launch isolated Electron test profiles and expose bounded renderer errors in CI.
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
  test,
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

// Preserve the real pointer click; capture this custom Electron page before
// each spec's finally block closes it (Playwright's page fixture does not own it).
export async function openMasteringWithDiagnostics(
  page: Page, electronApp: ElectronApplication
): Promise<void> {
  const bounded = <T>(operation: Promise<T>, timeoutMs = 5_000): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Diagnostic timed out')), timeoutMs);
    operation.then((value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Debugger.enable');
  const paused = new Promise((resolve) => cdp.once('Debugger.paused', async (event) => {
    const frames = event.callFrames.slice(0, 12).map((frame) => ({
      functionName: frame.functionName, url: frame.url, location: frame.location,
    }));
    console.log('[mastering-click-stack]', JSON.stringify(frames));
    try {
      const layout = await bounded(cdp.send('Debugger.evaluateOnCallFrame', {
        callFrameId: event.callFrames[0].callFrameId,
        returnByValue: true,
        expression: `JSON.stringify({ viewport: [innerWidth, innerHeight], elements: Array.from(document.querySelectorAll('.analysis-overlay-card, .analysis-overlay-grid, .analysis-overlay-viz-spectrum, [data-testid="analysis-loudness-histogram"], .analysis-overlay canvas')).map(el => ({className: el.className, width: el.getBoundingClientRect().width, canvasWidth: el instanceof HTMLCanvasElement ? el.width : null, height: el.getBoundingClientRect().height})) })`,
      }));
      console.log('[mastering-click-layout]', layout.result.value);
      const script = await bounded(cdp.send('Debugger.getScriptSource', {
        scriptId: event.callFrames[0].location.scriptId,
      }));
      await test.info().attach('mastering-renderer-source', {
        body: script.scriptSource, contentType: 'text/javascript',
      });
    } catch (error) { console.log('[mastering-click-paused-diagnostic]', String(error)); }
    resolve(frames);
  }));
  try {
    await page.getByTestId('analysis-expand-button').click();
  } catch (failure) {
    const diagnostics = await Promise.allSettled([
      page.screenshot({ timeout: 5_000 }).then((body) =>
        test.info().attach('mastering-click-screen', { body, contentType: 'image/png' })
      ),
      bounded(cdp.send('Debugger.pause').then(() => paused)).then((frames) => test.info().attach('mastering-click-stack', {
        body: JSON.stringify(frames), contentType: 'application/json',
      })),
      bounded(electronApp.evaluate(({ app, BrowserWindow }) => {
        const windows = BrowserWindow.getAllWindows();
        return {
          windows: windows.map((window) => ({
            bounds: window.getBounds(), focused: window.isFocused(), visible: window.isVisible(),
            destroyed: window.isDestroyed(), crashed: window.webContents.isCrashed(),
            rendererPid: window.webContents.getOSProcessId(),
          })),
          metrics: app.getAppMetrics(),
        };
      })).then(async (state) => {
        console.log('[mastering-click-main-state]', JSON.stringify(state));
        await test.info().attach('mastering-click-main-state', {
          body: JSON.stringify(state), contentType: 'application/json',
        });
      }),
      bounded(electronApp.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64')
      )).then((screenshot) => test.info().attach('mastering-click-native-screen', {
        body: Buffer.from(screenshot, 'base64'), contentType: 'image/png',
      })),
    ]);
    console.log('[mastering-click-diagnostics]', diagnostics.map((result) =>
      result.status === 'fulfilled' ? 'captured' : String(result.reason)
    ));
    throw failure;
  } finally {
    // Only a failed disposable fixture is paused, then released before teardown.
    await bounded(cdp.send('Debugger.resume'), 1_000).catch(() => undefined);
    await bounded(cdp.detach(), 1_000).catch(() => undefined);
  }
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
