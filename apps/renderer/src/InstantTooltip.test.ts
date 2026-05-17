/**
 * v3.231 — unit tests for the InstantTooltip viewport-edge auto-flip
 * helper. The bug: top-bar tooltips (branding card, Add Folder,
 * album-area toolbar) sit near the top of the viewport with no room
 * above their default `top-end` placement, so Chromium clips the
 * popover. `decideTooltipPlacement` is the pure decision function that
 * picks the placement that will actually fit.
 *
 * The full integration (host pointerenter listener → measure rect →
 * setState) lives in InstantTooltipPopover/InstantTooltip; those are
 * covered by Playwright spot-checks on Mini. The pure helper is what
 * we unit-test here.
 */
import { describe, expect, it } from 'vitest';
import {
  decideTooltipPlacement,
  INSTANT_TOOLTIP_ESTIMATED_HEIGHT,
} from './InstantTooltip';

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
