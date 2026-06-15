import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
  writeFixtureFiles,
} from './helpers/electron-app';

test.describe('custom script runner', () => {
  test('saves a toolbar script and runs it with Producer Player context env vars', async () => {
    const directories = await createE2ETestDirectories('producer-player-custom-script');
    const scriptPath = path.join(directories.userDataDirectory, 'producer-player-hook.sh');

    await writeFixtureFiles(directories.fixtureDirectory, [
      {
        relativePath: 'Script Runner v1.wav',
      },
    ]);

    await fs.writeFile(
      scriptPath,
      [
        'printf "CUSTOM_SCRIPT_OK\\n"',
        'printf "SONG_TITLE=%s\\n" "$PRODUCER_PLAYER_SELECTED_SONG_TITLE"',
        'printf "PLAYBACK_FILE=%s\\n" "$PRODUCER_PLAYER_SELECTED_PLAYBACK_FILE_NAME"',
        'printf "FOLDER_PATH=%s\\n" "$PRODUCER_PLAYER_SELECTED_FOLDER_PATH"',
        'printf "APP_VERSION=%s\\n" "$PRODUCER_PLAYER_APP_VERSION"',
        'case ":$PATH:" in',
        '  *:/opt/homebrew/bin:*) printf "PATH_HAS_HOMEBREW=yes\\n" ;;',
        '  *) printf "PATH_HAS_HOMEBREW=no\\n" ;;',
        'esac',
        'printf "CWD=%s\\n" "$PWD"',
        '',
      ].join('\n'),
      'utf8',
    );

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await page.evaluate(async (folderPath) => {
        await (window as any).producerPlayer.linkFolder(folderPath);
      }, directories.fixtureDirectory);

      await expect(page.getByTestId('main-list-row')).toHaveCount(1);
      await page.getByTestId('main-list-row').first().click();

      await expect(page.getByTestId('custom-script-button')).toHaveText('Set Script');
      await page.getByTestId('custom-script-toolbar-group').hover();
      await expect(page.locator('#custom-script-tooltip')).toContainText('custom bash script');
      await expect(page.locator('#custom-script-tooltip')).toContainText('PATH');
      // Regression pin: Set Script sits beside Reset All Times, but hovering it
      // must not also activate Reset All Times' wrapper-owned tooltip hit area.
      await expect(page.locator('#reset-all-times-tooltip')).toHaveCount(0);

      await page.getByTestId('custom-script-button').click();
      await expect(page.getByTestId('custom-script-modal')).toBeVisible();
      await page.getByTestId('custom-script-name-input').fill('Run Hook');
      await page.getByTestId('custom-script-path-input').fill(scriptPath);
      await page.getByTestId('custom-script-save-run').click();

      await expect(page.getByTestId('custom-script-output-modal')).toBeVisible();
      await expect(page.getByTestId('custom-script-output-status')).toContainText('Exit 0');

      const stdout = page.getByTestId('custom-script-output-stdout');
      await expect(stdout).toContainText('CUSTOM_SCRIPT_OK');
      await expect(stdout).toContainText('SONG_TITLE=Script Runner');
      await expect(stdout).toContainText('PLAYBACK_FILE=Script Runner v1.wav');
      await expect(stdout).toContainText(`FOLDER_PATH=${directories.fixtureDirectory}`);
      await expect(stdout).toContainText('APP_VERSION=');
      await expect(stdout).toContainText('PATH_HAS_HOMEBREW=yes');
      await expect(stdout).toContainText(`CWD=${directories.fixtureDirectory}`);

      await page.getByTestId('custom-script-output-close').click();
      await expect(page.getByTestId('custom-script-button')).toContainText('Run Hook');

      await expect
        .poll(async () => {
          const userState = await page.evaluate(async () => {
            return (window as any).producerPlayer.getUserState();
          });
          return userState.customScript;
        })
        .toMatchObject({
          name: 'Run Hook',
          filePath: scriptPath,
        });
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
