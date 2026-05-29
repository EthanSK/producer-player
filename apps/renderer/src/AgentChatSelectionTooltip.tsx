import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  computeSelectionTooltipPosition,
  type SelectionRect,
} from './agentChatSelection';

// v3.267 — Floating "Add to chat" tooltip for the agent chat panel (Ethan
// voice 7199, 2026-05-29). Renders only when the parent passes a non-null
// selection rect + text. Positions itself via a measured tooltip rect so
// long button labels don't clip, and lives in a portal under document.body
// so the agent-timeline's `overflow: auto` clipping doesn't truncate it.
//
// Backend-agnostic by design: the click handler just hands the selection text
// up to the parent, which calls `composer.appendQuotedText(text)`. From the
// composer's POV it's identical to the user typing the quote themselves —
// works with Claude AND Codex because both consume the composer-input string.

interface AgentChatSelectionTooltipProps {
  /** Current visible selection inside the chat container. `null` hides the
   * tooltip immediately (selection collapsed, cleared, etc.). */
  selection: { text: string; rect: SelectionRect } | null;
  /** Container rect so the tooltip can be horizontally clamped to the chat
   * panel's bounds (otherwise it could drift over the main app UI). */
  containerRect?: SelectionRect | null;
  /** Click handler. Receives the trimmed/normalised selection text. */
  onAddToChat: (text: string) => void;
  /** Notify parent when the tooltip wants to dismiss itself (Escape pressed,
   * clicked outside, etc.). The parent calls `window.getSelection()?.removeAllRanges()`
   * which collapses the selection and naturally hides the tooltip on the next
   * `selectionchange` event. */
  onDismiss: () => void;
}

export function AgentChatSelectionTooltip({
  selection,
  containerRect,
  onAddToChat,
  onDismiss,
}: AgentChatSelectionTooltipProps): JSX.Element | null {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );

  // Layout-effect (not effect) so the tooltip's first paint already has its
  // computed position — avoids a one-frame flash at (0,0) before the rect is
  // measured.
  useLayoutEffect(() => {
    if (!selection) {
      setPosition(null);
      return;
    }
    const node = tooltipRef.current;
    if (!node) {
      // First render — the tooltip DOM isn't measured yet. We render at
      // visibility:hidden until the rect comes in, then setPosition triggers
      // a re-render with the correct coords.
      setPosition({ left: -9999, top: -9999 });
      return;
    }
    const tooltipRect = node.getBoundingClientRect();
    const next = computeSelectionTooltipPosition({
      selection: selection.rect,
      tooltip: { width: tooltipRect.width, height: tooltipRect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      container: containerRect ?? null,
    });
    setPosition(next);
  }, [selection, containerRect]);

  // Dismiss on Escape — accessibility requirement. We don't trap focus inside
  // the tooltip (no captured keyboard navigation) so Escape is the user's
  // only escape hatch.
  useEffect(() => {
    if (!selection) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selection, onDismiss]);

  if (!selection) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: position?.left ?? -9999,
    top: position?.top ?? -9999,
    // Hidden until the position is computed so the user doesn't see a flash
    // in the top-left of the screen on the first selection. We use
    // `visibility` (not `display: none`) so the layout-measurement above can
    // still read the rendered width/height.
    visibility: position && position.left >= 0 ? 'visible' : 'hidden',
    // High z-index puts the tooltip above the agent chat panel itself
    // (.agent-chat-panel uses z-index: 1000-ish per agent-chat.css). 2147483646
    // is one below the max so any future emergency overlay can still sit on top.
    zIndex: 2147483646,
  };

  return createPortal(
    <div
      ref={tooltipRef}
      className="agent-chat-selection-tooltip"
      style={style}
      data-testid="agent-chat-selection-tooltip"
      role="toolbar"
      aria-label="Selection actions"
      // Prevent mousedown inside the tooltip from collapsing the selection
      // BEFORE the click handler fires. Without this, clicking the button
      // moves focus and `selectionchange` fires first, nuking our selection
      // ref, and the click handler ends up adding an empty quote.
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="agent-chat-selection-tooltip-button"
        onClick={() => {
          // Snapshot the text before calling the handler — the handler may
          // collapse the selection as a side effect.
          const text = selection.text;
          onAddToChat(text);
        }}
        data-testid="agent-chat-selection-tooltip-add"
        aria-label="Add selected text to chat as a quoted reference"
        title="Add selected text to chat"
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* Quote-bubble glyph — visually communicates "add as a quote" */}
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
        </svg>
        <span className="agent-chat-selection-tooltip-label">Add to chat</span>
      </button>
    </div>,
    document.body,
  );
}
