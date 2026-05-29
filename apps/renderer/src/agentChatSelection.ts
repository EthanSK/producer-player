// v3.267 — "Floating selection → Add to chat" feature (Ethan voice 7199,
// 2026-05-29). When the user highlights text anywhere inside the agent chat
// timeline, a small floating tooltip should pop up above the selection with
// an "Add to chat" button. Clicking it captures the selected text and inserts
// it into the composer as a blockquote that the next user message will carry
// along — works with both Claude and Codex backends because both consume the
// same composer-input string downstream.
//
// This module isolates the PURE pieces of that flow so they can be unit-tested
// in the renderer's pure-node Vitest environment (no jsdom). The DOM-driven
// pieces (selection-change listening, portal positioning) live in
// `AgentChatSelectionTooltip.tsx` and `useChatTextSelection.ts`, which import
// from here.
//
// Why a quote (and not e.g. a plain-text paste): the agent should see the
// selected text as *reference material* the user is asking about, not as a
// continuation of the user's prompt. A blockquote keeps it visually distinct
// in the composer + the rendered user bubble, and both Claude and Codex
// understand `> …` as a Markdown blockquote.

/** Maximum characters of selection text we'll quote inline. Long quotes get
 * an ellipsis suffix so the composer doesn't blow up with an entire transcript
 * dump (Claude/Codex both have prompt limits, and Ethan reads the composer
 * preview). The truncation kicks in only when the trimmed selection exceeds
 * the cap — short selections pass through unchanged. */
export const MAX_SELECTION_QUOTE_CHARS = 1200;

/** Bottom-padding between the highlighted text and the tooltip. Matches the
 * gap used by `FloatingTooltip` (8px) so the visual rhythm is consistent. */
export const SELECTION_TOOLTIP_GAP_PX = 8;

/** Horizontal margin we keep between the tooltip and the viewport edge so the
 * popover never clips off-screen on narrow windows. Matches FloatingTooltip's
 * `TOOLTIP_VIEWPORT_MARGIN_PX` for visual consistency. */
export const SELECTION_TOOLTIP_VIEWPORT_MARGIN_PX = 12;

/**
 * Lightweight rect shape so the pure-logic helpers don't need to import
 * `DOMRect` (which isn't defined in plain Node, our Vitest env). We accept
 * any object with `top/left/right/bottom/width/height` numbers — actual
 * `DOMRect` instances from `getBoundingClientRect()` satisfy this.
 */
export interface SelectionRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface TooltipPosition {
  /** Absolute fixed-position `left` value, in CSS pixels. */
  left: number;
  /** Absolute fixed-position `top` value, in CSS pixels. */
  top: number;
}

/**
 * Trim a raw selection string into the form we'll quote in the composer.
 *
 * Why this exists (not just `text.trim()`): browser selections are noisy.
 * They commonly grab leading whitespace from the start of a paragraph the
 * user partially dragged into, and trailing newlines from where the drag
 * ended on a line break. We collapse runs of internal whitespace into single
 * spaces so the quote reads compactly, but we PRESERVE single newlines so
 * multi-line selections (e.g. a bulleted list) render as a multi-line
 * blockquote in the composer.
 *
 * Returns `''` (empty string) when the selection is whitespace-only — the
 * caller treats that as "no active selection, hide the tooltip".
 */
export function normalizeSelectionText(raw: string): string {
  if (!raw) return '';
  // Step 1: strip carriage returns so cross-platform clipboard / DOM input
  // doesn't end up with `\r\n` artifacts in our blockquote.
  const noCarriageReturns = raw.replace(/\r/g, '');
  // Step 2: collapse runs of horizontal whitespace on each line so we don't
  // carry the DOM's indentation/padding into the quote.
  const lines = noCarriageReturns.split('\n').map((line) =>
    line.replace(/[ \t\f\v]+/g, ' ').trim(),
  );
  // Step 3: drop leading + trailing blank lines (they happen when the user
  // selects past the end of a paragraph).
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/**
 * Apply the MAX_SELECTION_QUOTE_CHARS cap with a clear ellipsis marker.
 * Returns the input unchanged when it's under the cap; otherwise hard-truncates
 * to MAX_SELECTION_QUOTE_CHARS minus the marker length so the final string
 * still fits the cap exactly. Why a marker: agents can tell the quote was
 * abbreviated and won't fabricate detail about the missing tail.
 */
export function truncateSelectionForQuote(text: string): string {
  if (text.length <= MAX_SELECTION_QUOTE_CHARS) return text;
  const marker = '\n…[truncated]';
  return `${text.slice(0, MAX_SELECTION_QUOTE_CHARS - marker.length)}${marker}`;
}

/**
 * Convert a multi-line selection into a Markdown blockquote suitable for the
 * composer. Each non-empty line gets a `> ` prefix; empty lines (which
 * separate paragraphs inside the original selection) get a bare `>` to keep
 * the paragraph break inside the quote when both Claude and Codex render it.
 *
 * The output never has a trailing newline — the caller decides what spacing
 * to use when concatenating with existing composer text (we standardise on
 * two newlines between an existing-text block and a new blockquote so the
 * Markdown parser treats them as separate blocks).
 */
export function formatSelectionAsBlockquote(text: string): string {
  const normalized = normalizeSelectionText(text);
  if (normalized.length === 0) return '';
  const truncated = truncateSelectionForQuote(normalized);
  return truncated
    .split('\n')
    .map((line) => (line.length === 0 ? '>' : `> ${line}`))
    .join('\n');
}

/**
 * Join an existing composer-input string with a freshly-built blockquote.
 *
 * Rules (matching how the existing composer formats its placeholders):
 * - If the current input is empty, the result is just the blockquote.
 * - Otherwise we ensure exactly ONE blank line separates the previous content
 *   from the new blockquote so Markdown renderers see them as distinct
 *   blocks. This is what Ethan asked for: "each adds another reference to
 *   the input. Don't overwrite."
 * - The result always ends with two newlines so the user's cursor lands
 *   below the quote and they can immediately type their question (e.g.
 *   "Why is this dipping?") without first having to position the caret.
 */
export function appendBlockquoteToComposerText(
  existing: string,
  blockquote: string,
): string {
  const cleanBlockquote = blockquote.trimEnd();
  if (cleanBlockquote.length === 0) return existing;
  const trailing = '\n\n';
  if (existing.length === 0) {
    return `${cleanBlockquote}${trailing}`;
  }
  // Ensure exactly one blank line between previous and new content. We strip
  // any trailing whitespace on the existing input so that a user who left an
  // accidental empty line at the end of the composer doesn't end up with
  // three blank lines in front of the new quote.
  const trimmedExisting = existing.replace(/\s+$/, '');
  return `${trimmedExisting}\n\n${cleanBlockquote}${trailing}`;
}

/**
 * Compute the absolute (viewport-fixed) tooltip position for a given
 * selection rect, tooltip size, and viewport size. We target the visual
 * centre of the selection horizontally + place the tooltip directly above the
 * selection's top edge, clamped to stay inside the viewport with the standard
 * margin.
 *
 * Edge handling (matters because the chat panel often sits in the bottom-right
 * corner of the viewport):
 * - If the tooltip would overflow the top of the viewport, we flip below the
 *   selection. This commonly happens for selections at the top of the
 *   transcript scroll area.
 * - Horizontal overflow gets clamped (we don't flip horizontally — the arrow
 *   is centred so a flipped horizontal would look weird).
 *
 * The container rect (when supplied) further constrains the horizontal range
 * so the tooltip stays anchored over the chat panel itself, not floating
 * out into the rest of the renderer. This is important when the user
 * highlights right at the panel's left/right edge.
 */
export function computeSelectionTooltipPosition(args: {
  selection: SelectionRect;
  tooltip: { width: number; height: number };
  viewport: ViewportSize;
  container?: SelectionRect | null;
}): TooltipPosition {
  const { selection, tooltip, viewport, container } = args;
  const margin = SELECTION_TOOLTIP_VIEWPORT_MARGIN_PX;
  const gap = SELECTION_TOOLTIP_GAP_PX;

  // Default: centred above the selection.
  let left = selection.left + selection.width / 2 - tooltip.width / 2;
  let top = selection.top - tooltip.height - gap;

  // Flip below when the tooltip would clip off the top of the viewport. The
  // chat panel's `agent-timeline` scroll container can produce a selection
  // rect whose `top` is small (selection right under the panel header).
  if (top < margin) {
    top = selection.bottom + gap;
  }

  // Clamp horizontally to the viewport first, then optionally tighten further
  // to the container's horizontal range so the tooltip never drifts off the
  // visible chat panel area.
  const horizontalMin = container
    ? Math.max(margin, container.left + margin)
    : margin;
  const horizontalMax = container
    ? Math.min(
        viewport.width - tooltip.width - margin,
        container.right - tooltip.width - margin,
      )
    : viewport.width - tooltip.width - margin;

  // Edge case: if the container is narrower than tooltip + 2*margin, the
  // clamp range collapses (min > max). Fall back to the viewport clamp so the
  // tooltip is at least visible.
  if (horizontalMax < horizontalMin) {
    left = Math.min(
      Math.max(left, margin),
      viewport.width - tooltip.width - margin,
    );
  } else {
    left = Math.min(Math.max(left, horizontalMin), horizontalMax);
  }

  // Vertical clamp as a final safety: never let the tooltip dip below the
  // bottom of the viewport (can happen if `selection.bottom` is already near
  // the viewport floor and we flipped below).
  top = Math.min(top, viewport.height - tooltip.height - margin);
  top = Math.max(top, margin);

  return { left, top };
}

/**
 * Determine whether a selection (described by its anchorNode / focusNode)
 * lies inside the given container. We treat a selection as "inside" only if
 * BOTH endpoints are descendants of the container — this avoids showing the
 * tooltip when the user drags from the chat into another panel.
 *
 * Accepts Node-like inputs (anything with `nodeType`) so the test suite can
 * pass plain stub objects without instantiating real DOM nodes. The
 * `container.contains` accepts `unknown` and we cast at the call site so a
 * real `Element` (with `contains(other: Node | null)`) still satisfies the
 * shape — TS's parameter contravariance would otherwise refuse to assign an
 * `Element` to a `(node: NodeLike) => boolean`.
 */
export interface NodeLike {
  nodeType: number;
}

export function isSelectionInsideContainer(args: {
  anchorNode: NodeLike | null;
  focusNode: NodeLike | null;
  container: { contains(node: unknown): boolean } | null;
}): boolean {
  const { anchorNode, focusNode, container } = args;
  if (!container) return false;
  if (!anchorNode || !focusNode) return false;
  return container.contains(anchorNode) && container.contains(focusNode);
}
