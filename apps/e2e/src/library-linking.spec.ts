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
      await expect(page.getByTestId('naming-guide')).toContainText(
        'File names must end with v1, v2, v3'
      );
      await expect(page.getByTestId('naming-guide')).not.toContainText('opinionated by design');
      await expect(page.getByRole('heading', { name: 'Album' })).toHaveCount(1);
      await expect(page.getByTestId('organize-button')).toHaveText('Organize');
      await expect(page.getByTestId('track-order-hint')).toContainText('positions are preserved');
      await expect(page.locator('.panel-left [data-testid="status-card"]')).toHaveCount(1);
      await expect(page.locator('.panel-right [data-testid="status-card"]')).toHaveCount(0);
      await expect(page.getByTestId('folder-tools-card')).toBeVisible();
      await expect(page.getByTestId('link-folder-dialog-button')).toBeVisible();
      await expect(page.getByTestId('producer-player-branding-logo')).toBeVisible();
      await expect(page.getByTestId('path-linker-disabled-message')).toHaveCount(0);

      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      // Nested folders are ignored by scan policy.
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(page.getByTestId('main-list-row').first()).toContainText('Midnight Echo');
      await expect(page.locator('.track-number').first()).toHaveText('1');
      await expect(page.getByRole('button', { name: /^Versions$/ })).toHaveCount(0);

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

      // Version history still includes archived old/ files, but the row copy is less noisy.
      await expect(page.getByTestId('inspector-version-row')).toHaveCount(2);
      await expect(page.getByTestId('inspector-song-title')).toContainText('Midnight Echo');
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('opens the per-song checklist modal and persists items in-session', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-checklist-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-checklist-user-data-')
    );

    await writeTestWav(path.join(fixtureDirectory, 'Checklist Tune v1.wav'), {
      frequencyHz: 510,
    });

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      const firstRow = page.getByTestId('main-list-row').first();
      await expect(
        firstRow.locator('.main-list-row-meta-footer [data-testid="song-checklist-button"]')
      ).toBeVisible();

      await firstRow.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();
      await expect(page.getByTestId('song-checklist-empty')).toContainText('No checklist items');

      await page.getByTestId('song-checklist-input').fill('Fade ending');
      await page.getByTestId('song-checklist-add').click();

      await expect(page.getByTestId('song-checklist-item-text')).toHaveValue('Fade ending');
      await page.getByTestId('song-checklist-close').click();
      await expect(page.getByTestId('song-checklist-modal')).toHaveCount(0);

      await firstRow.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-item-text')).toHaveValue('Fade ending');
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('keeps checklist controls compact, supports full item workflow, and persists checklist state across restart', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-checklist-workflow-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-checklist-workflow-user-data-')
    );

    await writeTestWav(path.join(fixtureDirectory, 'Checklist Flow v1.wav'), {
      frequencyHz: 530,
    });

    let firstLaunch: LaunchedApp | null = null;
    let secondLaunch: LaunchedApp | null = null;

    try {
      firstLaunch = await launchProducerPlayer(userDataDirectory);

      await firstLaunch.page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await firstLaunch.page.getByTestId('link-folder-path-button').click();

      await expect(firstLaunch.page.getByTestId('main-list-row')).toHaveCount(1);
      const firstRow = firstLaunch.page.getByTestId('main-list-row').first();

      const checklistPlacement = await firstRow
        .locator('.main-list-row-meta-footer')
        .evaluate((footer) => {
          const checklistButton = footer.querySelector('[data-testid="song-checklist-button"]');
          const dateLabel = footer.querySelector('.muted');

          if (!(checklistButton instanceof HTMLElement) || !(dateLabel instanceof HTMLElement)) {
            return null;
          }

          const checklistRect = checklistButton.getBoundingClientRect();
          const dateRect = dateLabel.getBoundingClientRect();

          return {
            sharedParent: checklistButton.parentElement === dateLabel.parentElement,
            checklistBeforeDate: Boolean(
              checklistButton.compareDocumentPosition(dateLabel) &
                Node.DOCUMENT_POSITION_FOLLOWING
            ),
            centerDeltaPx: Math.abs(
              checklistRect.top + checklistRect.height / 2 - (dateRect.top + dateRect.height / 2)
            ),
          };
        });

      expect(checklistPlacement).not.toBeNull();
      if (!checklistPlacement) {
        throw new Error('Could not resolve checklist/date placement in the song row metadata footer.');
      }
      expect(checklistPlacement.sharedParent).toBe(true);
      expect(checklistPlacement.checklistBeforeDate).toBe(true);
      expect(checklistPlacement.centerDeltaPx).toBeLessThan(10);

      await firstRow.getByTestId('song-checklist-button').click();
      await expect(firstLaunch.page.getByTestId('song-checklist-modal')).toBeVisible();

      await firstLaunch.page.getByTestId('song-checklist-input').fill('Fade ending');
      await firstLaunch.page.keyboard.press('Enter');
      await expect(firstLaunch.page.getByTestId('song-checklist-items')).toBeVisible();
      await firstLaunch.page.getByTestId('song-checklist-input').fill('Check vocal ride');
      await firstLaunch.page.getByTestId('song-checklist-add').click();

      await expect(firstLaunch.page.getByTestId('song-checklist-item-text')).toHaveCount(2);
      await expect(
        firstRow.getByTestId('song-checklist-button').locator('.song-checklist-count')
      ).toHaveText('2');

      const secondChecklistInput = firstLaunch.page.getByTestId('song-checklist-item-text').nth(1);
      await secondChecklistInput.fill('Check vocal ride + mono');
      await expect(secondChecklistInput).toHaveValue('Check vocal ride + mono');

      const firstChecklistToggle = firstLaunch.page
        .locator('.checklist-item-row input[type="checkbox"]')
        .first();
      await firstChecklistToggle.check();
      await expect(firstChecklistToggle).toBeChecked();

      await firstLaunch.page.keyboard.press('Escape');
      await expect(firstLaunch.page.getByTestId('song-checklist-modal')).toHaveCount(0);

      await firstRow.getByTestId('song-checklist-button').click();
      await expect(firstLaunch.page.getByTestId('song-checklist-item-text')).toHaveCount(2);
      await expect(
        firstLaunch.page.locator('.checklist-item-row input[type="checkbox"]').first()
      ).toBeChecked();
      await expect(firstLaunch.page.getByTestId('song-checklist-item-text').nth(1)).toHaveValue(
        'Check vocal ride + mono'
      );

      await firstLaunch.page.getByTestId('song-checklist-clear-completed').click();
      await expect(firstLaunch.page.getByTestId('song-checklist-item-text')).toHaveCount(1);
      await expect(firstLaunch.page.getByTestId('song-checklist-item-text').first()).toHaveValue(
        'Check vocal ride + mono'
      );
      await expect(
        firstRow.getByTestId('song-checklist-button').locator('.song-checklist-count')
      ).toHaveText('1');

      await firstLaunch.page.locator('.checklist-remove-button').first().click();
      await expect(firstLaunch.page.getByTestId('song-checklist-empty')).toBeVisible();
      await expect(
        firstRow.getByTestId('song-checklist-button').locator('.song-checklist-count')
      ).toHaveCount(0);

      await firstLaunch.page.getByTestId('song-checklist-input').fill('Final listen pass');
      await firstLaunch.page.getByTestId('song-checklist-add').click();
      await expect(firstLaunch.page.getByTestId('song-checklist-item-text')).toHaveValue(
        'Final listen pass'
      );
      await expect(
        firstRow.getByTestId('song-checklist-button').locator('.song-checklist-count')
      ).toHaveText('1');

      await firstLaunch.page.getByTestId('song-checklist-close').click();
      await expect(firstLaunch.page.getByTestId('song-checklist-modal')).toHaveCount(0);

      await firstLaunch.electronApp.close();
      firstLaunch = null;

      secondLaunch = await launchProducerPlayer(userDataDirectory);

      await expect(secondLaunch.page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(secondLaunch.page.getByTestId('main-list-row')).toHaveCount(1);

      const reopenedRow = secondLaunch.page.getByTestId('main-list-row').first();
      await expect(
        reopenedRow.getByTestId('song-checklist-button').locator('.song-checklist-count')
      ).toHaveText('1');

      await reopenedRow.getByTestId('song-checklist-button').click();
      await expect(secondLaunch.page.getByTestId('song-checklist-item-text')).toHaveCount(1);
      await expect(secondLaunch.page.getByTestId('song-checklist-item-text').first()).toHaveValue(
        'Final listen pass'
      );
    } finally {
      await firstLaunch?.electronApp.close();
      await secondLaunch?.electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('opens branding + support links via trusted GitHub URLs and rejects untrusted URLs', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-support-links-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-support-links-user-data-')
    );

    await writeTestWav(path.join(fixtureDirectory, 'Support Tune v1.wav'), {
      frequencyHz: 460,
    });

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await electronApp.evaluate(({ shell }) => {
        const globalState = globalThis as typeof globalThis & {
          __producerPlayerOpenedExternalUrls?: string[];
          __producerPlayerRestoreOpenExternal?: () => void;
        };
        const originalOpenExternal = shell.openExternal.bind(shell);

        globalState.__producerPlayerOpenedExternalUrls = [];
        shell.openExternal = (async (url: string) => {
          globalState.__producerPlayerOpenedExternalUrls?.push(url);
        }) as typeof shell.openExternal;
        globalState.__producerPlayerRestoreOpenExternal = () => {
          shell.openExternal = originalOpenExternal;
        };
      });

      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await page.getByTestId('main-list-row').first().click();

      await expect(page.getByTestId('support-feedback-card')).toBeVisible();
      await expect(page.getByTestId('support-feedback-bug')).toBeVisible();
      await expect(page.getByTestId('support-feedback-feature')).toBeVisible();

      await page.getByTestId('producer-player-branding').click();
      await page.getByTestId('support-feedback-bug').click();
      await page.getByTestId('support-feedback-feature').click();

      await expect
        .poll(() =>
          electronApp.evaluate(() => {
            const globalState = globalThis as typeof globalThis & {
              __producerPlayerOpenedExternalUrls?: string[];
            };
            return globalState.__producerPlayerOpenedExternalUrls ?? [];
          })
        )
        .toEqual([
          'https://github.com/EthanSK/producer-player/actions',
          'https://github.com/EthanSK/producer-player/issues/new?template=bug_report.yml',
          'https://github.com/EthanSK/producer-player/issues/new?template=feature_request.yml',
        ]);

      const untrustedUrlError = await page.evaluate(async () => {
        try {
          await (window as any).producerPlayer.openExternalUrl('https://example.com/not-allowed');
          return null;
        } catch (error) {
          if (error instanceof Error) {
            return error.message;
          }
          return String(error);
        }
      });

      expect(untrustedUrlError).toContain('Only Producer Player GitHub links are allowed.');
    } finally {
      await electronApp.evaluate(() => {
        const globalState = globalThis as typeof globalThis & {
          __producerPlayerRestoreOpenExternal?: () => void;
          __producerPlayerOpenedExternalUrls?: string[];
        };
        globalState.__producerPlayerRestoreOpenExternal?.();
        delete globalState.__producerPlayerRestoreOpenExternal;
        delete globalState.__producerPlayerOpenedExternalUrls;
      });
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('persists auto-organize preference and respects unlink cancel confirmation', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-settings-persistence-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-settings-persistence-user-data-')
    );

    await writeTestWav(path.join(fixtureDirectory, 'Settings Track v1.wav'), {
      frequencyHz: 420,
    });

    let firstLaunch: LaunchedApp | null = null;
    let secondLaunch: LaunchedApp | null = null;

    try {
      firstLaunch = await launchProducerPlayer(userDataDirectory);

      await firstLaunch.page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await firstLaunch.page.getByTestId('link-folder-path-button').click();

      await expect(firstLaunch.page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(firstLaunch.page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(firstLaunch.page.getByTestId('auto-organize-checkbox')).toBeChecked();

      await firstLaunch.page.evaluate(async () => {
        await (window as any).producerPlayer.setAutoMoveOld(false);
      });
      await expect(firstLaunch.page.getByTestId('auto-organize-checkbox')).not.toBeChecked();

      firstLaunch.page.once('dialog', async (dialog) => {
        await dialog.dismiss();
      });

      await firstLaunch.page
        .getByTestId('linked-folder-item')
        .first()
        .getByRole('button', { name: 'Unlink' })
        .click();

      await expect(firstLaunch.page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(firstLaunch.page.getByTestId('main-list-row')).toHaveCount(1);

      await firstLaunch.electronApp.close();
      firstLaunch = null;

      const statePath = path.join(userDataDirectory, STATE_FILE_NAME);
      const persistedRaw = await fs.readFile(statePath, 'utf8');
      const persistedState = JSON.parse(persistedRaw) as { autoMoveOld?: boolean };
      expect(persistedState.autoMoveOld).toBe(false);

      secondLaunch = await launchProducerPlayer(userDataDirectory);
      await expect(secondLaunch.page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(secondLaunch.page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(secondLaunch.page.getByTestId('auto-organize-checkbox')).not.toBeChecked();
    } finally {
      await firstLaunch?.electronApp.close();
      await secondLaunch?.electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });

  test('shows the Actions branding link, Full Screen label, and sample-rate badges', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-branding-fixture-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-branding-user-data-')
    );

    await writeTestWav(path.join(fixtureDirectory, 'Branding Tune v1.wav'), {
      frequencyHz: 440,
    });

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await electronApp.evaluate(({ shell }) => {
        const globalState = globalThis as typeof globalThis & {
          __producerPlayerOpenedExternalUrls?: string[];
          __producerPlayerRestoreOpenExternal?: () => void;
        };
        const originalOpenExternal = shell.openExternal.bind(shell);

        globalState.__producerPlayerOpenedExternalUrls = [];
        shell.openExternal = (async (url: string) => {
          globalState.__producerPlayerOpenedExternalUrls?.push(url);
        }) as typeof shell.openExternal;
        globalState.__producerPlayerRestoreOpenExternal = () => {
          shell.openExternal = originalOpenExternal;
        };
      });

      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      const firstRow = page.getByTestId('main-list-row').first();
      await firstRow.click();

      await expect(page.getByTestId('analysis-expand-button')).toHaveText(/Full Screen/);
      await expect(page.getByTestId('player-track-sample-rate')).toContainText('44.1 kHz');
      await expect(page.getByTestId('inspector-song-sample-rate')).toContainText('44.1 kHz');

      await page.getByTestId('producer-player-branding').click();
      await expect
        .poll(() =>
          electronApp.evaluate(() => {
            const globalState = globalThis as typeof globalThis & {
              __producerPlayerOpenedExternalUrls?: string[];
            };
            return globalState.__producerPlayerOpenedExternalUrls?.[0] ?? null;
          })
        )
        .toBe('https://github.com/EthanSK/producer-player/actions');
    } finally {
      await electronApp.evaluate(() => {
        const globalState = globalThis as typeof globalThis & {
          __producerPlayerRestoreOpenExternal?: () => void;
          __producerPlayerOpenedExternalUrls?: string[];
        };
        globalState.__producerPlayerRestoreOpenExternal?.();
        delete globalState.__producerPlayerRestoreOpenExternal;
        delete globalState.__producerPlayerOpenedExternalUrls;
      });
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

  test('restores track order from folder sidecar after reinstall-like user-data reset', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-fixture-')
    );
    const firstUserDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-user-data-first-')
    );
    const secondUserDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-user-data-second-')
    );

    await writeTestWav(path.join(fixtureDirectory, 'Alpha v1.wav'), { frequencyHz: 330 });
    await writeTestWav(path.join(fixtureDirectory, 'Beta v1.wav'), { frequencyHz: 660 });

    let firstLaunch: LaunchedApp | null = null;

    try {
      firstLaunch = await launchProducerPlayer(firstUserDataDirectory);

      await firstLaunch.page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await firstLaunch.page.getByTestId('link-folder-path-button').click();

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

      const alphaEntry = rowData.find((entry) => entry.text.includes('Alpha'));
      const betaEntry = rowData.find((entry) => entry.text.includes('Beta'));

      if (!alphaEntry || !betaEntry) {
        throw new Error('Could not resolve Alpha/Beta rows for reorder test.');
      }

      await firstLaunch.page.evaluate(async (orderedIds) => {
        await (window as any).producerPlayer.reorderSongs(orderedIds);
      }, [alphaEntry.id, betaEntry.id]);

      await expect(firstLaunch.page.getByTestId('main-list-row').first()).toContainText('Alpha');
    } finally {
      await firstLaunch?.electronApp.close();
    }

    const sidecarPath = path.join(
      fixtureDirectory,
      '.producer-player',
      'order-state.json'
    );

    const sidecarRaw = await fs.readFile(sidecarPath, 'utf8');
    const sidecar = JSON.parse(sidecarRaw) as {
      normalizedTitleOrder?: string[];
      songOrder?: string[];
    };

    expect(sidecar.normalizedTitleOrder).toEqual(
      expect.arrayContaining(['alpha', 'beta'])
    );
    expect((sidecar.songOrder ?? []).length).toBeGreaterThan(0);

    await fs.rm(firstUserDataDirectory, { recursive: true, force: true });

    let secondLaunch: LaunchedApp | null = null;

    try {
      secondLaunch = await launchProducerPlayer(secondUserDataDirectory);

      await secondLaunch.page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await secondLaunch.page.getByTestId('link-folder-path-button').click();

      await expect(secondLaunch.page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(secondLaunch.page.getByTestId('main-list-row').first()).toContainText('Alpha');

      const newStatePath = path.join(secondUserDataDirectory, STATE_FILE_NAME);
      const stateRaw = await fs.readFile(newStatePath, 'utf8');
      const state = JSON.parse(stateRaw) as { songOrder?: string[] };
      expect((state.songOrder ?? []).length).toBeGreaterThan(0);
    } finally {
      await secondLaunch?.electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(firstUserDataDirectory, { recursive: true, force: true });
      await fs.rm(secondUserDataDirectory, { recursive: true, force: true });
    }
  });

  test('switches the track list when selecting different linked folders and keeps the filter after rescan, unlink, and restart', async () => {
    const fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-multi-folder-')
    );
    const userDataDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'producer-player-e2e-user-data-')
    );
    const albumADirectory = path.join(fixtureRoot, 'Album A');
    const albumBDirectory = path.join(fixtureRoot, 'Album B');

    await fs.mkdir(albumADirectory, { recursive: true });
    await fs.mkdir(albumBDirectory, { recursive: true });

    await writeTestWav(path.join(albumADirectory, 'Alpha v1.wav'), {
      frequencyHz: 330,
    });
    await writeTestWav(path.join(albumADirectory, 'Outro v1.wav'), {
      frequencyHz: 392,
    });
    await writeTestWav(path.join(albumBDirectory, 'Beta v1.wav'), {
      frequencyHz: 523,
    });

    let firstLaunch: LaunchedApp | null = null;

    try {
      firstLaunch = await launchProducerPlayer(userDataDirectory);

      await firstLaunch.page.getByTestId('link-folder-path-input').fill(albumADirectory);
      await firstLaunch.page.getByTestId('link-folder-path-button').click();
      await firstLaunch.page.getByTestId('link-folder-path-input').fill(albumBDirectory);
      await firstLaunch.page.getByTestId('link-folder-path-button').click();

      await expect(firstLaunch.page.getByTestId('linked-folder-item')).toHaveCount(2);
      await expect(firstLaunch.page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(firstLaunch.page.locator('.panel-header .muted').first()).toHaveText('2 tracks');
      await expect(firstLaunch.page.getByTestId('main-list')).toContainText('Alpha');
      await expect(firstLaunch.page.getByTestId('main-list')).toContainText('Outro');
      await expect(firstLaunch.page.getByTestId('main-list')).not.toContainText('Beta');
      await expect(
        firstLaunch.page.getByTestId('main-list-row').first().getByTestId('main-list-row-metadata')
      ).toHaveText(/v1\s*·\s*wav/i);

      await firstLaunch.page
        .getByTestId('linked-folder-item')
        .filter({ hasText: 'Album B' })
        .click();

      await expect(firstLaunch.page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(firstLaunch.page.locator('.panel-header .muted').first()).toHaveText('1 track');
      await expect(firstLaunch.page.getByTestId('main-list-row').first()).toContainText('Beta');
      await expect(
        firstLaunch.page.getByTestId('main-list-row').first().getByTestId('main-list-row-metadata')
      ).toHaveText(/v1\s*·\s*wav/i);
      await expect(firstLaunch.page.getByTestId('main-list')).not.toContainText('Alpha');

      await firstLaunch.page.getByTestId('main-list-row').first().click();
      await expect(firstLaunch.page.getByTestId('inspector-song-title')).toContainText('Beta');

      await firstLaunch.page.getByTestId('rescan-button').click();
      await expect(firstLaunch.page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(firstLaunch.page.getByTestId('main-list-row').first()).toContainText('Beta');
      await expect(
        firstLaunch.page.getByTestId('main-list-row').first().getByTestId('main-list-row-metadata')
      ).toHaveText(/v1\s*·\s*wav/i);
    } finally {
      await firstLaunch?.electronApp.close();
    }

    let secondLaunch: LaunchedApp | null = null;

    try {
      secondLaunch = await launchProducerPlayer(userDataDirectory);

      await expect(secondLaunch.page.getByTestId('linked-folder-item')).toHaveCount(2);
      await expect(secondLaunch.page.getByTestId('main-list-row')).toHaveCount(2);

      await secondLaunch.page
        .getByTestId('linked-folder-item')
        .filter({ hasText: 'Album B' })
        .click();

      await expect(secondLaunch.page.getByTestId('main-list-row')).toHaveCount(1);
      await expect(secondLaunch.page.getByTestId('main-list-row').first()).toContainText('Beta');
      await expect(
        secondLaunch.page.getByTestId('main-list-row').first().getByTestId('main-list-row-metadata')
      ).toHaveText(/v1\s*·\s*wav/i);

      secondLaunch.page.once('dialog', async (dialog) => {
        await dialog.accept();
      });

      await secondLaunch.page
        .getByTestId('linked-folder-item')
        .filter({ hasText: 'Album B' })
        .getByRole('button', { name: 'Unlink' })
        .click();

      await expect(secondLaunch.page.getByTestId('linked-folder-item')).toHaveCount(1);
      await expect(secondLaunch.page.getByTestId('main-list-row')).toHaveCount(2);
      await expect(secondLaunch.page.getByTestId('main-list')).toContainText('Alpha');
      await expect(secondLaunch.page.getByTestId('main-list')).toContainText('Outro');
      await expect(secondLaunch.page.getByTestId('main-list')).not.toContainText('Beta');
    } finally {
      await secondLaunch?.electronApp.close();
      await fs.rm(fixtureRoot, { recursive: true, force: true });
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

    await writeTestWav(path.join(fixtureDirectory, 'Pulse v1.wav'), {
      frequencyHz: 440,
      durationMs: 10_000,
    });
    await writeTestWav(path.join(fixtureDirectory, 'Pulse v2.wav'), {
      frequencyHz: 520,
      durationMs: 10_000,
    });

    const { electronApp, page } = await launchProducerPlayer(userDataDirectory);

    try {
      await page.getByTestId('link-folder-path-input').fill(fixtureDirectory);
      await page.getByTestId('link-folder-path-button').click();

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('player-dock')).toBeVisible();

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute(
        'aria-label',
        'Pause'
      );
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

      await page.getByTestId('player-play-toggle').click();
      await expect(page.getByTestId('player-play-toggle')).toHaveAttribute(
        'aria-label',
        'Play'
      );
    } finally {
      await electronApp.close();
      await fs.rm(fixtureDirectory, { recursive: true, force: true });
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  });
});
