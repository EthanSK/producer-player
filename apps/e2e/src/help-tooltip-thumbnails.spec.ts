import { expect, test, type Page } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

async function linkFixtureFolder(page: Page, fixtureDirectory: string): Promise<void> {
  await page.evaluate(async (folderPath) => {
    await (
      window as typeof window & {
        producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
      }
    ).producerPlayer.linkFolder(folderPath);
  }, fixtureDirectory);

  await expect(page.getByTestId('main-list-row')).toHaveCount(1);
}

test.describe('Help tooltip YouTube thumbnails', () => {
  test('loads tutorial thumbnails when YouTube redirects to ytimg CDN', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-help-tooltip-youtube-thumbnails'
    );

    await writeFixtureFiles(directories.fixtureDirectory, [
      { relativePath: 'Thumbnail Check v1.wav', modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);
    const onePixelPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3QFwAAAABJRU5ErkJggg==';

    try {
      await electronApp.evaluate(({ BrowserWindow }, pngBase64) => {
        const [mainWindow] = BrowserWindow.getAllWindows();
        if (!mainWindow) {
          throw new Error('Expected Producer Player main window to exist.');
        }

        const globalWithThumbnailHosts = globalThis as typeof globalThis & {
          __producerPlayerThumbnailHosts?: string[];
        };
        globalWithThumbnailHosts.__producerPlayerThumbnailHosts = [];

        mainWindow.webContents.session.protocol.handle('https', async (request) => {
          const url = new URL(request.url);
          const isThumbnailRequest =
            (url.hostname === 'img.youtube.com' || url.hostname === 'i.ytimg.com') &&
            url.pathname.endsWith('/mqdefault.jpg');

          if (isThumbnailRequest) {
            globalWithThumbnailHosts.__producerPlayerThumbnailHosts?.push(url.hostname);
          }

          if (url.hostname === 'img.youtube.com' && isThumbnailRequest) {
            return Response.redirect(
              request.url.replace('https://img.youtube.com/', 'https://i.ytimg.com/'),
              302
            );
          }

          if (url.hostname === 'i.ytimg.com' && isThumbnailRequest) {
            return new Response(Buffer.from(pngBase64, 'base64'), {
              headers: {
                'access-control-allow-origin': '*',
                'content-type': 'image/png',
              },
            });
          }

          return fetch(request);
        });
      }, onePixelPngBase64);

      await linkFixtureFolder(page, directories.fixtureDirectory);
      await page.getByTestId('main-list-row').first().click();
      await expect(page.getByTestId('analysis-integrated-stat')).toBeVisible();

      await page
        .getByTestId('analysis-integrated-stat')
        .locator('.help-tooltip-trigger')
        .first()
        .click();

      const helpDialog = page
        .getByRole('dialog')
        .filter({ hasText: /Video Tutorials \(order ranked by AI\)/i });
      await expect(helpDialog).toBeVisible();

      const firstThumbnail = helpDialog.locator('img[src*="img.youtube.com"]').first();
      await expect(firstThumbnail).toBeVisible();
      await expect
        .poll(async () =>
          firstThumbnail.evaluate((img) => {
            const image = img as HTMLImageElement;
            return { complete: image.complete, naturalWidth: image.naturalWidth };
          })
        )
        .toEqual({ complete: true, naturalWidth: 1 });

      const imageHostsHit = await electronApp.evaluate(({ BrowserWindow }) => {
        const [mainWindow] = BrowserWindow.getAllWindows();
        mainWindow?.webContents.session.protocol.unhandle('https');
        return (
          globalThis as typeof globalThis & {
            __producerPlayerThumbnailHosts?: string[];
          }
        ).__producerPlayerThumbnailHosts ?? [];
      });
      expect(imageHostsHit).toContain('img.youtube.com');
      expect(imageHostsHit).toContain('i.ytimg.com');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
