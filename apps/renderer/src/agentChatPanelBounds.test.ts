import { describe, expect, it } from 'vitest';
import {
  agentChatBoundsToRect,
  agentChatRectToAnchoredBounds,
  clampAgentChatBounds,
  parseStoredAgentChatBounds,
} from './agentChatPanelBounds';

describe('agent chat panel bounds', () => {
  it('stores and restores explicit panel position as bottom-right offsets', () => {
    const viewport = { width: 1440, height: 900 };
    const rect = { x: 860, y: 220, width: 420, height: 560 };

    const bounds = agentChatRectToAnchoredBounds(rect, viewport);

    expect(bounds).toEqual({
      right: 160,
      bottom: 120,
      width: 420,
      height: 560,
    });
    expect(agentChatBoundsToRect(bounds, viewport)).toEqual(rect);
  });

  it('keeps right and bottom offsets stable when the viewport changes', () => {
    const bounds = { right: 160, bottom: 120, width: 420, height: 560 };

    const smallerRect = agentChatBoundsToRect(bounds, {
      width: 1180,
      height: 760,
    });
    const restoredBounds = agentChatRectToAnchoredBounds(smallerRect, {
      width: 1180,
      height: 760,
    });

    expect(smallerRect).toEqual({
      x: 600,
      y: 80,
      width: 420,
      height: 560,
    });
    expect(restoredBounds.right).toBe(160);
    expect(restoredBounds.bottom).toBe(120);
  });

  it('migrates legacy top-left bounds to bottom-right offsets', () => {
    const migrated = parseStoredAgentChatBounds(
      JSON.stringify({ x: 80, y: 90, width: 420, height: 540 }),
      { width: 1440, height: 900 }
    );

    expect(migrated).toEqual({
      right: 940,
      bottom: 270,
      width: 420,
      height: 540,
    });
  });

  it('clamps only the display position when saved offsets exceed the viewport', () => {
    const saved = { right: 900, bottom: 400, width: 420, height: 540 };
    const clamped = clampAgentChatBounds(saved, { width: 700, height: 620 });

    expect(clamped).toEqual({
      right: 280,
      bottom: 80,
      width: 420,
      height: 540,
    });
    expect(saved).toEqual({
      right: 900,
      bottom: 400,
      width: 420,
      height: 540,
    });
  });
});
