import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

type FloatingTooltipPlacement = 'left' | 'right' | 'top' | 'bottom';

interface FloatingTooltipProps {
  id: string;
  label?: ReactNode;
  children: ReactNode;
  placement?: FloatingTooltipPlacement;
}

const TOOLTIP_VIEWPORT_MARGIN_PX = 12;
const TOOLTIP_TRIGGER_GAP_PX = 8;

function clampToViewport(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Portalled hover/focus tooltip for small in-app popovers that live inside
 * scrollable/clipped panes. A high z-index alone cannot escape an ancestor
 * with overflow clipping, so this renders the tooltip under document.body and
 * positions it from a tiny anchor mounted inside the trigger button.
 */
export function FloatingTooltip({
  id,
  label,
  children,
  placement = 'left',
}: FloatingTooltipProps): JSX.Element {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [floatingStyle, setFloatingStyle] = useState<CSSProperties>({
    position: 'fixed',
    left: 0,
    top: 0,
    visibility: 'hidden',
  });

  const updatePosition = useCallback(() => {
    const trigger = anchorRef.current?.parentElement;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Measure the actual portalled tooltip instead of guessing from CSS. This
    // keeps long labels readable while still preventing viewport-edge clipping.
    let left = triggerRect.left;
    let top = triggerRect.top;

    if (placement === 'left') {
      left = triggerRect.left - tooltipRect.width - TOOLTIP_TRIGGER_GAP_PX;
      top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
    } else if (placement === 'right') {
      left = triggerRect.right + TOOLTIP_TRIGGER_GAP_PX;
      top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
    } else if (placement === 'top') {
      left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
      top = triggerRect.top - tooltipRect.height - TOOLTIP_TRIGGER_GAP_PX;
    } else {
      left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
      top = triggerRect.bottom + TOOLTIP_TRIGGER_GAP_PX;
    }

    setFloatingStyle({
      position: 'fixed',
      left: clampToViewport(
        left,
        TOOLTIP_VIEWPORT_MARGIN_PX,
        viewportWidth - tooltipRect.width - TOOLTIP_VIEWPORT_MARGIN_PX,
      ),
      top: clampToViewport(
        top,
        TOOLTIP_VIEWPORT_MARGIN_PX,
        viewportHeight - tooltipRect.height - TOOLTIP_VIEWPORT_MARGIN_PX,
      ),
      visibility: 'visible',
    });
  }, [placement]);

  useEffect(() => {
    const trigger = anchorRef.current?.parentElement;
    if (!trigger) {
      return;
    }

    const show = () => setVisible(true);
    const hide = () => setVisible(false);

    trigger.addEventListener('mouseenter', show);
    trigger.addEventListener('mouseleave', hide);
    trigger.addEventListener('focusin', show);
    trigger.addEventListener('focusout', hide);

    return () => {
      trigger.removeEventListener('mouseenter', show);
      trigger.removeEventListener('mouseleave', hide);
      trigger.removeEventListener('focusin', show);
      trigger.removeEventListener('focusout', hide);
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const updateOnNextFrame = () => {
      window.requestAnimationFrame(updatePosition);
    };

    updateOnNextFrame();
    window.addEventListener('resize', updateOnNextFrame);
    window.addEventListener('scroll', updateOnNextFrame, true);

    return () => {
      window.removeEventListener('resize', updateOnNextFrame);
      window.removeEventListener('scroll', updateOnNextFrame, true);
    };
  }, [updatePosition, visible]);

  return (
    <>
      <span ref={anchorRef} className="floating-tooltip-anchor" aria-hidden="true" />
      {visible
        ? createPortal(
            <span
              id={id}
              ref={tooltipRef}
              className="floating-tooltip-popover"
              role="tooltip"
              style={floatingStyle}
            >
              {label ? <span className="floating-tooltip-popover-label">{label}</span> : null}
              <span className="floating-tooltip-popover-body">{children}</span>
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
