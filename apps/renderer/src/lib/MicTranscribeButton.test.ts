/**
 * v3.246 — Regression contract tests for the MicTranscribeButton focus
 * bug Ethan reported in v3.245 (voice 3674).
 *
 * The per-item checklist mic (`.checklist-mic-button--item`) is hidden by
 * default and revealed via `.checklist-item-row:focus-within`. The bug:
 * clicking the mic flipped the button to native `disabled` (because the
 * hook's `clickable` flag became false during the `arming` / `processing`
 * transient states), the browser blurred the disabled focused button,
 * `:focus-within` dropped off the row, and the mic hid mid-recording.
 *
 * These tests enforce the structural invariants of the fix so it can't
 * silently regress:
 *  1. MicTranscribeButton must NOT bind native `disabled` to `mic.clickable`.
 *  2. MicTranscribeButton must still gate clicks via `mic.clickable`.
 *  3. styles.css must keep the item mic visible during any non-idle state
 *     (arming / recording / processing / error) via the data-mic-state
 *     attribute selectors, independent of :focus-within.
 */

import { describe, expect, it } from 'vitest';

// @ts-ignore -- renderer tsconfig intentionally excludes Node ambient types.
const { readFileSync } = await import('node:fs');

const buttonSource = readFileSync(
  new URL('./MicTranscribeButton.tsx', import.meta.url),
  'utf8'
) as string;

const stylesSource = readFileSync(
  new URL('../styles.css', import.meta.url),
  'utf8'
) as string;

describe('MicTranscribeButton — focus regression (v3.246, voice 3674)', () => {
  it('must NOT bind native `disabled` to `mic.clickable` (would blur the button and drop :focus-within)', () => {
    // The bug pattern: `disabled={!mic.clickable}`. Any variant of this
    // re-introduces the regression.
    expect(buttonSource).not.toMatch(/disabled=\{\s*!\s*mic\.clickable\s*\}/);
    expect(buttonSource).not.toMatch(/disabled=\{\s*!mic\.clickable\s*\}/);
  });

  it('must still gate the click via `mic.clickable` so we do not double-fire toggle()', () => {
    // The handler should bail out when mic is not clickable. Pattern:
    // `if (!mic.clickable) return;` — anything that checks `mic.clickable`
    // before invoking `mic.toggle()` is acceptable.
    const handlerGatesClick =
      /if\s*\(\s*!\s*mic\.clickable\s*\)\s*return/.test(buttonSource) ||
      /mic\.clickable\s*&&\s*mic\.toggle/.test(buttonSource) ||
      /mic\.clickable\s*\?\s*[^:]*mic\.toggle/.test(buttonSource);
    expect(handlerGatesClick).toBe(true);
  });

  it('must expose busy state to assistive tech via aria-disabled', () => {
    expect(buttonSource).toMatch(/aria-disabled=/);
  });

  it('must continue passing through the parent `disabled` prop to the hook', () => {
    // The hook's `disabled` argument is what stops recording from starting
    // when the parent input is itself disabled. Removing this would break
    // that behaviour.
    expect(buttonSource).toMatch(/useMicTranscribe\(\s*\{\s*onTranscript,\s*onError,\s*disabled\s*\}\s*\)/);
  });
});

describe('styles.css — item mic visibility during non-idle states (v3.246)', () => {
  it('keeps the item mic visible while arming', () => {
    expect(stylesSource).toMatch(
      /\.checklist-mic-button--item\.agent-mic-button\[data-mic-state="arming"\]/
    );
  });

  it('keeps the item mic visible while recording', () => {
    expect(stylesSource).toMatch(
      /\.checklist-mic-button--item\.agent-mic-button\[data-mic-state="recording"\]/
    );
  });

  it('keeps the item mic visible while processing', () => {
    expect(stylesSource).toMatch(
      /\.checklist-mic-button--item\.agent-mic-button\[data-mic-state="processing"\]/
    );
  });

  it('keeps the item mic visible while showing the error flash', () => {
    expect(stylesSource).toMatch(
      /\.checklist-mic-button--item\.agent-mic-button\[data-mic-state="error"\]/
    );
  });

  it('still hides the item mic in the default (idle, not focus-within) state', () => {
    // The base rule that hides the item mic by default must still exist.
    // We grep for the opacity:0 / pointer-events:none block on the base
    // selector (without :focus-within / data-mic-state).
    expect(stylesSource).toMatch(
      /\.checklist-mic-button--item\.agent-mic-button\s*\{[^}]*opacity:\s*0[^}]*pointer-events:\s*none/
    );
  });

  it('still reveals the item mic on :focus-within (untouched legacy behaviour)', () => {
    expect(stylesSource).toMatch(
      /\.checklist-item-row:focus-within\s+\.checklist-mic-button--item\.agent-mic-button\s*\{[^}]*opacity:\s*1/
    );
  });
});
