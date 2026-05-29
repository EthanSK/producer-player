import { describe, expect, it } from 'vitest';
import {
  appendBlockquoteToComposerText,
  computeSelectionTooltipPosition,
  formatSelectionAsBlockquote,
  isSelectionInsideContainer,
  MAX_SELECTION_QUOTE_CHARS,
  normalizeSelectionText,
  SELECTION_TOOLTIP_VIEWPORT_MARGIN_PX,
  truncateSelectionForQuote,
} from './agentChatSelection';

// v3.267 — Unit tests for the "floating selection → Add to chat" pure-logic
// helpers. The DOM-coupled UI lives in `AgentChatSelectionTooltip.tsx` and
// `useChatTextSelection.ts`; this file only validates the rect math, text
// normalisation, and blockquote-append rules that drive that UI.

describe('normalizeSelectionText', () => {
  it('returns empty string for whitespace-only input (callers treat as no selection)', () => {
    expect(normalizeSelectionText('')).toBe('');
    expect(normalizeSelectionText('   ')).toBe('');
    expect(normalizeSelectionText('\n\n  \t\n')).toBe('');
  });

  it('strips carriage returns + trims each line', () => {
    expect(normalizeSelectionText('  hello  \r\n  world  ')).toBe('hello\nworld');
  });

  it('collapses runs of internal spaces / tabs on each line', () => {
    expect(normalizeSelectionText('foo    bar\t\tbaz')).toBe('foo bar baz');
  });

  it('preserves single newlines so multi-line blockquotes keep their shape', () => {
    expect(normalizeSelectionText('alpha\nbeta\ngamma')).toBe('alpha\nbeta\ngamma');
  });

  it('drops leading + trailing blank lines but keeps interior blank lines', () => {
    // Interior blank lines mark paragraph breaks inside the original
    // selection — formatSelectionAsBlockquote turns them into bare `>` lines
    // so both Claude and Codex render them as separate paragraphs.
    expect(normalizeSelectionText('\n\nfoo\n\nbar\n\n')).toBe('foo\n\nbar');
  });
});

describe('truncateSelectionForQuote', () => {
  it('passes short selections through unchanged', () => {
    expect(truncateSelectionForQuote('short text')).toBe('short text');
  });

  it('hard-truncates long selections with a clear marker', () => {
    const long = 'x'.repeat(MAX_SELECTION_QUOTE_CHARS + 500);
    const result = truncateSelectionForQuote(long);
    expect(result.length).toBe(MAX_SELECTION_QUOTE_CHARS);
    expect(result.endsWith('…[truncated]')).toBe(true);
  });
});

describe('formatSelectionAsBlockquote', () => {
  it('returns empty string for empty / whitespace selection', () => {
    expect(formatSelectionAsBlockquote('')).toBe('');
    expect(formatSelectionAsBlockquote('   \n   ')).toBe('');
  });

  it('prefixes each non-empty line with `> `', () => {
    expect(formatSelectionAsBlockquote('hello world')).toBe('> hello world');
  });

  it('renders multi-line selection as a multi-line blockquote', () => {
    expect(formatSelectionAsBlockquote('alpha\nbeta')).toBe('> alpha\n> beta');
  });

  it('keeps paragraph breaks (empty lines become bare `>`)', () => {
    // Markdown blockquote convention: a bare `>` line keeps the paragraph
    // break inside the quote block, so the agent sees two paragraphs.
    expect(formatSelectionAsBlockquote('alpha\n\nbeta')).toBe('> alpha\n>\n> beta');
  });

  it('applies the truncation cap on huge selections', () => {
    const long = 'a'.repeat(MAX_SELECTION_QUOTE_CHARS + 1000);
    const result = formatSelectionAsBlockquote(long);
    // Every line has the `> ` prefix so the result length grows; what we
    // care about is that the underlying content was truncated.
    expect(result.includes('…[truncated]')).toBe(true);
  });
});

describe('appendBlockquoteToComposerText', () => {
  it('returns just the blockquote (plus trailing newlines) when existing is empty', () => {
    expect(appendBlockquoteToComposerText('', '> hello')).toBe('> hello\n\n');
  });

  it('returns existing unchanged when blockquote is empty (no-op safety)', () => {
    // We use the trimmed length of the blockquote, so any whitespace-only
    // input also counts as "empty" and must not corrupt the composer.
    expect(appendBlockquoteToComposerText('keep me', '')).toBe('keep me');
    expect(appendBlockquoteToComposerText('keep me', '   \n')).toBe('keep me');
  });

  it('inserts exactly one blank line between existing content and the new quote', () => {
    expect(appendBlockquoteToComposerText('first question', '> quote')).toBe(
      'first question\n\n> quote\n\n',
    );
  });

  it('strips trailing whitespace from existing so we never end up with 3+ blank lines', () => {
    expect(appendBlockquoteToComposerText('first\n\n\n\n', '> quote')).toBe(
      'first\n\n> quote\n\n',
    );
  });

  it('supports the "click Add twice" sequence — each call appends another quote', () => {
    let composer = '';
    composer = appendBlockquoteToComposerText(composer, '> first quote');
    composer = appendBlockquoteToComposerText(composer, '> second quote');
    expect(composer).toBe('> first quote\n\n> second quote\n\n');
  });
});

describe('computeSelectionTooltipPosition', () => {
  const viewport = { width: 1440, height: 900 };
  const tooltip = { width: 120, height: 32 };

  it('centres horizontally above a generic selection in viewport space', () => {
    const selection = {
      top: 400,
      left: 600,
      right: 800,
      bottom: 420,
      width: 200,
      height: 20,
    };
    const pos = computeSelectionTooltipPosition({ selection, tooltip, viewport });
    // Centre: 600 + 100 - 60 = 640
    expect(pos.left).toBe(640);
    // Above selection top with gap: 400 - 32 - 8 = 360
    expect(pos.top).toBe(360);
  });

  it('flips below the selection when above would clip the top of the viewport', () => {
    const selection = {
      top: 10,
      left: 600,
      right: 800,
      bottom: 30,
      width: 200,
      height: 20,
    };
    const pos = computeSelectionTooltipPosition({ selection, tooltip, viewport });
    // Above would be at top: -30 — flip below: 30 + 8 = 38
    expect(pos.top).toBe(38);
  });

  it('clamps horizontally to viewport when selection is near the left edge', () => {
    const selection = {
      top: 400,
      left: -10,
      right: 60,
      bottom: 420,
      width: 70,
      height: 20,
    };
    const pos = computeSelectionTooltipPosition({ selection, tooltip, viewport });
    expect(pos.left).toBe(SELECTION_TOOLTIP_VIEWPORT_MARGIN_PX);
  });

  it('clamps horizontally to viewport when selection is near the right edge', () => {
    const selection = {
      top: 400,
      left: 1400,
      right: 1460,
      bottom: 420,
      width: 60,
      height: 20,
    };
    const pos = computeSelectionTooltipPosition({ selection, tooltip, viewport });
    // max-left = 1440 - 120 - 12 = 1308
    expect(pos.left).toBe(1308);
  });

  it('respects container bounds when supplied (tooltip stays over the chat panel)', () => {
    // Chat panel anchored bottom-right, 380px wide, sitting at viewport
    // right:16. Container left ≈ 1044, right ≈ 1424. A selection inside
    // that container should be horizontally clamped to the container's
    // horizontal range.
    const container = {
      top: 200,
      left: 1044,
      right: 1424,
      bottom: 700,
      width: 380,
      height: 500,
    };
    const selection = {
      top: 400,
      left: 1050,
      right: 1100,
      bottom: 420,
      width: 50,
      height: 20,
    };
    const pos = computeSelectionTooltipPosition({
      selection,
      tooltip,
      viewport,
      container,
    });
    // container.left + margin = 1056 — clamp prevents the tooltip from
    // slipping out of the chat panel's left edge even though the selection
    // is at the panel edge.
    expect(pos.left).toBeGreaterThanOrEqual(1056);
  });

  it('falls back to viewport clamp when container is too narrow for the tooltip', () => {
    // Mobile / tiny window case — container narrower than tooltip + 2*margin.
    // We don't want a NaN / inverted range; we want the tooltip to be visible
    // even if it overflows the container slightly.
    const container = {
      top: 0,
      left: 0,
      right: 80,
      bottom: 200,
      width: 80,
      height: 200,
    };
    const selection = {
      top: 100,
      left: 10,
      right: 60,
      bottom: 120,
      width: 50,
      height: 20,
    };
    const pos = computeSelectionTooltipPosition({
      selection,
      tooltip,
      viewport,
      container,
    });
    // Must not be < margin or > viewport.width - tooltip.width - margin.
    expect(pos.left).toBeGreaterThanOrEqual(SELECTION_TOOLTIP_VIEWPORT_MARGIN_PX);
    expect(pos.left).toBeLessThanOrEqual(
      viewport.width - tooltip.width - SELECTION_TOOLTIP_VIEWPORT_MARGIN_PX,
    );
  });

  it('never lets the tooltip dip below the viewport floor', () => {
    const selection = {
      top: 890,
      left: 600,
      right: 800,
      bottom: 895,
      width: 200,
      height: 5,
    };
    const pos = computeSelectionTooltipPosition({ selection, tooltip, viewport });
    expect(pos.top).toBeLessThanOrEqual(
      viewport.height - tooltip.height - SELECTION_TOOLTIP_VIEWPORT_MARGIN_PX,
    );
  });
});

describe('isSelectionInsideContainer', () => {
  // Build a tiny container stub that emulates the `Node.contains` contract:
  // it has a Set of descendants and returns true only for those.
  function makeContainer(descendants: Set<unknown>): {
    contains(node: { nodeType: number }): boolean;
  } {
    return {
      contains(node) {
        return descendants.has(node);
      },
    };
  }

  it('returns false when container is null (no chat-panel ref yet)', () => {
    const node = { nodeType: 3 };
    expect(
      isSelectionInsideContainer({
        anchorNode: node,
        focusNode: node,
        container: null,
      }),
    ).toBe(false);
  });

  it('returns false when either endpoint is null (empty selection)', () => {
    const container = makeContainer(new Set());
    const node = { nodeType: 3 };
    expect(
      isSelectionInsideContainer({
        anchorNode: null,
        focusNode: node,
        container,
      }),
    ).toBe(false);
    expect(
      isSelectionInsideContainer({
        anchorNode: node,
        focusNode: null,
        container,
      }),
    ).toBe(false);
  });

  it('returns true only when both endpoints are inside the container', () => {
    const inside1 = { nodeType: 3 };
    const inside2 = { nodeType: 3 };
    const outside = { nodeType: 3 };
    const container = makeContainer(new Set([inside1, inside2]));

    expect(
      isSelectionInsideContainer({
        anchorNode: inside1,
        focusNode: inside2,
        container,
      }),
    ).toBe(true);
    expect(
      isSelectionInsideContainer({
        anchorNode: inside1,
        focusNode: outside,
        container,
      }),
    ).toBe(false);
    expect(
      isSelectionInsideContainer({
        anchorNode: outside,
        focusNode: inside2,
        container,
      }),
    ).toBe(false);
  });
});
