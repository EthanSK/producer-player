import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * v3.226 — instant-fade custom tooltip components. Standardise every
 * tooltip in the app on the same pattern previously used for the Save
 * Copy button (voice 3163).
 *
 * v3.231 — viewport-edge auto-flip. Top-bar tooltips (branding card,
 * Add Folder, album-area toolbar) sit near the top of the viewport
 * with no room above; the default top-end placement renders offscreen
 * and Chromium clips it. On hover/focus, we now measure the host's
 * bounding rect and flip the placement to the opposite vertical side
 * when the preferred side doesn't fit. The CSS still owns the actual
 * positioning — we only swap which `instant-tooltip-popover--*` class
 * is applied. Auto-flip works for BOTH usage patterns:
 *   1) `<InstantTooltipPopover>` standalone (the bulk-migration shape)
 *      — the popover walks up to its parent `.instant-tooltip-host`
 *      and listens for pointer/focus on that host.
 *   2) `<InstantTooltip>` wrapper — the wrapper owns the host ref and
 *      drives the flip directly.
 *
 * The native `title=` attribute is slow (≥500ms OS delay), OS-styled
 * (inconsistent across platforms), and not customisable. We mirror the
 * `.main-list-row-metadata-popover` pattern: a pure-CSS instant-fade
 * popover that anchors absolutely against a `position: relative` host
 * element, with a 60ms opacity/transform transition triggered on
 * `:hover` / `:focus-within`.
 *
 * Two usage patterns are offered, in order of preference:
 *
 * 1) `<InstantTooltipPopover>` — non-invasive. Render it as the LAST
 *    CHILD of an existing element, and add `instant-tooltip-host` and
 *    `instant-tooltip-host--<wrap>` to the element's className. Zero
 *    layout impact. Use this for the bulk migration (replaces the
 *    native `title=` attribute one-for-one without wrapping).
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
 *    Convenient when adding a tooltip to an element you can't easily
 *    modify (third-party component, deeply nested JSX), but does add a
 *    wrapper span and may affect inline-flex/grid layouts. Prefer
 *    pattern 1 unless wrapping is genuinely needed.
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
 * Estimated popover height including the 6px host-margin from the CSS
 * `bottom/top: calc(100% + 6px)`. Real popovers run ~24–72px depending
 * on body length; we deliberately overshoot a touch so a 1-line tooltip
 * near the top doesn't render in negative-y. The CSS still wraps long
 * content at `max-width: min(360px, calc(100vw - 24px))`, so flipping a
 * tall tooltip from top to bottom is always safe — there's always more
 * room below than above for a top-bar element.
 */
export const INSTANT_TOOLTIP_ESTIMATED_HEIGHT = 120;

/**
 * Pure decision helper — given the host's top/bottom edges and the
 * viewport height plus the caller's preferred placement, return the
 * placement that will actually fit on screen.
 *
 * The CSS placement names encode TWO axes:
 *   - `top-*`    / `bottom-*`  — vertical (which side the popover sits on)
 *   - `*-start`  / `*-end`     — horizontal (which edge it aligns to)
 *
 * v3.231 only flips the vertical axis when there isn't enough room above
 * a top-* placement (or below a bottom-* placement). Horizontal flipping
 * follows for free if we later want it; right now the bug is purely
 * top-edge clipping on the top-bar.
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
      // Neither side has room — pick the larger one.
      return hostTop >= roomBelow
        ? defaultPlacement
        : (`bottom-${horizontalSuffix}` as InstantTooltipPlacement);
    }
    return defaultPlacement;
  }

  // bottom-* default
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
 * Walks up from the popover element to find its `.instant-tooltip-host`
 * ancestor. Used by the standalone `<InstantTooltipPopover>` pattern
 * (the bulk-migration shape) to attach auto-flip listeners to the host
 * element it's nested inside. Exported only for testing.
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
  /**
   * Tooltip body content. May be plain text or rich ReactNode.
   */
  content: ReactNode;
  /**
   * Anchor placement relative to the host element. Defaults to
   * `top-end` (matches Save Copy: anchored to the right edge,
   * fading in above-then-down).
   */
  placement?: InstantTooltipPlacement;
  /**
   * Optional short uppercase label rendered above the body.
   * Mirrors the `.main-list-row-metadata-popover-label` heading.
   */
  label?: ReactNode;
  /**
   * Override the popover's max-width (passed through as inline style).
   * Defaults to the CSS-side `min(360px, calc(100vw - 24px))`.
   */
  maxWidth?: number | string;
  /**
   * Optional id; auto-generated if not supplied. Useful when the
   * host element wants to set `aria-describedby` to point at the
   * popover.
   */
  id?: string;
}

export function InstantTooltipPopover({
  content,
  placement = 'top-end',
  label,
  maxWidth,
  id,
}: InstantTooltipPopoverProps): JSX.Element {
  const popoverRef = useRef<HTMLSpanElement | null>(null);
  const [resolvedPlacement, setResolvedPlacement] =
    useState<InstantTooltipPlacement>(placement);

  // Auto-flip when the host is hovered/focused. We attach listeners to
  // the *host* (the popover itself is pointer-events:none and never
  // gets pointer events) so we can measure before the CSS opacity
  // transition completes. The 60ms fade is plenty of headroom for a
  // synchronous setState + reflow.
  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const host = findTooltipHost(popover.parentElement);
    if (!host) return;

    const measureAndFlip = () => {
      const rect = host.getBoundingClientRect();
      const viewportHeight =
        typeof window !== 'undefined' ? window.innerHeight : 0;
      const next = decideTooltipPlacement(
        rect.top,
        rect.bottom,
        viewportHeight,
        placement,
      );
      setResolvedPlacement((prev) => (prev === next ? prev : next));
    };

    host.addEventListener('pointerenter', measureAndFlip);
    host.addEventListener('focusin', measureAndFlip);
    return () => {
      host.removeEventListener('pointerenter', measureAndFlip);
      host.removeEventListener('focusin', measureAndFlip);
    };
  }, [placement]);

  const popoverClassName = [
    'instant-tooltip-popover',
    `instant-tooltip-popover--${resolvedPlacement}`,
    label ? 'instant-tooltip-popover--has-label' : null,
  ]
    .filter(Boolean)
    .join(' ');

  const popoverStyle: CSSProperties | undefined =
    maxWidth !== undefined ? { maxWidth } : undefined;

  return (
    <span
      ref={popoverRef}
      id={id}
      className={popoverClassName}
      role="tooltip"
      style={popoverStyle}
    >
      {label ? <span className="instant-tooltip-popover-label">{label}</span> : null}
      <span className="instant-tooltip-popover-body">{content}</span>
    </span>
  );
}

export interface InstantTooltipProps extends InstantTooltipPopoverProps {
  /**
   * Host wrapper display mode. `inline-flex` (default) works for nearly
   * everything; switch to `block` when wrapping a block-level child
   * (e.g. a card that uses flex/grid for its own layout).
   */
  wrap?: InstantTooltipWrap;
  /**
   * Extra className applied to the host wrapper.
   */
  className?: string;
  /**
   * The trigger element. Should be exactly one element.
   */
  children: ReactNode;
  /**
   * Optional `data-testid` for the host wrapper.
   */
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

  // Merge our aria-describedby with any existing one on the child so we
  // don't clobber a caller-provided describedby.
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

  // The wrapper component delegates auto-flip to the popover (which
  // walks up to find this host element via the shared `.instant-tooltip-host`
  // class — the same mechanism as the standalone pattern). No extra
  // wiring needed here.
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
