/**
 * Regression: bug fix 2026-04-18 (v3.18)
 *
 * UX rule: pressing Enter in a text-ish <input> should BLUR the input
 * so its existing onBlur save handler commits the value. Textareas are
 * deliberately excluded — Enter must still behave normally there. If
 * an input already handles Enter itself (e.g. listening-device-input),
 * it calls `event.preventDefault()` and the global blur handler stays
 * out of its way.
 *
 * Scenarios covered:
 *   A. Plain text input — Enter blurs it (and onBlur save fires).
 *   B. Number input — Enter blurs it (and onBlur save fires), value
 *      still present.
 *   C. Textarea — Enter does NOT blur it, newline IS inserted.
 *   D. Input with its own preventDefault Enter handler (the listening-
 *      device-input in the checklist modal) — its handler runs, the
 *      input stays focused, and the global blur handler does NOT fire.
 *
 * Implementation: global window-level bubble-phase keydown listener in
 * apps/renderer/src/App.tsx (added right after the Space handler).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
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
        producerPlayer: { linkFolder: (p: string) => Promise<unknown> };
      }
    ).producerPlayer.linkFolder(folderPath);
  }, fixtureDirectory);
}

interface InjectedHarness {
  containerTestId: string;
  textInputTestId: string;
  numberInputTestId: string;
  textareaTestId: string;
  textBlurredFlag: string;
  numberBlurredFlag: string;
  textareaBlurredFlag: string;
  textSavedValueAttr: string;
  numberSavedValueAttr: string;
}

async function injectSyntheticInputs(page: Page): Promise<InjectedHarness> {
  const harness: InjectedHarness = {
    containerTestId: 'enter-blur-harness',
    textInputTestId: 'enter-blur-text-input',
    numberInputTestId: 'enter-blur-number-input',
    textareaTestId: 'enter-blur-textarea',
    textBlurredFlag: 'enter-blur-text-blurred',
    numberBlurredFlag: 'enter-blur-number-blurred',
    textareaBlurredFlag: 'enter-blur-textarea-blurred',
    textSavedValueAttr: 'data-saved-text',
    numberSavedValueAttr: 'data-saved-number',
  };

  await page.evaluate((h) => {
    const doc = window.document;
    const existing = doc.querySelector(`[data-testid="${h.containerTestId}"]`);
    if (existing) existing.remove();

    const container = doc.createElement('div');
    container.dataset.testid = h.containerTestId;
    container.setAttribute('data-testid', h.containerTestId);
    container.style.position = 'fixed';
    container.style.top = '8px';
    container.style.left = '8px';
    container.style.zIndex = '99999';
    container.style.background = 'rgba(0,0,0,0.85)';
    container.style.padding = '12px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';

    const textInput = doc.createElement('input');
    textInput.type = 'text';
    textInput.setAttribute('data-testid', h.textInputTestId);
    textInput.addEventListener('blur', () => {
      container.setAttribute(h.textSavedValueAttr, textInput.value);
      container.setAttribute('data-' + h.textBlurredFlag, 'true');
    });
    container.appendChild(textInput);

    const numberInput = doc.createElement('input');
    numberInput.type = 'number';
    numberInput.setAttribute('data-testid', h.numberInputTestId);
    numberInput.addEventListener('blur', () => {
      container.setAttribute(h.numberSavedValueAttr, numberInput.value);
      container.setAttribute('data-' + h.numberBlurredFlag, 'true');
    });
    container.appendChild(numberInput);

    const textarea = doc.createElement('textarea');
    textarea.setAttribute('data-testid', h.textareaTestId);
    textarea.addEventListener('blur', () => {
      container.setAttribute('data-' + h.textareaBlurredFlag, 'true');
    });
    container.appendChild(textarea);

    doc.body.appendChild(container);
  }, harness);

  return harness;
}

async function activeElementTestId(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid') ?? null
  );
}

test.describe('Enter blurs text and number inputs (textareas excluded)', () => {
  test('A: text input — Enter blurs and triggers onBlur save', async () => {
    const directories = await createE2ETestDirectories('producer-player-enter-blur-text');

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      const harness = await injectSyntheticInputs(page);

      const textInput = page.getByTestId(harness.textInputTestId);
      const container = page.getByTestId(harness.containerTestId);

      await textInput.focus();
      await expect.poll(() => activeElementTestId(page)).toBe(harness.textInputTestId);

      await page.keyboard.type('hello producer');

      // Sanity: pre-blur no save attribute yet.
      await expect(container).not.toHaveAttribute('data-' + harness.textBlurredFlag, 'true');

      await page.keyboard.press('Enter');

      // Input must lose focus.
      await expect.poll(() => activeElementTestId(page)).not.toBe(harness.textInputTestId);
      // onBlur save must have fired with the typed value.
      await expect(container).toHaveAttribute('data-' + harness.textBlurredFlag, 'true');
      await expect(container).toHaveAttribute(harness.textSavedValueAttr, 'hello producer');
      // The value is still in the input (blur does not clear it).
      await expect(textInput).toHaveValue('hello producer');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('B: number input — Enter blurs and triggers onBlur save', async () => {
    const directories = await createE2ETestDirectories('producer-player-enter-blur-number');

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      const harness = await injectSyntheticInputs(page);

      const numberInput = page.getByTestId(harness.numberInputTestId);
      const container = page.getByTestId(harness.containerTestId);

      await numberInput.focus();
      await expect.poll(() => activeElementTestId(page)).toBe(harness.numberInputTestId);

      await page.keyboard.type('42');

      await expect(container).not.toHaveAttribute('data-' + harness.numberBlurredFlag, 'true');

      await page.keyboard.press('Enter');

      await expect.poll(() => activeElementTestId(page)).not.toBe(harness.numberInputTestId);
      await expect(container).toHaveAttribute('data-' + harness.numberBlurredFlag, 'true');
      await expect(container).toHaveAttribute(harness.numberSavedValueAttr, '42');
      await expect(numberInput).toHaveValue('42');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('C: textarea — Enter keeps focus and inserts a newline', async () => {
    const directories = await createE2ETestDirectories('producer-player-enter-blur-textarea');

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      const harness = await injectSyntheticInputs(page);

      const textarea = page.getByTestId(harness.textareaTestId);
      const container = page.getByTestId(harness.containerTestId);

      await textarea.focus();
      await expect.poll(() => activeElementTestId(page)).toBe(harness.textareaTestId);

      await page.keyboard.type('line one');
      await page.keyboard.press('Enter');
      await page.keyboard.type('line two');

      // Focus must REMAIN on the textarea.
      await expect.poll(() => activeElementTestId(page)).toBe(harness.textareaTestId);
      // The textarea must contain an actual newline (Enter inserted it).
      await expect(textarea).toHaveValue('line one\nline two');
      // onBlur must NOT have fired.
      await expect(container).not.toHaveAttribute('data-' + harness.textareaBlurredFlag, 'true');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });

  test('D: input with its own preventDefault Enter handler — handler runs, input stays focused', async () => {
    const directories = await createE2ETestDirectories('producer-player-enter-blur-own-handler');

    await writeFixtureFiles(directories.fixtureDirectory, [
      {
        relativePath: 'Track A v1.wav',
        modifiedAtMs: Date.parse('2026-01-01T00:00:10.000Z'),
      },
    ]);

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(1);

      await page.getByTestId('song-checklist-button').click();
      await expect(page.getByTestId('song-checklist-modal')).toBeVisible();

      const listeningDeviceInput = page.getByTestId('listening-device-input');
      await expect(listeningDeviceInput).toBeVisible();
      await listeningDeviceInput.focus();
      await expect.poll(() => activeElementTestId(page)).toBe('listening-device-input');

      await listeningDeviceInput.fill('AirPods Pro');
      await page.keyboard.press('Enter');

      // The handler's own effect: a new chip appears for the device.
      const chipRow = page.getByTestId('listening-device-chip-row');
      await expect(chipRow).toBeVisible();
      await expect(chipRow).toContainText('AirPods Pro');

      // The input should have been cleared by the handler (its own
      // behavior), not the global one. Importantly it should STILL be
      // focused: the global blur handler must have stayed out because
      // the per-input handler called preventDefault.
      await expect(listeningDeviceInput).toHaveValue('');
      await expect.poll(() => activeElementTestId(page)).toBe('listening-device-input');
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
