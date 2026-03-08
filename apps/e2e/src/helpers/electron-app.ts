import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

export interface LaunchedApp {
  electronApp: ElectronApplication;
  page: Page;
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

export async function launchProducerPlayer(userDataDirectory: string): Promise<LaunchedApp> {
  const workspaceRoot = path.resolve(__dirname, '../../../..');
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
