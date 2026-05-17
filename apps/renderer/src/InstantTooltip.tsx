import {
  cloneElement,
  isValidElement,
  useId,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * v3.226 — instant-fade custom tooltip components. Standardise every
 * tooltip in the app on the same pattern previously used for the Save
 * Copy button (voice 3163).
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
  const popoverClassName = [
    'instant-tooltip-popover',
    `instant-tooltip-popover--${placement}`,
    label ? 'instant-tooltip-popover--has-label' : null,
  ]
    .filter(Boolean)
    .join(' ');

  const popoverStyle: CSSProperties | undefined =
    maxWidth !== undefined ? { maxWidth } : undefined;

  return (
    <span id={id} className={popoverClassName} role="tooltip" style={popoverStyle}>
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
