import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * v3.226 — instant-fade custom tooltip components. Standardise every
 * tooltip in the app on the same pattern previously used for the Save
 * Copy button (voice 3163).
 *
 * v3.231 — viewport-edge auto-flip. Top-bar tooltips (branding card,
 * Add Folder, album-area toolbar) sit near the top of the viewport
 * with no room above; the default top-end placement renders offscreen
 * and Chromium clips it.
 *
 * v3.232 — React Portal for clipping escape. v3.231 fixed viewport-edge
 * clipping but ancestor `overflow:hidden|auto` clipping remained:
 * `folder-tools-card` + `panel-left` (Add Folder) and the `.actions` row
 * + `panel-main` (Save Copy on All) clip absolutely-positioned children
 * regardless of CSS placement. The fix is to render the popover via
 * `ReactDOM.createPortal(..., document.body)` so the DOM node escapes
 * every clipping ancestor, then position it via JS using
 * `host.getBoundingClientRect()` with `position: fixed`. The CSS
 * placement classes are retained for visual styling (slide-in transform
 * direction, border-radius corner) but no longer drive layout
 * positioning — the body lives at the top of the DOM tree, so there is
 * no clipping ancestor to escape from.
 *
 * The native `title=` attribute is slow (≥500ms OS delay), OS-styled
 * (inconsistent across platforms), and not customisable. The custom
 * popover gives us a 60ms opacity transition and full styling control.
 *
 * Two usage patterns are offered, in order of preference:
 *
 * 1) `<InstantTooltipPopover>` — non-invasive. Render it as the LAST
 *    CHILD of an existing element, and add `instant-tooltip-host` and
 *    `instant-tooltip-host--<wrap>` to the element's className.
 *
 *      <button
 *        className="reset-all-times-button instant-tooltip-host instant-tooltip-host--inline-flex"
 *        onClick={handleReset}
 *      >
 *        Reset All Times
 *        <InstantTooltipPopover content="Set playback time to zero for every track." />
 *      </button>
 *
 * 2) `<InstantTooltip>` — wrapper. Wraps the child in a host `<span>`.
 *
 *      <InstantTooltip content="...">
 *        <SomeThirdPartyComponent />
 *      </InstantTooltip>
 */

export type InstantTooltipPlacement =
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end';

export type InstantTooltipWrap = 'inline-flex' | 'block' | 'contents';

/**
 * Estimated popover height including the 6px host-margin. Real popovers
 * run ~24–72px depending on body length; we deliberately overshoot a
 * touch so a 1-line tooltip near the top doesn't render in negative-y.
 * Used by the pure decision helper for vertical flip; the runtime path
 * can later swap in `popoverEl.offsetHeight` if we want a tighter fit.
 */
export const INSTANT_TOOLTIP_ESTIMATED_HEIGHT = 120;

/**
 * Host-popover gap in pixels. Matches the v3.231 CSS `calc(100% + 6px)`
 * spacing so the visual position is identical pre/post-portal.
 */
export const INSTANT_TOOLTIP_HOST_GAP = 6;

/**
 * Pure decision helper — given the host's top/bottom edges and the
 * viewport height plus the caller's preferred placement, return the
 * placement that will actually fit on screen. Unchanged from v3.231 —
 * still vertical-axis only; horizontal axis is preserved.
 */
export function decideTooltipPlacement(
  hostTop: number,
  hostBottom: number,
  viewportHeight: number,
  defaultPlacement: InstantTooltipPlacement,
  popoverHeight: number = INSTANT_TOOLTIP_ESTIMATED_HEIGHT,
): InstantTooltipPlacement {
  const horizontalSuffix = defaultPlacement.endsWith('-start') ? 'start' : 'end';
  const wantsTop = defaultPlacement.startsWith('top-');

  if (wantsTop) {
    if (hostTop < popoverHeight) {
      const roomBelow = viewportHeight - hostBottom;
      if (roomBelow >= popoverHeight) {
        return `bottom-${horizontalSuffix}` as InstantTooltipPlacement;
      }
      return hostTop >= roomBelow
        ? defaultPlacement
        : (`bottom-${horizontalSuffix}` as InstantTooltipPlacement);
    }
    return defaultPlacement;
  }

  const roomBelow = viewportHeight - hostBottom;
  if (roomBelow < popoverHeight) {
    if (hostTop >= popoverHeight) {
      return `top-${horizontalSuffix}` as InstantTooltipPlacement;
    }
    return roomBelow >= hostTop
      ? defaultPlacement
      : (`top-${horizontalSuffix}` as InstantTooltipPlacement);
  }
  return defaultPlacement;
}

/**
 * v3.232 — Pure position helper. Given the host's DOMRect-shape, the
 * resolved placement (post-auto-flip) and the host-popover gap, return
 * the `position: fixed` coordinates for the popover.
 *
 * The CSS for each placement variant continues to provide the visual
 * `transform` (a 2px slide-in on the opening direction), but the layout
 * `top`/`left` no longer come from CSS — they come from here.
 *
 * Conventions, mirroring the v3.231 CSS:
 *   • `*-end`    aligns the popover's RIGHT edge to the host's right edge.
 *   • `*-start`  aligns the popover's LEFT edge to the host's left edge.
 *   • `top-*`    sits the popover ABOVE the host (BOTTOM edge ≈ host top - gap).
 *   • `bottom-*` sits the popover BELOW the host (TOP edge ≈ host bottom + gap).
 *
 * Because `position: fixed` is set against the viewport (root containing
 * block) instead of `position: absolute` against the host (per-ancestor
 * containing block), the popover's coordinate origin is the same as the
 * host's `getBoundingClientRect()` origin — no scroll-offset math needed.
 *
 * For `top-*` placements we describe the BOTTOM edge of the popover (the
 * caller uses `transform: translateY(-100%)` to convert that to a `top`
 * value). For `bottom-*` we describe the TOP edge directly. The CSS
 * already declares the right translate for each variant.
 */
export interface InstantTooltipAnchorPoint {
  /**
   * Vertical reference point for the popover.
   *   • For `top-*`    placements this is the y of the popover's BOTTOM edge.
   *   • For `bottom-*` placements this is the y of the popover's TOP edge.
   */
  y: number;
  /**
   * Horizontal reference point for the popover.
   *   • For `*-end`    placements this is the x of the popover's RIGHT edge.
   *   • For `*-start`  placements this is the x of the popover's LEFT edge.
   */
  x: number;
}

export function computeTooltipAnchor(
  hostRect: { top: number; bottom: number; left: number; right: number },
  placement: InstantTooltipPlacement,
  gap: number = INSTANT_TOOLTIP_HOST_GAP,
): InstantTooltipAnchorPoint {
  const wantsTop = placement.startsWith('top-');
  const wantsEnd = placement.endsWith('-end');
  return {
    y: wantsTop ? hostRect.top - gap : hostRect.bottom + gap,
    x: wantsEnd ? hostRect.right : hostRect.left,
  };
}

/**
 * Walks up from the popover element to find its `.instant-tooltip-host`
 * ancestor. Kept for the standalone `<InstantTooltipPopover>` pattern
 * (the popover is rendered as a sibling of the host's other children
 * inside the host element). Exported only for testing.
 */
export function findTooltipHost(start: Element | null): HTMLElement | null {
  let node: Element | null = start;
  while (node && node !== document.documentElement) {
    if (
      node instanceof HTMLElement &&
      node.classList.contains('instant-tooltip-host')
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export interface InstantTooltipPopoverProps {
  content: ReactNode;
  placement?: InstantTooltipPlacement;
  label?: ReactNode;
  maxWidth?: number | string;
  id?: string;
}

/**
 * v3.232 — Portal-based popover.
 *
 * Implementation notes:
 *   • A tiny tracker `<span>` is rendered inline as the last child of the
 *     host. We use it only to locate the `.instant-tooltip-host` ancestor
 *     (same mechanism as v3.231). It has zero size and no visual effect.
 *   • Pointer/focus listeners attach to the host. On enter, we measure
 *     the host rect, decide the placement, compute the anchor, and open
 *     the portal. On leave/blur, we close.
 *   • The portal renders the popover to `document.body`, so no ancestor
 *     `overflow:hidden|auto` can clip it. Position is `fixed` (driven by
 *     the computed anchor).
 *   • The popover is `pointer-events: none` and `aria-hidden` when not
 *     open, matching the v3.231 invariant: it never blocks clicks and is
 *     hidden from assistive tech when closed.
 *   • The tracker carries the `id` attribute so any `aria-describedby`
 *     reference from the trigger still resolves; when the portal is open
 *     we also expose the same id on the floating popover for SR consumers
 *     that follow the live tree.
 */
export function InstantTooltipPopover({
  content,
  placement = 'top-end',
  label,
  maxWidth,
  id,
}: InstantTooltipPopoverProps): JSX.Element {
  const trackerRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [resolvedPlacement, setResolvedPlacement] =
    useState<InstantTooltipPlacement>(placement);
  const [anchor, setAnchor] = useState<InstantTooltipAnchorPoint | null>(null);

  // Find the host once on mount (and after re-renders that swap the host).
  useEffect(() => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    const host = findTooltipHost(tracker.parentElement);
    if (!host) return;
    if (typeof window === 'undefined') return;

    const measureAndOpen = () => {
      const rect = host.getBoundingClientRect();
      const next = decideTooltipPlacement(
        rect.top,
        rect.bottom,
        window.innerHeight,
        placement,
      );
      setResolvedPlacement(next);
      setAnchor(computeTooltipAnchor(rect, next));
      setOpen(true);
    };
    const close = () => setOpen(false);

    host.addEventListener('pointerenter', measureAndOpen);
    host.addEventListener('pointerleave', close);
    host.addEventListener('focusin', measureAndOpen);
    host.addEventListener('focusout', close);
    return () => {
      host.removeEventListener('pointerenter', measureAndOpen);
      host.removeEventListener('pointerleave', close);
      host.removeEventListener('focusin', measureAndOpen);
      host.removeEventListener('focusout', close);
    };
  }, [placement]);

  // While open, keep the anchor in sync with scroll/resize so the popover
  // tracks the host (e.g. a sticky toolbar that scrolls under it).
  useLayoutEffect(() => {
    if (!open) return;
    const tracker = trackerRef.current;
    if (!tracker) return;
    const host = findTooltipHost(tracker.parentElement);
    if (!host) return;
    if (typeof window === 'undefined') return;

    const reanchor = () => {
      const rect = host.getBoundingClientRect();
      const next = decideTooltipPlacement(
        rect.top,
        rect.bottom,
        window.innerHeight,
        placement,
      );
      setResolvedPlacement(next);
      setAnchor(computeTooltipAnchor(rect, next));
    };

    window.addEventListener('scroll', reanchor, true);
    window.addEventListener('resize', reanchor);
    return () => {
      window.removeEventListener('scroll', reanchor, true);
      window.removeEventListener('resize', reanchor);
    };
  }, [open, placement]);

  const popoverClassName = [
    'instant-tooltip-popover',
    'instant-tooltip-popover--portal',
    `instant-tooltip-popover--${resolvedPlacement}`,
    label ? 'instant-tooltip-popover--has-label' : null,
    open ? 'instant-tooltip-popover--open' : null,
  ]
    .filter(Boolean)
    .join(' ');

  // Vertical: `top-*` describes the popover's BOTTOM edge → translate
  // up by 100% of its own height. `bottom-*` describes the TOP edge →
  // no Y translation needed (slide-in transform comes from CSS).
  // Horizontal: `*-end` describes the popover's RIGHT edge → translate
  // left by 100% of its own width. `*-start` describes the LEFT edge →
  // no X translation needed.
  const wantsTop = resolvedPlacement.startsWith('top-');
  const wantsEnd = resolvedPlacement.endsWith('-end');
  const layoutTransform = `translate(${wantsEnd ? '-100%' : '0'}, ${wantsTop ? '-100%' : '0'})`;

  const popoverStyle: CSSProperties = {
    position: 'fixed',
    top: anchor ? `${anchor.y}px` : '-9999px',
    left: anchor ? `${anchor.x}px` : '-9999px',
    transform: layoutTransform,
    ...(maxWidth !== undefined ? { maxWidth } : {}),
  };

  // Tracker is a minimal inline marker that exists in the host's DOM so
  // we can resolve `findTooltipHost`. Zero-size, aria-hidden, no styling.
  const tracker = (
    <span
      ref={trackerRef}
      className="instant-tooltip-tracker"
      aria-hidden="true"
      data-tooltip-id={id}
    />
  );

  if (typeof document === 'undefined') return tracker;

  const portal = open
    ? createPortal(
        <span
          ref={popoverRef}
          id={id}
          className={popoverClassName}
          role="tooltip"
          style={popoverStyle}
          data-placement={resolvedPlacement}
        >
          {label ? (
            <span className="instant-tooltip-popover-label">{label}</span>
          ) : null}
          <span className="instant-tooltip-popover-body">{content}</span>
        </span>,
        document.body,
      )
    : null;

  return (
    <>
      {tracker}
      {portal}
    </>
  );
}

export interface InstantTooltipProps extends InstantTooltipPopoverProps {
  wrap?: InstantTooltipWrap;
  className?: string;
  children: ReactNode;
  'data-testid'?: string;
}

export function InstantTooltip({
  content,
  placement = 'top-end',
  label,
  maxWidth,
  wrap = 'inline-flex',
  className,
  children,
  'data-testid': dataTestId,
}: InstantTooltipProps): JSX.Element {
  const generatedId = useId();
  const popoverId = `instant-tooltip-${generatedId.replace(/[^A-Za-z0-9_-]/g, '')}`;

  const hostClassName = [
    'instant-tooltip-host',
    `instant-tooltip-host--${wrap}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  let trigger: ReactNode = children;
  if (isValidElement(children)) {
    const childElement = children as ReactElement<{ 'aria-describedby'?: string }>;
    const existingDescribedBy = childElement.props['aria-describedby'];
    const mergedDescribedBy = existingDescribedBy
      ? `${existingDescribedBy} ${popoverId}`
      : popoverId;
    trigger = cloneElement(childElement, {
      'aria-describedby': mergedDescribedBy,
    });
  }

  return (
    <span className={hostClassName} data-testid={dataTestId}>
      {trigger}
      <InstantTooltipPopover
        content={content}
        placement={placement}
        label={label}
        maxWidth={maxWidth}
        id={popoverId}
      />
    </span>
  );
}
