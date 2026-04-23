export const AGENT_CHAT_BOUNDS_STORAGE_KEY = 'producer-player.agent-chat-bounds.v1';
export const AGENT_CHAT_MIN_WIDTH = 280;
export const AGENT_CHAT_MIN_HEIGHT = 200;
export const AGENT_CHAT_DEFAULT_WIDTH = 380;
export const AGENT_CHAT_DEFAULT_HEIGHT = 520;

export interface AgentChatPanelBounds {
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface AgentChatPanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AgentChatViewport {
  width: number;
  height: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function sanitizeAgentChatBounds(
  bounds: AgentChatPanelBounds
): AgentChatPanelBounds {
  return {
    right: Math.max(0, bounds.right),
    bottom: Math.max(0, bounds.bottom),
    width: Math.max(AGENT_CHAT_MIN_WIDTH, bounds.width),
    height: Math.max(AGENT_CHAT_MIN_HEIGHT, bounds.height),
  };
}

export function agentChatRectToAnchoredBounds(
  rect: AgentChatPanelRect,
  viewport: AgentChatViewport
): AgentChatPanelBounds {
  return sanitizeAgentChatBounds({
    right: viewport.width - rect.x - rect.width,
    bottom: viewport.height - rect.y - rect.height,
    width: rect.width,
    height: rect.height,
  });
}

export function agentChatBoundsToRect(
  bounds: AgentChatPanelBounds,
  viewport: AgentChatViewport
): AgentChatPanelRect {
  const sanitized = sanitizeAgentChatBounds(bounds);
  return {
    x: viewport.width - sanitized.right - sanitized.width,
    y: viewport.height - sanitized.bottom - sanitized.height,
    width: sanitized.width,
    height: sanitized.height,
  };
}

/**
 * Clamp bounds for display in the current viewport.
 *
 * Persisted bounds stay anchored to bottom-right offsets. When a viewport is
 * temporarily too small, only the displayed bounds clamp; the stored offsets
 * can still resume when the window grows again.
 */
export function clampAgentChatBounds(
  bounds: AgentChatPanelBounds,
  viewport: AgentChatViewport
): AgentChatPanelBounds {
  const sanitized = sanitizeAgentChatBounds(bounds);
  const maxWidth = Math.max(AGENT_CHAT_MIN_WIDTH, viewport.width);
  const maxHeight = Math.max(AGENT_CHAT_MIN_HEIGHT, viewport.height);
  const width = Math.min(maxWidth, sanitized.width);
  const height = Math.min(maxHeight, sanitized.height);
  const maxRight = Math.max(0, viewport.width - width);
  const maxBottom = Math.max(0, viewport.height - height);
  const right = Math.min(sanitized.right, maxRight);
  const bottom = Math.min(sanitized.bottom, maxBottom);
  return { right, bottom, width, height };
}

export function parseStoredAgentChatBounds(
  raw: string | null,
  viewport: AgentChatViewport
): AgentChatPanelBounds | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<
      AgentChatPanelBounds & AgentChatPanelRect
    >;
    if (
      isFiniteNumber(parsed.right) &&
      isFiniteNumber(parsed.bottom) &&
      isFiniteNumber(parsed.width) &&
      isFiniteNumber(parsed.height)
    ) {
      return sanitizeAgentChatBounds({
        right: parsed.right,
        bottom: parsed.bottom,
        width: parsed.width,
        height: parsed.height,
      });
    }
    if (
      isFiniteNumber(parsed.x) &&
      isFiniteNumber(parsed.y) &&
      isFiniteNumber(parsed.width) &&
      isFiniteNumber(parsed.height)
    ) {
      return clampAgentChatBounds(
        agentChatRectToAnchoredBounds(
          {
            x: parsed.x,
            y: parsed.y,
            width: parsed.width,
            height: parsed.height,
          },
          viewport
        ),
        viewport
      );
    }
    return null;
  } catch {
    return null;
  }
}
