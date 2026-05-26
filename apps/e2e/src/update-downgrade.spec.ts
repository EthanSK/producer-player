import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

function platformMetadataAssetName(): string {
  if (process.platform === 'darwin') return 'latest-mac.yml';
  if (process.platform === 'linux') return 'latest-linux.yml';
  if (process.platform === 'win32') return 'latest.yml';
  return 'latest.yml';
}

function platformPackageAssetName(version: string): string {
  if (process.platform === 'darwin') return 'Producer-Player-' + version + '-mac-universal.zip';
  if (process.platform === 'linux') return 'Producer-Player-' + version + '-linux-x64.AppImage';
  if (process.platform === 'win32') return 'Producer-Player-' + version + '-win-x64.exe';
  return 'Producer-Player-' + version + '-unknown.zip';
}

function releaseFixture(tagName: string, version: string) {
  return {
    tag_name: tagName,
    html_url: 'https://github.com/EthanSK/producer-player/releases/tag/' + tagName,
    name: tagName,
    published_at: '2026-05-25T12:00:00.000Z',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: platformMetadataAssetName(),
        browser_download_url: 'https://example.invalid/' + version + '/' + platformMetadataAssetName(),
      },
      {
        name: platformPackageAssetName(version),
        browser_download_url: 'https://example.invalid/' + version + '/installer',
      },
    ],
  };
}

test.describe('Support update downgrade control', () => {
  test('shows Downgrade next to Check for Updates', async () => {
    const dirs = await createE2ETestDirectories('update-downgrade-visible');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      const actions = page.getByTestId('support-feedback-update-actions');
      await expect(actions).toBeVisible();
      await expect(page.getByTestId('support-feedback-check-updates')).toBeVisible();
      await expect(page.getByTestId('support-feedback-downgrade-update')).toBeVisible();

      const actionTestIds = await actions.locator('button').evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('data-testid')),
      );
      expect(actionTestIds).toEqual([
        'support-feedback-check-updates',
        'support-feedback-downgrade-update',
      ]);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('clicking Downgrade resolves the previous release through the mocked main-process flow', async () => {
    const dirs = await createE2ETestDirectories('update-downgrade-click');
    const recordPath = path.join(dirs.userDataDirectory, 'downgrade-record.json');
    const releases = [
      releaseFixture('v3.265.0', '3.265.0'),
      releaseFixture('v3.264.0', '3.264.0'),
      releaseFixture('v3.263.0', '3.263.0'),
    ];
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: {
        PRODUCER_PLAYER_E2E_DOWNGRADE_RELEASES_JSON: JSON.stringify(releases),
        PRODUCER_PLAYER_E2E_DOWNGRADE_RECORD_PATH: recordPath,
      },
    });

    try {
      await page.getByTestId('support-feedback-downgrade-update').click();

      await expect
        .poll(async () => {
          try {
            return JSON.parse(await fs.readFile(recordPath, 'utf8'));
          } catch {
            return null;
          }
        })
        .not.toBeNull();

      const recorded = JSON.parse(await fs.readFile(recordPath, 'utf8'));
      expect(recorded).toMatchObject({
        previousVersion: '3.264',
        previousTag: 'v3.264.0',
      });
      await expect(page.getByTestId('support-feedback-update-status')).toContainText(
        'Downloading update',
      );
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('does not downgrade when no older release is available', async () => {
    const dirs = await createE2ETestDirectories('update-downgrade-none');
    const recordPath = path.join(dirs.userDataDirectory, 'downgrade-record.json');
    const releases = [releaseFixture('v3.265.0', '3.265.0')];
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory, {
      extraEnv: {
        PRODUCER_PLAYER_E2E_DOWNGRADE_RELEASES_JSON: JSON.stringify(releases),
        PRODUCER_PLAYER_E2E_DOWNGRADE_RECORD_PATH: recordPath,
      },
    });

    try {
      await page.getByTestId('support-feedback-downgrade-update').click();
      await expect(page.getByTestId('support-feedback-update-status')).toContainText(
        'No older Producer Player release is available',
      );
      await expect
        .poll(async () => {
          try {
            await fs.access(recordPath);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(false);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });
});
