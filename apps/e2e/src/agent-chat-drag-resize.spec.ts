import { test, expect, type Page } from '@playwright/test';
import { ENABLE_AGENT_FEATURES } from '@producer-player/contracts';
import {
  launchProducerPlayer,
  createE2ETestDirectories,
  cleanupE2ETestDirectories,
} from './helpers/electron-app';

/**
 * v3.25 — drag-to-move + drag-to-resize for the agent chat panel.
 *
 * These specs cover: moving the panel by its header, resizing via the
 * bottom-right corner, clamping the panel inside the viewport, double-
 * clicking the header to reset, and clamping to the minimum size when
 * the user tries to crush the panel smaller than 280x200.
 */

const BOUNDS_STORAGE_KEY = 'producer-player.agent-chat-bounds.v1';

async function openAgentPanel(page: Page): Promise<void> {
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await page.getByTestId('agent-panel-toggle').click();
  await expect(page.getByTestId('agent-chat-panel')).toHaveClass(
    /agent-chat-panel--open/
  );
  // The panel has a 0.2s transform transition from closed→open. The drag
  // tests measure the panel's bounding rect, and we need that measurement to
  // be post-transition (i.e. the panel should be at its resting position).
  // Poll getComputedStyle().transform until it matches the identity matrix.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const panel = document.querySelector(
            '[data-testid="agent-chat-panel"]'
          ) as HTMLElement | null;
          if (!panel) return null;
          return window.getComputedStyle(panel).transform;
        }),
      {
        timeout: 2000,
      }
    )
    .toMatch(/^(none|matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\))$/);
}

async function readStoredBounds(page: Page): Promise<{
  right: number;
  bottom: number;
  width: number;
  height: number;
} | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as {
        right: number;
        bottom: number;
        width: number;
        height: number;
      };
    } catch {
      return null;
    }
  }, BOUNDS_STORAGE_KEY);
}

async function getPanelRect(page: Page): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const panel = page.getByTestId('agent-chat-panel');
  const box = await panel.boundingBox();
  if (!box) throw new Error('Could not measure agent-chat-panel');
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

async function getViewport(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
}

function bottomRightOffsetsForRect(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number }
): { right: number; bottom: number } {
  return {
    right: viewport.width - rect.x - rect.width,
    bottom: viewport.height - rect.y - rect.height,
  };
}

async function pointerDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  // Use raw mouse events. Playwright's mouse API works on the Electron
  // BrowserWindow — we synthesize a primary-button drag that matches the
  // pointerdown/pointermove/pointerup sequence our React handlers listen for.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Two intermediate steps to feel like a real drag; some pointer trackers
  // need at least one move event between down + up.
  await page.mouse.move(
    from.x + (to.x - from.x) / 2,
    from.y + (to.y - from.y) / 2,
    { steps: 6 }
  );
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

test.describe('Agent Chat Panel drag + resize', () => {
  test.skip(!ENABLE_AGENT_FEATURES, 'agent features disabled');
  test.setTimeout(120_000);

  test('dragging the header moves the panel and persists position', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-drag-move');
    let firstRun: Awaited<ReturnType<typeof launchProducerPlayer>> | null = null;

    try {
      firstRun = await launchProducerPlayer(dirs.userDataDirectory);
      await openAgentPanel(firstRun.page);

      const startRect = await getPanelRect(firstRun.page);
      const headerBox = await firstRun.page
        .getByTestId('agent-panel-header')
        .boundingBox();
      if (!headerBox) throw new Error('no header box');

      // Drag from a "safe" spot in the header (title area, not buttons).
      const fromX = headerBox.x + Math.min(60, headerBox.width / 3);
      const fromY = headerBox.y + headerBox.height / 2;
      // Move up+left so the panel clearly leaves the bottom-right default.
      const toX = fromX - 180;
      const toY = fromY - 140;

      await pointerDrag(firstRun.page, { x: fromX, y: fromY }, { x: toX, y: toY });

      const movedRect = await getPanelRect(firstRun.page);
      expect(Math.abs(movedRect.x - (startRect.x - 180))).toBeLessThan(12);
      expect(Math.abs(movedRect.y - (startRect.y - 140))).toBeLessThan(12);
      expect(movedRect.width).toBeCloseTo(startRect.width, 0);
      expect(movedRect.height).toBeCloseTo(startRect.height, 0);

      const stored = await readStoredBounds(firstRun.page);
      expect(stored).not.toBeNull();
      const movedViewport = await getViewport(firstRun.page);
      const movedOffsets = bottomRightOffsetsForRect(movedRect, movedViewport);
      expect(stored!.right).toBeCloseTo(movedOffsets.right, 0);
      expect(stored!.bottom).toBeCloseTo(movedOffsets.bottom, 0);
      expect(stored!.width).toBeCloseTo(startRect.width, 0);
      expect(stored!.height).toBeCloseTo(startRect.height, 0);

      await firstRun.electronApp.close();
      firstRun = null;

      // Reload — bounds should restore.
      const secondRun = await launchProducerPlayer(dirs.userDataDirectory);
      try {
        await openAgentPanel(secondRun.page);
        const restoredRect = await getPanelRect(secondRun.page);
        expect(restoredRect.x).toBeCloseTo(movedRect.x, 0);
        expect(restoredRect.y).toBeCloseTo(movedRect.y, 0);
        expect(restoredRect.width).toBeCloseTo(movedRect.width, 0);
        expect(restoredRect.height).toBeCloseTo(movedRect.height, 0);
      } finally {
        await secondRun.electronApp.close();
      }
    } finally {
      if (firstRun) {
        await firstRun.electronApp.close();
      }
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('saved position stays anchored to bottom-right when the window resizes', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-resize-anchor');
    const { electronApp, page } = await launchProducerPlayer(
      dirs.userDataDirectory
    );

    try {
      await openAgentPanel(page);

      const headerBox = await page.getByTestId('agent-panel-header').boundingBox();
      if (!headerBox) throw new Error('no header box');

      const fromX = headerBox.x + Math.min(60, headerBox.width / 3);
      const fromY = headerBox.y + headerBox.height / 2;
      await pointerDrag(
        page,
        { x: fromX, y: fromY },
        { x: fromX - 180, y: fromY - 140 }
      );

      const movedRect = await getPanelRect(page);
      const stored = await readStoredBounds(page);
      expect(stored).not.toBeNull();

      const startViewport = await getViewport(page);
      const startOffsets = bottomRightOffsetsForRect(movedRect, startViewport);
      expect(stored!.right).toBeCloseTo(startOffsets.right, 0);
      expect(stored!.bottom).toBeCloseTo(startOffsets.bottom, 0);

      const smallerViewport = {
        width: Math.max(
          Math.ceil(stored!.right + movedRect.width + 40),
          startViewport.width - 160
        ),
        height: Math.max(
          Math.ceil(stored!.bottom + movedRect.height + 40),
          startViewport.height - 120
        ),
      };
      await page.setViewportSize(smallerViewport);
      await expect.poll(() => getViewport(page)).toEqual(smallerViewport);

      const resizedRect = await getPanelRect(page);
      const resizedOffsets = bottomRightOffsetsForRect(
        resizedRect,
        smallerViewport
      );
      expect(resizedOffsets.right).toBeCloseTo(stored!.right, 0);
      expect(resizedOffsets.bottom).toBeCloseTo(stored!.bottom, 0);
      expect(resizedRect.width).toBeCloseTo(movedRect.width, 0);
      expect(resizedRect.height).toBeCloseTo(movedRect.height, 0);

      const storedAfterResize = await readStoredBounds(page);
      expect(storedAfterResize!.right).toBeCloseTo(stored!.right, 0);
      expect(storedAfterResize!.bottom).toBeCloseTo(stored!.bottom, 0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('dragging the bottom-right corner resizes and persists size', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-resize');
    let firstRun: Awaited<ReturnType<typeof launchProducerPlayer>> | null = null;

    try {
      firstRun = await launchProducerPlayer(dirs.userDataDirectory);
      await openAgentPanel(firstRun.page);

      const startRect = await getPanelRect(firstRun.page);
      const handle = firstRun.page.getByTestId(
        'agent-resize-handle-bottom-right'
      );
      const handleBox = await handle.boundingBox();
      if (!handleBox) throw new Error('no resize handle box');

      const fromX = handleBox.x + handleBox.width / 2;
      const fromY = handleBox.y + handleBox.height / 2;
      // Grow the panel 120px wider + 80px taller.
      const toX = fromX + 120;
      const toY = fromY + 80;

      await pointerDrag(firstRun.page, { x: fromX, y: fromY }, { x: toX, y: toY });

      const resizedRect = await getPanelRect(firstRun.page);
      expect(resizedRect.width).toBeGreaterThan(startRect.width + 80);
      expect(resizedRect.height).toBeGreaterThan(startRect.height + 40);

      const stored = await readStoredBounds(firstRun.page);
      expect(stored).not.toBeNull();
      expect(stored!.width).toBeCloseTo(resizedRect.width, 0);
      expect(stored!.height).toBeCloseTo(resizedRect.height, 0);

      await firstRun.electronApp.close();
      firstRun = null;

      const secondRun = await launchProducerPlayer(dirs.userDataDirectory);
      try {
        await openAgentPanel(secondRun.page);
        const restoredRect = await getPanelRect(secondRun.page);
        expect(restoredRect.width).toBeCloseTo(resizedRect.width, 0);
        expect(restoredRect.height).toBeCloseTo(resizedRect.height, 0);
      } finally {
        await secondRun.electronApp.close();
      }
    } finally {
      if (firstRun) {
        await firstRun.electronApp.close();
      }
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('dragging past the viewport edge clamps instead of leaving the screen', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-drag-clamp');
    const { electronApp, page } = await launchProducerPlayer(
      dirs.userDataDirectory
    );

    try {
      await openAgentPanel(page);

      const viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));

      const headerBox = await page.getByTestId('agent-panel-header').boundingBox();
      if (!headerBox) throw new Error('no header box');

      const fromX = headerBox.x + 40;
      const fromY = headerBox.y + headerBox.height / 2;
      // Aim way off-screen top-left; clamp should pin the panel to 0,0.
      await pointerDrag(
        page,
        { x: fromX, y: fromY },
        { x: -500, y: -500 }
      );

      const rect = await getPanelRect(page);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x).toBeLessThan(5);
      expect(rect.y).toBeLessThan(5);
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('double-clicking the header resets to default bounds', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-dblclick-reset');
    const { electronApp, page } = await launchProducerPlayer(
      dirs.userDataDirectory
    );

    try {
      await openAgentPanel(page);

      // Prime the panel with legacy top-left bounds via localStorage + reload.
      await page.evaluate((key) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({ x: 80, y: 80, width: 420, height: 540 })
        );
      }, BOUNDS_STORAGE_KEY);
      await page.reload();
      await openAgentPanel(page);

      const movedRect = await getPanelRect(page);
      expect(movedRect.x).toBeCloseTo(80, 0);
      expect(movedRect.y).toBeCloseTo(80, 0);
      await expect
        .poll(async () => {
          const bounds = await readStoredBounds(page);
          return (
            typeof bounds?.right === 'number' &&
            typeof bounds?.bottom === 'number'
          );
        })
        .toBe(true);
      const migratedBounds = (await readStoredBounds(page))!;
      const viewport = await getViewport(page);
      const migratedOffsets = bottomRightOffsetsForRect(movedRect, viewport);
      expect(migratedBounds.right).toBeCloseTo(migratedOffsets.right, 0);
      expect(migratedBounds.bottom).toBeCloseTo(migratedOffsets.bottom, 0);

      const headerBox = await page.getByTestId('agent-panel-header').boundingBox();
      if (!headerBox) throw new Error('no header box');

      // Double-click on a non-button area of the header (title zone).
      await page.mouse.dblclick(
        headerBox.x + Math.min(60, headerBox.width / 3),
        headerBox.y + headerBox.height / 2
      );

      // Storage should be cleared, and the panel should be back in
      // bottom-right default position (not 80,80 anymore).
      await expect
        .poll(async () => readStoredBounds(page))
        .toBeNull();

      const resetRect = await getPanelRect(page);
      expect(resetRect.x).not.toBeCloseTo(80, 0);
      expect(resetRect.y).not.toBeCloseTo(80, 0);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });

  test('resizing below minimum clamps at 280x200', async () => {
    const dirs = await createE2ETestDirectories('agent-panel-resize-min');
    const { electronApp, page } = await launchProducerPlayer(
      dirs.userDataDirectory
    );

    try {
      await openAgentPanel(page);

      const handle = page.getByTestId('agent-resize-handle-bottom-right');
      const handleBox = await handle.boundingBox();
      if (!handleBox) throw new Error('no handle box');

      const fromX = handleBox.x + handleBox.width / 2;
      const fromY = handleBox.y + handleBox.height / 2;

      // Try to crush way below the minimum.
      await pointerDrag(
        page,
        { x: fromX, y: fromY },
        { x: fromX - 800, y: fromY - 800 }
      );

      const rect = await getPanelRect(page);
      // Panel must not drop below 280x200.
      expect(rect.width).toBeGreaterThanOrEqual(279);
      expect(rect.height).toBeGreaterThanOrEqual(199);
      expect(rect.width).toBeLessThan(300);
      expect(rect.height).toBeLessThan(230);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(dirs);
    }
  });
});
