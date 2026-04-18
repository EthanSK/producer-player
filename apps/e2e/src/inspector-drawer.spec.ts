import { test, expect } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

// v3.20: The right-hand inspector pane collapses into a slide-in drawer at
// narrow viewport widths. The toggle button sits next to the Agent Chat
// Trigger. These specs exercise the full drawer lifecycle:
//   1. narrow width → inline inspector hidden, toggle button visible
//   2. toggle opens/closes the drawer
//   3. Escape closes an open drawer
//   4. resizing back to wide width surfaces the inline inspector + hides toggle
//   5. open-state survives reload
//
// The breakpoint is INSPECTOR_DRAWER_BREAKPOINT_PX = 1120 in App.tsx / 1120px
// @media in styles.css.
const NARROW_WIDTH = 760;
const NARROW_HEIGHT = 900;
const WIDE_WIDTH = 1280;
const WIDE_HEIGHT = 900;

async function setWindowContentSize(
  electronApp: Awaited<ReturnType<typeof launchProducerPlayer>>['electronApp'],
  width: number,
  height: number
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    // setContentSize drives the inner HTML dimensions, which is what
    // window.innerWidth / the CSS @media queries key off of.
    window.setContentSize(size.width, size.height);
  }, { width, height });
}

// Suppress the first-launch auto-open of the Agent Chat Panel (which would
// otherwise cover the bottom-right corner of the viewport and intercept
// clicks on the inspector-toggle button). We do this by setting the same
// localStorage flag the panel itself writes after its first appearance, then
// reloading so the panel initializes with that flag in scope.
async function suppressAgentPanelOnboarding(
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

test.describe('Inspector drawer (v3.20)', () => {
  test('collapses into a drawer at narrow widths and opens on toggle', async () => {
    const dirs = await createE2ETestDirectories('inspector-drawer-collapse');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await suppressAgentPanelOnboarding(page);
      await setWindowContentSize(electronApp, NARROW_WIDTH, NARROW_HEIGHT);

      // Let the resize propagate to the renderer.
      await expect
        .poll(async () => page.evaluate(() => window.innerWidth))
        .toBeLessThanOrEqual(NARROW_WIDTH + 4);

      const toggle = page.getByTestId('inspector-toggle');
      const drawer = page.getByTestId('inspector-drawer');

      await expect(toggle).toBeVisible();

      // Drawer is in the DOM but off-screen (transform: translateX). We key
      // off the data attribute so we test the logical state, not the pixel
      // animation.
      await expect(drawer).toHaveAttribute('data-inspector-drawer-open', 'false');

      // A11y: while the drawer is closed at narrow widths it must be inert
      // and aria-hidden so focus can't land on off-screen controls.
      await expect(drawer).toHaveAttribute('inert', '');
      await expect(drawer).toHaveAttribute('aria-hidden', 'true');

      await toggle.click();
      await expect(drawer).toHaveAttribute('data-inspector-drawer-open', 'true');
      await expect(page.getByTestId('inspector-drawer-backdrop')).toBeVisible();

      // Inspector content should be reachable.
      await expect(page.getByTestId('inspector-scroll-region')).toBeVisible();

      await toggle.click();
      await expect(drawer).toHaveAttribute('data-inspector-drawer-open', 'false');
      await expect(page.getByTestId('inspector-drawer-backdrop')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('Escape key closes an open drawer', async () => {
    const dirs = await createE2ETestDirectories('inspector-drawer-escape');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await suppressAgentPanelOnboarding(page);
      await setWindowContentSize(electronApp, NARROW_WIDTH, NARROW_HEIGHT);
      await expect
        .poll(async () => page.evaluate(() => window.innerWidth))
        .toBeLessThanOrEqual(NARROW_WIDTH + 4);

      const toggle = page.getByTestId('inspector-toggle');
      const drawer = page.getByTestId('inspector-drawer');

      await toggle.click();
      await expect(drawer).toHaveAttribute('data-inspector-drawer-open', 'true');

      await page.keyboard.press('Escape');
      await expect(drawer).toHaveAttribute('data-inspector-drawer-open', 'false');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('wide viewport shows inline inspector and hides the toggle', async () => {
    const dirs = await createE2ETestDirectories('inspector-drawer-wide');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      // Start narrow to prove the toggle was visible, then expand.
      await setWindowContentSize(electronApp, NARROW_WIDTH, NARROW_HEIGHT);
      await expect
        .poll(async () => page.evaluate(() => window.innerWidth))
        .toBeLessThanOrEqual(NARROW_WIDTH + 4);

      const toggle = page.getByTestId('inspector-toggle');
      await expect(toggle).toBeVisible();

      await setWindowContentSize(electronApp, WIDE_WIDTH, WIDE_HEIGHT);
      await expect
        .poll(async () => page.evaluate(() => window.innerWidth))
        .toBeGreaterThanOrEqual(WIDE_WIDTH - 4);

      // At wide widths the toggle is display:none via the @media query.
      await expect(toggle).toBeHidden();

      // Inline inspector content is present and visible — the `.panel-right`
      // container lives in the app-shell grid's third column.
      await expect(page.getByTestId('inspector-scroll-region')).toBeVisible();
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('drawer open-state persists across reload', async () => {
    const dirs = await createE2ETestDirectories('inspector-drawer-persist');
    const { electronApp, page } = await launchProducerPlayer(dirs.userDataDirectory);

    try {
      await suppressAgentPanelOnboarding(page);
      await setWindowContentSize(electronApp, NARROW_WIDTH, NARROW_HEIGHT);
      await expect
        .poll(async () => page.evaluate(() => window.innerWidth))
        .toBeLessThanOrEqual(NARROW_WIDTH + 4);

      await page.getByTestId('inspector-toggle').click();
      await expect(page.getByTestId('inspector-drawer')).toHaveAttribute(
        'data-inspector-drawer-open',
        'true'
      );

      // Wait for the localStorage write to land before reloading. The write
      // happens synchronously in a useEffect, so a round-trip to the renderer
      // is sufficient.
      await expect
        .poll(async () =>
          page.evaluate(() =>
            window.localStorage.getItem('producer-player.inspector-drawer-open.v1')
          )
        )
        .toBe('true');

      await page.reload();
      await page.waitForSelector('[data-testid="app-shell"]');
      // Make sure we're still at narrow width after reload.
      await setWindowContentSize(electronApp, NARROW_WIDTH, NARROW_HEIGHT);
      await expect
        .poll(async () => page.evaluate(() => window.innerWidth))
        .toBeLessThanOrEqual(NARROW_WIDTH + 4);

      await expect(page.getByTestId('inspector-drawer')).toHaveAttribute(
        'data-inspector-drawer-open',
        'true'
      );
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });
});
