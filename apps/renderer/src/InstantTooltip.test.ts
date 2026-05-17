/**
 * v3.231 — unit tests for the InstantTooltip viewport-edge auto-flip
 * helper. The bug: top-bar tooltips (branding card, Add Folder,
 * album-area toolbar) sit near the top of the viewport with no room
 * above their default `top-end` placement, so Chromium clips the
 * popover. `decideTooltipPlacement` is the pure decision function that
 * picks the placement that will actually fit.
 *
 * v3.232 — add coverage for `computeTooltipAnchor` (the second pure
 * helper introduced when we moved the popover into a React Portal) and
 * source-contract checks for the portal wiring. The portal/runtime
 * behaviour itself is covered by the Mini spot-checks; here we lock in
 * the pure math + the fact that the source uses `createPortal` against
 * `document.body` and a `position: fixed` layout (so an accidental
 * refactor back to `position: absolute` against the host would fail
 * locally before getting near a release).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeTooltipAnchor,
  decideTooltipPlacement,
  INSTANT_TOOLTIP_ESTIMATED_HEIGHT,
  INSTANT_TOOLTIP_HOST_GAP,
} from './InstantTooltip';

const componentSource = readFileSync(
  new URL('./InstantTooltip.tsx', import.meta.url),
  'utf8',
) as string;
const stylesSource = readFileSync(
  new URL('./styles.css', import.meta.url),
  'utf8',
) as string;

const VIEWPORT = 900;

describe('decideTooltipPlacement', () => {
  it('keeps the default top-end when there is plenty of room above', () => {
    expect(
      decideTooltipPlacement(
        /* hostTop */ 600,
        /* hostBottom */ 632,
        VIEWPORT,
        'top-end',
      ),
    ).toBe('top-end');
  });

  it('flips top-end to bottom-end when the host hugs the viewport top', () => {
    // Branding card scenario — hostTop ≈ 12px, no room above.
    expect(
      decideTooltipPlacement(12, 60, VIEWPORT, 'top-end'),
    ).toBe('bottom-end');
  });

  it('flips top-start to bottom-start when the host hugs the viewport top', () => {
    expect(
      decideTooltipPlacement(8, 40, VIEWPORT, 'top-start'),
    ).toBe('bottom-start');
  });

  it('keeps the default bottom-end when there is plenty of room below', () => {
    expect(
      decideTooltipPlacement(100, 132, VIEWPORT, 'bottom-end'),
    ).toBe('bottom-end');
  });

  it('flips bottom-end to top-end when the host hugs the viewport bottom', () => {
    // Footer/status-bar scenario — hostBottom ≈ viewport, no room below.
    expect(
      decideTooltipPlacement(VIEWPORT - 40, VIEWPORT - 8, VIEWPORT, 'bottom-end'),
    ).toBe('top-end');
  });

  it('keeps top-end when room is exactly at the threshold', () => {
    expect(
      decideTooltipPlacement(
        INSTANT_TOOLTIP_ESTIMATED_HEIGHT,
        INSTANT_TOOLTIP_ESTIMATED_HEIGHT + 32,
        VIEWPORT,
        'top-end',
      ),
    ).toBe('top-end');
  });

  it('flips when above is one pixel short of the threshold', () => {
    expect(
      decideTooltipPlacement(
        INSTANT_TOOLTIP_ESTIMATED_HEIGHT - 1,
        INSTANT_TOOLTIP_ESTIMATED_HEIGHT + 31,
        VIEWPORT,
        'top-end',
      ),
    ).toBe('bottom-end');
  });

  it('picks the side with more room when neither side fits the estimate', () => {
    // Tiny viewport, host pinned dead-centre — both sides ~ 50px each,
    // neither fits the 120px estimate. Slightly more room above: stay
    // with the top-* default.
    expect(
      decideTooltipPlacement(60, 110, /* viewportHeight */ 160, 'top-end'),
    ).toBe('top-end');

    // Mirror case: more room below — flip to bottom-*.
    expect(
      decideTooltipPlacement(40, 90, /* viewportHeight */ 160, 'top-end'),
    ).toBe('bottom-end');
  });

  it('honours an explicit popoverHeight override', () => {
    // Tall popover (e.g. one with a label) — 200px estimate.
    // Host sits 150px from top of a 900px viewport: room above < 200
    // → flip.
    expect(
      decideTooltipPlacement(150, 182, VIEWPORT, 'top-end', 200),
    ).toBe('bottom-end');

    // Same host, smaller estimated popover — fits above without flip.
    expect(
      decideTooltipPlacement(150, 182, VIEWPORT, 'top-end', 80),
    ).toBe('top-end');
  });

  it('preserves the horizontal axis (start vs end) when flipping', () => {
    // -start → -start, -end → -end. Bug guard: an earlier draft of
    // the helper was sloppy with the suffix split.
    expect(
      decideTooltipPlacement(10, 42, VIEWPORT, 'top-start'),
    ).toBe('bottom-start');
    expect(
      decideTooltipPlacement(10, 42, VIEWPORT, 'top-end'),
    ).toBe('bottom-end');
    expect(
      decideTooltipPlacement(VIEWPORT - 20, VIEWPORT - 4, VIEWPORT, 'bottom-start'),
    ).toBe('top-start');
    expect(
      decideTooltipPlacement(VIEWPORT - 20, VIEWPORT - 4, VIEWPORT, 'bottom-end'),
    ).toBe('top-end');
  });
});

describe('computeTooltipAnchor', () => {
  const HOST = { top: 200, bottom: 232, left: 400, right: 480 };

  it('top-end → y is host top - gap, x is host right', () => {
    expect(computeTooltipAnchor(HOST, 'top-end')).toEqual({
      y: 200 - INSTANT_TOOLTIP_HOST_GAP,
      x: 480,
    });
  });

  it('top-start → y is host top - gap, x is host left', () => {
    expect(computeTooltipAnchor(HOST, 'top-start')).toEqual({
      y: 200 - INSTANT_TOOLTIP_HOST_GAP,
      x: 400,
    });
  });

  it('bottom-end → y is host bottom + gap, x is host right', () => {
    expect(computeTooltipAnchor(HOST, 'bottom-end')).toEqual({
      y: 232 + INSTANT_TOOLTIP_HOST_GAP,
      x: 480,
    });
  });

  it('bottom-start → y is host bottom + gap, x is host left', () => {
    expect(computeTooltipAnchor(HOST, 'bottom-start')).toEqual({
      y: 232 + INSTANT_TOOLTIP_HOST_GAP,
      x: 400,
    });
  });

  it('honours a custom gap override (e.g. denser layouts)', () => {
    expect(computeTooltipAnchor(HOST, 'top-end', 12)).toEqual({
      y: 188,
      x: 480,
    });
    expect(computeTooltipAnchor(HOST, 'bottom-start', 0)).toEqual({
      y: 232,
      x: 400,
    });
  });
});

describe('InstantTooltipPopover source contract (v3.232 portal)', () => {
  it('imports `createPortal` from react-dom', () => {
    // Locks in the portal wiring at the source level — accidental
    // refactor back to a plain absolutely-positioned span would fail
    // here long before it reaches Mini E2E.
    expect(componentSource).toMatch(
      /import\s*\{[^}]*\bcreatePortal\b[^}]*\}\s*from\s*['"]react-dom['"]/,
    );
  });

  it('renders the popover into document.body via createPortal', () => {
    expect(componentSource).toMatch(/createPortal\([^,]+,\s*document\.body\s*\)/);
  });

  it('uses position: fixed for the popover (not absolute)', () => {
    // The inline style object on the popover must declare
    // `position: 'fixed'` so it escapes ancestor scroll/clip contexts.
    expect(componentSource).toMatch(/position:\s*['"]fixed['"]/);
  });

  it('removes the legacy CSS `position: absolute` on `.instant-tooltip-popover`', () => {
    // Regression guard for the v3.232 CSS migration: the popover rule
    // must not declare `position: absolute` any more (layout now comes
    // from the inline `position: fixed`).
    const popoverRule =
      stylesSource.match(/\.instant-tooltip-popover\s*\{[^}]*\}/)?.[0] ?? '';
    expect(popoverRule).not.toMatch(/position:\s*absolute/);
  });

  it('attaches pointerleave/focusout listeners so the portal hides on exit', () => {
    expect(componentSource).toMatch(/addEventListener\(['"]pointerleave['"]/);
    expect(componentSource).toMatch(/addEventListener\(['"]focusout['"]/);
  });
});
