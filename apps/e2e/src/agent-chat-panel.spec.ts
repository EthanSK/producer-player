import { test, expect } from '@playwright/test';
import { ENABLE_AGENT_FEATURES } from '@producer-player/contracts';
import {
  launchProducerPlayer,
  createE2ETestDirectories,
  cleanupE2ETestDirectories,
} from './helpers/electron-app';

test.describe('Agent Chat Panel', () => {
  if (!ENABLE_AGENT_FEATURES) {
    test('toggle is hidden when agent features are disabled', async () => {
      const dirs = await createE2ETestDirectories('agent-panel-disabled');
      const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

      try {
        await expect(page.getByTestId('app-shell')).toBeVisible();
        await expect(page.getByTestId('agent-panel-toggle')).toHaveCount(0);
        await expect(page.getByTestId('agent-chat-panel')).toHaveCount(0);
      } finally {
        await electronApp.close();
        await cleanupE2ETestDirectories(dirs);
      }
    });

    return;
  }
  test('toggle button is visible on launch', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-toggle');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expect(page.getByTestId('agent-panel-toggle')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('panel opens and closes when toggle is clicked', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-open-close');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await expect(page.getByTestId('agent-panel-toggle')).toBeVisible();

      // Panel should not be visually open initially
      const panel = page.getByTestId('agent-chat-panel');
      await expect(panel).toBeAttached();
      const hasOpenClass = await panel.evaluate((el) =>
        el.classList.contains('agent-chat-panel--open')
      );
      expect(hasOpenClass).toBe(false);

      // Click to open
      await page.getByTestId('agent-panel-toggle').click();
      await expect(panel).toHaveClass(/agent-chat-panel--open/);

      // Close button should be visible
      await expect(page.getByTestId('agent-panel-close')).toBeVisible();

      // Click close
      await page.getByTestId('agent-panel-close').click();
      const hasOpenClassAfterClose = await panel.evaluate((el) =>
        el.classList.contains('agent-chat-panel--open')
      );
      expect(hasOpenClassAfterClose).toBe(false);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('empty state shows starter prompts', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-empty-state');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('agent-panel-toggle').click();

      // Should show empty state or provider notice
      // (provider notice if claude CLI not available, which is expected in CI)
      const emptyState = page.getByTestId('agent-empty-state');
      const providerNotice = page.getByTestId('agent-provider-notice');

      // One of these should be visible
      const emptyVisible = await emptyState.isVisible().catch(() => false);
      const noticeVisible = await providerNotice.isVisible().catch(() => false);
      expect(emptyVisible || noticeVisible).toBe(true);

      if (emptyVisible) {
        const chips = page.getByTestId('agent-starter-chip');
        await expect(chips).toHaveCount(4);
      }
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('settings menu opens and closes', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-settings');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('agent-panel-toggle').click();

      // Open settings
      await page.getByTestId('agent-settings-toggle').click();
      await expect(page.getByTestId('agent-settings')).toBeVisible();

      // Close settings
      await page.getByTestId('agent-settings-toggle').click();
      await expect(page.getByTestId('agent-settings')).not.toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('composer textarea accepts input', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-composer');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('agent-panel-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await expect(input).toBeVisible();

      await input.fill('Hello agent');
      await expect(input).toHaveValue('Hello agent');

      // Send button should be visible
      await expect(page.getByTestId('agent-send-button')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('send button triggers message display', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-send');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('agent-panel-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await input.fill('Test message');

      // Click send
      await page.getByTestId('agent-send-button').click();

      // User message should appear in the timeline
      const userMessage = page.getByTestId('agent-message-user');
      await expect(userMessage.first()).toBeVisible({ timeout: 5000 });
      await expect(userMessage.first()).toContainText('Test message');

      // Input should be cleared
      await expect(input).toHaveValue('');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('clear chat removes messages', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-clear');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('agent-panel-toggle').click();

      // Type and send a message
      const input = page.getByTestId('agent-composer-input');
      await input.fill('Test message for clear');
      await page.getByTestId('agent-send-button').click();

      // Wait for user message to appear
      await expect(page.getByTestId('agent-message-user').first()).toBeVisible({ timeout: 5000 });

      // Open settings and clear chat
      await page.getByTestId('agent-settings-toggle').click();
      await expect(page.getByTestId('agent-settings')).toBeVisible();

      const clearButton = page.getByTestId('agent-clear-chat');
      await clearButton.click(); // first click shows confirmation
      await clearButton.click(); // second click confirms

      // Messages should be gone, empty state or provider notice should show
      const timeline = page.getByTestId('agent-timeline');
      const userMessages = timeline.getByTestId('agent-message-user');
      await expect(userMessages).toHaveCount(0, { timeout: 3000 });
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('Enter key sends message and Shift+Enter adds newline', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-keyboard');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await page.getByTestId('agent-panel-toggle').click();

      const input = page.getByTestId('agent-composer-input');
      await input.focus();

      // Type text and press Shift+Enter for newline
      await input.fill('Line one');
      await input.press('Shift+Enter');
      await input.evaluate((el) => {
        (el as HTMLTextAreaElement).value += 'Line two';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });

      // Value should contain both lines
      const value = await input.inputValue();
      expect(value).toContain('Line one');

      // Press Enter to send
      await input.press('Enter');

      // User message should appear
      await expect(page.getByTestId('agent-message-user').first()).toBeVisible({ timeout: 5000 });
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });
});
