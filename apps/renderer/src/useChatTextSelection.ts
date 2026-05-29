import { useEffect, useRef, useState } from 'react';
import {
  isSelectionInsideContainer,
  normalizeSelectionText,
  type SelectionRect,
} from './agentChatSelection';

// v3.267 — "Floating selection → Add to chat" hook (Ethan voice 7199,
// 2026-05-29). Watches the document for `selectionchange` events and, when
// the active selection is non-empty AND lives entirely inside the supplied
// container ref, returns the trimmed text + the on-screen bounding rect of
// the selection. Used by `AgentChatSelectionTooltip` to position the floating
// "Add to chat" button above the highlighted text.
//
// Why `selectionchange` on document (not on the container): the user can
// extend / shrink a selection by dragging or shift-arrowing AFTER the initial
// mousedown finished, and `selectionchange` is the only event that fires for
// every increment. We filter by container membership inside the handler.
//
// The hook intentionally returns `null` when:
//   - the active selection is collapsed (cursor caret only — no highlight),
//   - both endpoints are NOT inside the container,
//   - the selection text trims to empty (e.g. selected only whitespace),
//   - the container ref hasn't mounted yet.
// All four are "no tooltip should show" cases.

export interface ChatTextSelectionState {
  /** Trimmed + normalised selection text — the exact string the tooltip's
   * "Add to chat" button will quote into the composer. */
  text: string;
  /** Bounding rect of the visible selection on screen, used to position the
   * floating tooltip. */
  rect: SelectionRect;
}

interface UseChatTextSelectionArgs {
  /** Ref to the timeline / messages container. The hook only reacts to
   * selections whose endpoints both live inside this node. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** When `false`, the hook is a no-op and always returns null. Used to
   * disable the feature while the chat panel is closed / streaming / showing
   * settings or history (in which case the timeline isn't the active view). */
  enabled: boolean;
}

export function useChatTextSelection(
  args: UseChatTextSelectionArgs,
): ChatTextSelectionState | null {
  const { containerRef, enabled } = args;
  const [state, setState] = useState<ChatTextSelectionState | null>(null);
  // We need a ref-mirror of `enabled` so the `selectionchange` listener's
  // closure can read the latest value without re-subscribing on every render.
  // Re-subscribing thrashes the listener and (under React strict-mode) can
  // briefly miss selection events.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) {
      // When disabled, also clear any stale state so the tooltip disappears.
      setState(null);
      return;
    }

    function handleSelectionChange(): void {
      if (!enabledRef.current) {
        setState(null);
        return;
      }

      const container = containerRef.current;
      if (!container) {
        setState(null);
        return;
      }

      const selection = typeof window !== 'undefined' ? window.getSelection() : null;
      if (!selection || selection.isCollapsed) {
        setState(null);
        return;
      }

      const inside = isSelectionInsideContainer({
        anchorNode: selection.anchorNode,
        focusNode: selection.focusNode,
        container,
      });
      if (!inside) {
        setState(null);
        return;
      }

      const rawText = selection.toString();
      const text = normalizeSelectionText(rawText);
      if (text.length === 0) {
        setState(null);
        return;
      }

      // `getRangeAt(0).getBoundingClientRect()` returns the union rect of the
      // selection across line wraps. That's the rect we want to place the
      // tooltip relative to — it visually hugs the highlighted region.
      let rect: DOMRect | null = null;
      try {
        const range = selection.getRangeAt(0);
        rect = range.getBoundingClientRect();
      } catch {
        rect = null;
      }
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        // Some selection paths (cross-shadow, between detached nodes) yield a
        // zero-size rect — useless for positioning, treat as "no selection".
        setState(null);
        return;
      }

      setState({
        text,
        rect: {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
      });
    }

    // Initial run in case there's already an active selection when the hook
    // turns on (e.g. user selected text, then opened the chat panel).
    handleSelectionChange();

    document.addEventListener('selectionchange', handleSelectionChange);

    // Reposition on scroll / resize — the user's selection stays in DOM but
    // its on-screen rect can shift. We re-invoke the same handler so the rect
    // is fresh.
    window.addEventListener('scroll', handleSelectionChange, true);
    window.addEventListener('resize', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('scroll', handleSelectionChange, true);
      window.removeEventListener('resize', handleSelectionChange);
    };
  }, [containerRef, enabled]);

  return state;
}
