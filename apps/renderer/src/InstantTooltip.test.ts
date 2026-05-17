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
 *
 * v3.233 — add coverage for `decideTooltipHorizontalAlignment` (the
 * horizontal-axis auto-flip helper) plus `decideTooltipPlacementBothAxes`
 * (the composer that resolves both axes together). The repro: Add
 * Folder host with hostLeft≈153 hostRight≈229 in a >=1024px viewport;
 * default `top-end` first flips to `bottom-end` (vertical), then
 * `bottom-end` would put popover left at 229-320=-91px → flips to
 * `bottom-start`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeTooltipAnchor,
  decideTooltipHorizontalAlignment,
  decideTooltipPlacement,
  decideTooltipPlacementBothAxes,
  INSTANT_TOOLTIP_ESTIMATED_HEIGHT,
  INSTANT_TOOLTIP_ESTIMATED_WIDTH,
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

describe('decideTooltipHorizontalAlignment (v3.233)', () => {
  const VIEWPORT_WIDTH = 1280;

  it('keeps the default *-end when there is plenty of room to the left', () => {
    // Host hugs viewport-right, default *-end anchors popover at host.right
    // and extends leftward — fits comfortably.
    expect(
      decideTooltipHorizontalAlignment(
        /* hostLeft */ 1100,
        /* hostRight */ 1240,
        VIEWPORT_WIDTH,
        'bottom-end',
      ),
    ).toBe('bottom-end');
  });

  it('flips bottom-end to bottom-start when popover would clip viewport-left (Add Folder repro)', () => {
    // Add Folder scenario from Mini: hostLeft≈153, hostRight≈229.
    // popoverWidth (320) > hostRight (229) → left edge would be -91px.
    // Flip to bottom-start: anchored at hostLeft=153, right edge = 473
    // ≤ 1280, fits. Expected: bottom-start.
    expect(
      decideTooltipHorizontalAlignment(
        /* hostLeft */ 153,
        /* hostRight */ 229,
        VIEWPORT_WIDTH,
        'bottom-end',
      ),
    ).toBe('bottom-start');
  });

  it('flips top-end to top-start at viewport-left edge (preserving vertical prefix)', () => {
    // Same overflow case but with a top-* prefix — only the suffix
    // should flip, not the vertical axis.
    expect(
      decideTooltipHorizontalAlignment(
        20,
        100,
        VIEWPORT_WIDTH,
        'top-end',
      ),
    ).toBe('top-start');
  });

  it('keeps the default *-start when there is plenty of room to the right', () => {
    // Host hugs viewport-left, default *-start anchors popover at host.left
    // and extends rightward — fits.
    expect(
      decideTooltipHorizontalAlignment(
        40,
        120,
        VIEWPORT_WIDTH,
        'bottom-start',
      ),
    ).toBe('bottom-start');
  });

  it('flips bottom-start to bottom-end when popover would clip viewport-right', () => {
    // Host near viewport-right edge: hostLeft=1100. With popoverWidth=320,
    // start anchor would land popover right at 1420 — past 1280. Flip
    // to *-end so it extends leftward: right edge = hostRight = 1240,
    // left edge = 1240-320 = 920, fits.
    expect(
      decideTooltipHorizontalAlignment(
        1100,
        1240,
        VIEWPORT_WIDTH,
        'bottom-start',
      ),
    ).toBe('bottom-end');
  });

  it('flips top-start to top-end (preserving vertical prefix) at viewport-right edge', () => {
    expect(
      decideTooltipHorizontalAlignment(
        1100,
        1240,
        VIEWPORT_WIDTH,
        'top-start',
      ),
    ).toBe('top-end');
  });

  it('honours a custom popoverWidth override', () => {
    // Narrower popover (180px) — same Add Folder hostRight=229 NOW fits
    // as *-end without flipping (left edge = 49px, on-screen).
    expect(
      decideTooltipHorizontalAlignment(
        153,
        229,
        VIEWPORT_WIDTH,
        'bottom-end',
        180,
      ),
    ).toBe('bottom-end');
  });

  it('keeps default *-end when at exactly the threshold (popoverWidth === hostRight)', () => {
    // Exact-fit boundary: left edge would be exactly 0 — still on-screen.
    expect(
      decideTooltipHorizontalAlignment(
        /* hostLeft */ 200,
        /* hostRight */ INSTANT_TOOLTIP_ESTIMATED_WIDTH,
        VIEWPORT_WIDTH,
        'bottom-end',
      ),
    ).toBe('bottom-end');
  });

  it('flips when popover left would be exactly one pixel off-screen', () => {
    // One pixel below threshold should flip.
    expect(
      decideTooltipHorizontalAlignment(
        /* hostLeft */ 100,
        /* hostRight */ INSTANT_TOOLTIP_ESTIMATED_WIDTH - 1,
        VIEWPORT_WIDTH,
        'bottom-end',
      ),
    ).toBe('bottom-start');
  });

  it('picks the side with more room when neither side fits the estimate', () => {
    // Tiny viewport / wide popover: room-to-left = hostRight, room-to-right
    // = viewportWidth - hostLeft.
    // Default *-end, more room AS *-start (hostLeft small, viewportWidth
    // - hostLeft large): flip.
    expect(
      decideTooltipHorizontalAlignment(
        /* hostLeft */ 40,
        /* hostRight */ 60,
        /* viewportWidth */ 200,
        'bottom-end',
      ),
    ).toBe('bottom-start');

    // Default *-end, more room AS-IS (hostRight large): keep.
    expect(
      decideTooltipHorizontalAlignment(
        /* hostLeft */ 140,
        /* hostRight */ 160,
        /* viewportWidth */ 200,
        'bottom-end',
      ),
    ).toBe('bottom-end');

    // Default *-start, more room AS *-end: flip.
    expect(
      decideTooltipHorizontalAlignment(
        /* hostLeft */ 140,
        /* hostRight */ 160,
        /* viewportWidth */ 200,
        'bottom-start',
      ),
    ).toBe('bottom-end');
  });

  it('preserves the vertical axis (top vs bottom) when flipping the horizontal axis', () => {
    expect(
      decideTooltipHorizontalAlignment(
        10,
        20,
        VIEWPORT_WIDTH,
        'top-end',
      ),
    ).toBe('top-start');
    expect(
      decideTooltipHorizontalAlignment(
        10,
        20,
        VIEWPORT_WIDTH,
        'bottom-end',
      ),
    ).toBe('bottom-start');
  });
});

describe('decideTooltipPlacementBothAxes (v3.233 composer)', () => {
  const VIEWPORT = { width: 1280, height: 900 };

  it('Add Folder repro: top-end with viewport-top + viewport-left host → bottom-start', () => {
    // The real-world Add Folder host from Mini: hostTop=88, hostBottom=122,
    // hostLeft≈153, hostRight≈229. Default top-end first flips vertical to
    // bottom-end, then horizontal flips to bottom-start (popover would
    // overflow viewport-left as bottom-end).
    expect(
      decideTooltipPlacementBothAxes(
        { top: 88, bottom: 122, left: 153, right: 229 },
        VIEWPORT,
        'top-end',
      ),
    ).toBe('bottom-start');
  });

  it('vertical-only flip preserved when horizontal axis already fits', () => {
    // Branding card scenario: near top of viewport, comfortable
    // horizontal space because the host is wide.
    expect(
      decideTooltipPlacementBothAxes(
        { top: 12, bottom: 60, left: 600, right: 800 },
        VIEWPORT,
        'top-end',
      ),
    ).toBe('bottom-end');
  });

  it('horizontal-only flip preserved when vertical axis already fits', () => {
    // Host comfortable vertically, but hugs viewport-left → only the
    // horizontal suffix changes.
    expect(
      decideTooltipPlacementBothAxes(
        { top: 500, bottom: 540, left: 60, right: 140 },
        VIEWPORT,
        'top-end',
      ),
    ).toBe('top-start');
  });

  it('both-axes-fit: keep the default placement unchanged', () => {
    expect(
      decideTooltipPlacementBothAxes(
        { top: 500, bottom: 540, left: 800, right: 940 },
        VIEWPORT,
        'top-end',
      ),
    ).toBe('top-end');
  });

  it('bottom-right corner: bottom-start default flips both axes to top-end', () => {
    // Host hugs bottom-right corner; default bottom-start would clip
    // bottom AND right.
    expect(
      decideTooltipPlacementBothAxes(
        { top: 850, bottom: 890, left: 1140, right: 1240 },
        VIEWPORT,
        'bottom-start',
      ),
    ).toBe('top-end');
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

  it('runtime path uses the v3.233 both-axes composer, not the vertical-only helper', () => {
    // Guard against an accidental revert: the runtime measure/reanchor
    // path must call `decideTooltipPlacementBothAxes` so the horizontal
    // flip is actually applied on hover.
    expect(componentSource).toMatch(/decideTooltipPlacementBothAxes\(/);
    // And the runtime path must NOT call the vertical-only helper
    // directly any more (we still export it for tests + reuse, but the
    // runtime should always go through the composer).
    const measureBlock =
      componentSource.match(/const measureAndOpen[\s\S]*?setOpen\(true\);\s*\};/)?.[0] ?? '';
    expect(measureBlock).toMatch(/decideTooltipPlacementBothAxes\(/);
    expect(measureBlock).not.toMatch(/\bdecideTooltipPlacement\(/);
  });
});
