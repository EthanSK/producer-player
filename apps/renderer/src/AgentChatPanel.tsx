import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type {
  AgentAttachment,
  AgentContext,
  AgentConversationHistoryEntry,
  AgentEvent,
  AgentModelId,
  AgentProviderId,
  AgentThinkingEffort,
  AgentTokenUsage,
} from '@producer-player/contracts';
import { AgentComposer } from './AgentComposer';
import { AgentSettings } from './AgentSettings';
import {
  captureAgentUiContext,
  DEFAULT_AGENT_SYSTEM_PROMPT,
  AGENT_SYSTEM_PROMPT_STORAGE_KEY,
  readStoredAgentSystemPrompt,
} from './agentPrompts';
import {
  AGENT_MODEL_OPTIONS_BY_PROVIDER,
  AGENT_THINKING_OPTIONS,
  DEFAULT_AGENT_MODEL_BY_PROVIDER,
  DEFAULT_AGENT_THINKING_BY_PROVIDER,
} from './agentModels';

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  status?: 'streaming' | 'complete' | 'stopped' | 'error';
  usage?: AgentTokenUsage;
}

export interface AgentChatPromptRequest {
  id: string;
  prompt: string;
}

interface AgentChatPanelProps {
  getAnalysisContext: () => AgentContext | null;
  promptRequest?: AgentChatPromptRequest | null;
}

interface StoredLegacyActiveChat {
  id: string;
  messages: AgentChatMessage[];
}

interface AgentChatHistoryEntry {
  id: string;
  title: string;
  updatedAt: number;
  messages: AgentChatMessage[];
}

interface StoredAgentChatPersistence {
  activeConversationId: string;
  activeMessages: AgentChatMessage[];
  history: AgentChatHistoryEntry[];
}

const STARTER_PROMPTS = [
  'How is my loudness?',
  'Compare to reference',
  'Check for clipping',
  'Is this ready for Spotify?',
];

const EMPTY_CHAT_SETUP_STEPS = [
  'Install Claude Code or Codex CLI.',
  'Sign in with your CLI subscription (for example, `claude auth` or `codex login`).',
  'Open settings to choose provider, model, and thinking level.',
  'Optional: add a Deepgram or AssemblyAI key to enable microphone transcription.',
];

const APP_TUTORIAL_SOURCE_LINKS = [
  {
    label: 'Producer Player GitHub repo',
    url: 'https://github.com/EthanSK/producer-player',
  },
  {
    label: 'README walkthrough (main branch)',
    url: 'https://github.com/EthanSK/producer-player/blob/main/README.md',
  },
  {
    label: 'Published docs / guide site',
    url: 'https://ethansk.github.io/producer-player/',
  },
] as const;

const AGENT_PROVIDER_STORAGE_KEY = 'producer-player.agent-provider';
const AGENT_MODEL_STORAGE_PREFIX = 'producer-player.agent-model.';
const AGENT_THINKING_STORAGE_PREFIX = 'producer-player.agent-thinking.';
const AGENT_PANEL_SEEN_STORAGE_KEY = 'producer-player.agent-panel-seen';
const AGENT_PANEL_ONBOARDING_ARMED_STORAGE_KEY =
  'producer-player.agent-panel-onboarding-armed';
const AGENT_ACTIVE_CHAT_STORAGE_KEY = 'producer-player.agent-chat-active.v1';
const AGENT_CHAT_HISTORY_STORAGE_KEY = 'producer-player.agent-chat-history.v1';
const AGENT_CHAT_PERSISTENCE_STORAGE_KEY = 'producer-player.agent-chat-persistence.v2';
const AGENT_AUTO_OPEN_DELAY_DEFAULT_MS = 2 * 60 * 1000;
const AGENT_AUTO_OPEN_DELAY_TEST_MS = 1200;
const AGENT_CHAT_HISTORY_LIMIT = 20;
const MAX_AGENT_ATTACHMENTS_PER_TURN = 10;

/**
 * v3.25 — drag-to-move + drag-to-resize for the agent chat panel.
 *
 * Bounds are persisted in localStorage under this key. The value is {x, y,
 * width, height}. If unset, the panel falls back to the legacy CSS-driven
 * default position (anchored bottom-right). Once the user drags or resizes,
 * the panel switches into "positioned" mode and uses explicit top/left.
 *
 * Minimum size is intentionally generous enough to show the header plus a
 * line of chat; maximum is the current viewport.
 */
export const AGENT_CHAT_BOUNDS_STORAGE_KEY = 'producer-player.agent-chat-bounds.v1';
const AGENT_CHAT_MIN_WIDTH = 280;
const AGENT_CHAT_MIN_HEIGHT = 200;
const AGENT_CHAT_DEFAULT_WIDTH = 380;
const AGENT_CHAT_DEFAULT_HEIGHT = 520;

export interface AgentChatPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type AgentChatResizeEdge =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

function readStoredAgentChatBounds(): AgentChatPanelBounds | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AGENT_CHAT_BOUNDS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgentChatPanelBounds>;
    if (
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number' ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y) ||
      !Number.isFinite(parsed.width) ||
      !Number.isFinite(parsed.height)
    ) {
      return null;
    }
    return {
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
    };
  } catch {
    return null;
  }
}

function writeStoredAgentChatBounds(bounds: AgentChatPanelBounds | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (bounds === null) {
      window.localStorage.removeItem(AGENT_CHAT_BOUNDS_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      AGENT_CHAT_BOUNDS_STORAGE_KEY,
      JSON.stringify(bounds)
    );
  } catch {
    // Ignore quota / serialization errors — best-effort persistence.
  }
}

/**
 * Clamp bounds so the panel stays within viewport + respects min size.
 * The panel's top-left corner can never go above/left of 0, and the
 * bottom-right corner can never exceed the viewport's inner width/height.
 */
function clampAgentChatBounds(
  bounds: AgentChatPanelBounds,
  viewportWidth: number,
  viewportHeight: number
): AgentChatPanelBounds {
  const maxWidth = Math.max(AGENT_CHAT_MIN_WIDTH, viewportWidth);
  const maxHeight = Math.max(AGENT_CHAT_MIN_HEIGHT, viewportHeight);
  const width = Math.min(
    maxWidth,
    Math.max(AGENT_CHAT_MIN_WIDTH, bounds.width)
  );
  const height = Math.min(
    maxHeight,
    Math.max(AGENT_CHAT_MIN_HEIGHT, bounds.height)
  );
  const x = Math.max(0, Math.min(bounds.x, viewportWidth - width));
  const y = Math.max(0, Math.min(bounds.y, viewportHeight - height));
  return { x, y, width, height };
}

export const OPEN_AGENT_SETTINGS_EVENT = 'producer-player:open-agent-settings';

/**
 * A DataTransfer drag is relevant to the file-drop overlay only when the drag
 * contains at least one "Files" item. This lets us ignore purely text drags
 * (e.g. dragging selected text inside the renderer for the panel-reorder
 * handlers) so we don't flash the drop overlay during normal interactions.
 */
function eventHasFiles(event: React.DragEvent<HTMLElement>): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `msg-${messageIdCounter}-${Date.now()}`;
}

function createConversationId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStoredProvider(): AgentProviderId {
  const stored = localStorage.getItem(AGENT_PROVIDER_STORAGE_KEY);
  return stored === 'codex' ? 'codex' : 'claude';
}

function readStoredModel(provider: AgentProviderId): AgentModelId {
  const stored = localStorage.getItem(`${AGENT_MODEL_STORAGE_PREFIX}${provider}`)?.trim();
  return stored && stored.length > 0
    ? stored
    : DEFAULT_AGENT_MODEL_BY_PROVIDER[provider];
}

function readStoredThinking(provider: AgentProviderId): AgentThinkingEffort {
  const stored = localStorage.getItem(`${AGENT_THINKING_STORAGE_PREFIX}${provider}`)?.trim();
  return stored === 'low' || stored === 'medium' || stored === 'high'
    ? stored
    : DEFAULT_AGENT_THINKING_BY_PROVIDER[provider];
}

function sanitizeTokenUsage(value: unknown): AgentTokenUsage | undefined {
  if (!isRecord(value)) return undefined;

  const inputTokens = typeof value.inputTokens === 'number' ? value.inputTokens : undefined;
  const outputTokens = typeof value.outputTokens === 'number' ? value.outputTokens : undefined;
  const cacheReadTokens =
    typeof value.cacheReadTokens === 'number' ? value.cacheReadTokens : undefined;

  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
  };
}

function sanitizeStoredMessage(value: unknown): AgentChatMessage | null {
  if (!isRecord(value)) return null;

  const role = value.role;
  if (role !== 'user' && role !== 'agent' && role !== 'system') {
    return null;
  }

  const content = typeof value.content === 'string' ? value.content : '';
  const timestamp =
    typeof value.timestamp === 'number' && Number.isFinite(value.timestamp)
      ? value.timestamp
      : Date.now();
  const id =
    typeof value.id === 'string' && value.id.trim().length > 0
      ? value.id
      : nextMessageId();

  const statusRaw = value.status;
  const status =
    statusRaw === 'streaming' ||
    statusRaw === 'complete' ||
    statusRaw === 'stopped' ||
    statusRaw === 'error'
      ? statusRaw
      : undefined;

  const usage = sanitizeTokenUsage(value.usage);

  return {
    id,
    role,
    content,
    timestamp,
    ...(status ? { status } : {}),
    ...(usage ? { usage } : {}),
  };
}

function normalizeMessagesForPersistence(messages: AgentChatMessage[]): AgentChatMessage[] {
  return messages.map((message) =>
    message.status === 'streaming'
      ? { ...message, status: 'stopped' }
      : message
  );
}

function sanitizeStoredMessages(value: unknown): AgentChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => sanitizeStoredMessage(entry))
    .filter((entry): entry is AgentChatMessage => entry !== null)
    .map((entry) =>
      entry.status === 'streaming' ? { ...entry, status: 'stopped' } : entry
    );
}

function readStoredLegacyActiveChat(): StoredLegacyActiveChat {
  const fallback: StoredLegacyActiveChat = {
    id: createConversationId(),
    messages: [],
  };

  const raw = localStorage.getItem(AGENT_ACTIVE_CHAT_STORAGE_KEY);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return fallback;

    const id =
      typeof parsed.id === 'string' && parsed.id.trim().length > 0
        ? parsed.id
        : fallback.id;

    const messages = sanitizeStoredMessages(parsed.messages);

    return {
      id,
      messages,
    };
  } catch {
    return fallback;
  }
}

function sanitizeStoredHistoryEntry(value: unknown): AgentChatHistoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const messages = sanitizeStoredMessages(value.messages);
  if (messages.length === 0) {
    return null;
  }

  const id =
    typeof value.id === 'string' && value.id.trim().length > 0
      ? value.id
      : createConversationId();
  const title =
    typeof value.title === 'string' && value.title.trim().length > 0
      ? value.title
      : buildHistoryTitle(messages);
  const updatedAt =
    typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
      ? value.updatedAt
      : Math.max(...messages.map((message) => message.timestamp), Date.now());

  return {
    id,
    title,
    updatedAt,
    messages: normalizeMessagesForPersistence(messages),
  };
}

function normalizeChatHistory(
  history: AgentChatHistoryEntry[],
  activeConversationId: string
): AgentChatHistoryEntry[] {
  const byId = new Map<string, AgentChatHistoryEntry>();

  for (const entry of history) {
    if (entry.messages.length === 0) {
      continue;
    }

    const normalizedEntry: AgentChatHistoryEntry = {
      ...entry,
      title: entry.title.trim().length > 0 ? entry.title : buildHistoryTitle(entry.messages),
      updatedAt:
        Number.isFinite(entry.updatedAt) && entry.updatedAt > 0
          ? entry.updatedAt
          : Math.max(...entry.messages.map((message) => message.timestamp), Date.now()),
      messages: normalizeMessagesForPersistence(entry.messages),
    };

    const existing = byId.get(normalizedEntry.id);
    if (!existing || normalizedEntry.updatedAt >= existing.updatedAt) {
      byId.set(normalizedEntry.id, normalizedEntry);
    }
  }

  const sorted = [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt);

  if (sorted.length <= AGENT_CHAT_HISTORY_LIMIT) {
    return sorted;
  }

  const activeIndex = sorted.findIndex((entry) => entry.id === activeConversationId);
  if (activeIndex < 0 || activeIndex < AGENT_CHAT_HISTORY_LIMIT) {
    return sorted.slice(0, AGENT_CHAT_HISTORY_LIMIT);
  }

  return [...sorted.slice(0, AGENT_CHAT_HISTORY_LIMIT - 1), sorted[activeIndex]].sort(
    (left, right) => right.updatedAt - left.updatedAt
  );
}

function readStoredLegacyChatHistory(): AgentChatHistoryEntry[] {
  const raw = localStorage.getItem(AGENT_CHAT_HISTORY_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const entries = parsed
      .map((entry) => sanitizeStoredHistoryEntry(entry))
      .filter((entry): entry is AgentChatHistoryEntry => entry !== null);

    return normalizeChatHistory(entries, '');
  } catch {
    return [];
  }
}

function createHistoryEntryFromConversation(
  conversationId: string,
  messages: AgentChatMessage[]
): AgentChatHistoryEntry {
  const normalizedMessages = normalizeMessagesForPersistence(messages);
  const updatedAt = Math.max(
    ...normalizedMessages.map((message) => message.timestamp),
    Date.now()
  );

  return {
    id: conversationId,
    title: buildHistoryTitle(normalizedMessages),
    updatedAt,
    messages: normalizedMessages,
  };
}

function upsertChatHistoryEntry(
  history: AgentChatHistoryEntry[],
  entry: AgentChatHistoryEntry,
  activeConversationId: string
): AgentChatHistoryEntry[] {
  return normalizeChatHistory(
    [entry, ...history.filter((existingEntry) => existingEntry.id !== entry.id)],
    activeConversationId
  );
}

function writeStoredChatPersistence(state: StoredAgentChatPersistence): void {
  const baseHistory = normalizeChatHistory(state.history, state.activeConversationId);
  const nextHistory =
    state.activeMessages.length > 0
      ? upsertChatHistoryEntry(
          baseHistory,
          createHistoryEntryFromConversation(
            state.activeConversationId,
            state.activeMessages
          ),
          state.activeConversationId
        )
      : baseHistory;

  const payload = {
    version: 2,
    activeConversationId: state.activeConversationId,
    history: nextHistory.map((entry) => ({
      ...entry,
      messages: normalizeMessagesForPersistence(entry.messages),
    })),
  };

  try {
    localStorage.setItem(AGENT_CHAT_PERSISTENCE_STORAGE_KEY, JSON.stringify(payload));
  } catch (error: unknown) {
    console.warn('[producer-player:agent-chat] could not persist chat history', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function readStoredChatPersistence(): StoredAgentChatPersistence {
  const raw = localStorage.getItem(AGENT_CHAT_PERSISTENCE_STORAGE_KEY);

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;

      if (isRecord(parsed) && parsed.version === 2) {
        const activeConversationId =
          typeof parsed.activeConversationId === 'string' &&
          parsed.activeConversationId.trim().length > 0
            ? parsed.activeConversationId
            : createConversationId();

        const storedHistory = Array.isArray(parsed.history)
          ? parsed.history
              .map((entry) => sanitizeStoredHistoryEntry(entry))
              .filter((entry): entry is AgentChatHistoryEntry => entry !== null)
          : [];

        const history = normalizeChatHistory(storedHistory, activeConversationId);
        const activeMessages =
          history.find((entry) => entry.id === activeConversationId)?.messages ?? [];

        return {
          activeConversationId,
          activeMessages,
          history,
        };
      }
    } catch {
      // Fall through to legacy migration.
    }
  }

  const legacyActiveChat = readStoredLegacyActiveChat();
  let history = normalizeChatHistory(readStoredLegacyChatHistory(), legacyActiveChat.id);

  if (legacyActiveChat.messages.length > 0) {
    history = upsertChatHistoryEntry(
      history,
      createHistoryEntryFromConversation(legacyActiveChat.id, legacyActiveChat.messages),
      legacyActiveChat.id
    );
  }

  const migratedState: StoredAgentChatPersistence = {
    activeConversationId: legacyActiveChat.id,
    activeMessages: legacyActiveChat.messages,
    history,
  };

  writeStoredChatPersistence(migratedState);
  return migratedState;
}

function buildHistoryTitle(messages: AgentChatMessage[]): string {
  const firstUserMessage = messages.find(
    (message) => message.role === 'user' && message.content.trim().length > 0
  );
  const fallbackMessage = messages.find((message) => message.content.trim().length > 0);

  const source = firstUserMessage?.content ?? fallbackMessage?.content;
  if (!source) {
    return 'Untitled chat';
  }

  const trimmed = source.trim().replace(/\s+/g, ' ');
  return trimmed.length > 64 ? `${trimmed.slice(0, 61)}...` : trimmed;
}

function buildHistorySeed(messages: AgentChatMessage[]): AgentConversationHistoryEntry[] {
  return messages
    .filter(
      (message) =>
        (message.role === 'user' || message.role === 'agent') &&
        message.content.trim().length > 0
    )
    .map((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: message.content,
    }));
}

export function AgentChatPanel({
  getAnalysisContext,
  promptRequest = null,
}: AgentChatPanelProps): JSX.Element {
  const initialChatPersistenceRef = useRef<StoredAgentChatPersistence>(
    readStoredChatPersistence()
  );

  const [isOpen, setIsOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState(
    initialChatPersistenceRef.current.activeConversationId
  );
  const [messages, setMessages] = useState<AgentChatMessage[]>(
    initialChatPersistenceRef.current.activeMessages
  );
  const [chatHistory, setChatHistory] = useState<AgentChatHistoryEntry[]>(
    initialChatPersistenceRef.current.history
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sessionActive, setSessionActive] = useState(false);
  const [provider, setProvider] = useState<AgentProviderId>(() => readStoredProvider());
  const [modelByProvider, setModelByProvider] = useState<
    Record<AgentProviderId, AgentModelId>
  >(() => ({
    claude: readStoredModel('claude'),
    codex: readStoredModel('codex'),
  }));
  const [thinkingByProvider, setThinkingByProvider] = useState<
    Record<AgentProviderId, AgentThinkingEffort>
  >(() => ({
    claude: readStoredThinking('claude'),
    codex: readStoredThinking('codex'),
  }));
  const [systemPrompt, setSystemPrompt] = useState<string>(() =>
    readStoredAgentSystemPrompt()
  );
  const [providerAvailable, setProviderAvailable] = useState<boolean | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shouldRunFirstLaunchOnboarding] = useState(() => {
    const alreadySeen = localStorage.getItem(AGENT_PANEL_SEEN_STORAGE_KEY) === 'true';
    const onboardingAlreadyArmed =
      localStorage.getItem(AGENT_PANEL_ONBOARDING_ARMED_STORAGE_KEY) === 'true';

    if (alreadySeen || onboardingAlreadyArmed) {
      return false;
    }

    localStorage.setItem(AGENT_PANEL_ONBOARDING_ARMED_STORAGE_KEY, 'true');
    return true;
  });
  const [autoOpenDelayMs, setAutoOpenDelayMs] = useState<number | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<{
    approvalId: string;
    toolName: string;
    description: string;
  } | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<AgentAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragEnterCountRef = useRef(0);

  // v3.25 — floating panel bounds. `null` = use default CSS position.
  //
  // On initial mount we clamp any persisted bounds against the current
  // viewport — otherwise, if the user saved bounds on a larger monitor
  // and then opened the app on a smaller one, the panel could land fully
  // offscreen with no way to grab the header to drag it back. The
  // `window.addEventListener('resize')` effect below handles post-mount
  // viewport shrinks; this initializer handles the first paint.
  const [panelBounds, setPanelBounds] = useState<AgentChatPanelBounds | null>(
    () => {
      const stored = readStoredAgentChatBounds();
      if (!stored) return null;
      if (typeof window === 'undefined') return stored;
      return clampAgentChatBounds(
        stored,
        window.innerWidth,
        window.innerHeight
      );
    }
  );
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  // Track viewport height in state so the minimized transform for a
  // positioned panel recomputes on every resize — not only on resizes that
  // actually re-clamp the bounds (which is what the other effect handles).
  // Codex-reviewed 2026-04-18.
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );
  const panelRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const panelBoundsRef = useRef<AgentChatPanelBounds | null>(panelBounds);
  panelBoundsRef.current = panelBounds;

  const timelineRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef(false);
  const streamingMessageIdRef = useRef<string | null>(null);
  const onboardingScheduledRef = useRef(false);
  const lastHandledPromptRequestIdRef = useRef<string | null>(null);
  const ignoredTurnCompleteCountRef = useRef(0);
  const isOpenRef = useRef(isOpen);

  isOpenRef.current = isOpen;

  // Persist bounds changes to localStorage whenever they change. null clears.
  useEffect(() => {
    writeStoredAgentChatBounds(panelBounds);
  }, [panelBounds]);

  // On viewport resize, re-clamp the panel so it can't be stranded offscreen
  // AND update viewportHeight state so the minimized-positioned transform
  // recomputes even when the bounds themselves don't change.
  useEffect(() => {
    function handleWindowResize(): void {
      setViewportHeight(window.innerHeight);
      setPanelBounds((current) => {
        if (!current) return current;
        const clamped = clampAgentChatBounds(
          current,
          window.innerWidth,
          window.innerHeight
        );
        if (
          clamped.x === current.x &&
          clamped.y === current.y &&
          clamped.width === current.width &&
          clamped.height === current.height
        ) {
          return current;
        }
        return clamped;
      });
    }
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  // Toggle the body class while dragging/resizing so other content can opt
  // out of hover effects. Also suppresses text selection inside the panel.
  useEffect(() => {
    const active = isPanelDragging || isPanelResizing;
    if (active) {
      document.body.classList.add('agent-chat-panel-dragging');
    } else {
      document.body.classList.remove('agent-chat-panel-dragging');
    }
    return () => {
      document.body.classList.remove('agent-chat-panel-dragging');
    };
  }, [isPanelDragging, isPanelResizing]);

  /**
   * Begin a drag-to-move from the header. We only start a drag when the
   * pointerdown originated from the header itself (or the heading copy /
   * avatar) and not from any of the header buttons. This lets users still
   * click settings/close/etc. without triggering a drag.
   */
  const handleHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      // Only primary button / primary pointer.
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      // Skip if the pointer is on an interactive child (button, input).
      if (target && target.closest('button, input, textarea, select, a')) {
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;

      event.preventDefault();

      // Snapshot the panel's *current* bounds on screen. If the panel has
      // never been moved, this captures the CSS-driven default position so
      // the first drag feels continuous.
      const rect = panel.getBoundingClientRect();
      const startBounds: AgentChatPanelBounds = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };
      const startX = event.clientX;
      const startY = event.clientY;

      setIsPanelDragging(true);
      setPanelBounds(startBounds);

      function onMove(e: PointerEvent): void {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const next = clampAgentChatBounds(
          {
            x: startBounds.x + dx,
            y: startBounds.y + dy,
            width: startBounds.width,
            height: startBounds.height,
          },
          window.innerWidth,
          window.innerHeight
        );
        setPanelBounds(next);
      }

      function onEnd(): void {
        setIsPanelDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    []
  );

  /**
   * Begin a resize from one of the eight resize handles. Each edge/corner
   * adjusts a subset of {x, y, width, height}. The math mirrors the AMVS
   * prototype — deltas are applied against the starting bounds, then clamped
   * to the viewport with a min-size floor.
   */
  const startResize = useCallback(
    (edge: AgentChatResizeEdge, event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return;
      const panel = panelRef.current;
      if (!panel) return;

      event.preventDefault();
      event.stopPropagation();

      const rect = panel.getBoundingClientRect();
      const startBounds: AgentChatPanelBounds = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };
      const startX = event.clientX;
      const startY = event.clientY;

      setIsPanelResizing(true);
      setPanelBounds(startBounds);

      function onMove(e: PointerEvent): void {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let nx = startBounds.x;
        let ny = startBounds.y;
        let nw = startBounds.width;
        let nh = startBounds.height;

        switch (edge) {
          case 'top': {
            nh = startBounds.height - dy;
            ny = startBounds.y + dy;
            break;
          }
          case 'right': {
            nw = startBounds.width + dx;
            break;
          }
          case 'bottom': {
            nh = startBounds.height + dy;
            break;
          }
          case 'left': {
            nw = startBounds.width - dx;
            nx = startBounds.x + dx;
            break;
          }
          case 'top-left': {
            nw = startBounds.width - dx;
            nh = startBounds.height - dy;
            nx = startBounds.x + dx;
            ny = startBounds.y + dy;
            break;
          }
          case 'top-right': {
            nw = startBounds.width + dx;
            nh = startBounds.height - dy;
            ny = startBounds.y + dy;
            break;
          }
          case 'bottom-left': {
            nw = startBounds.width - dx;
            nh = startBounds.height + dy;
            nx = startBounds.x + dx;
            break;
          }
          case 'bottom-right': {
            nw = startBounds.width + dx;
            nh = startBounds.height + dy;
            break;
          }
        }

        // Re-anchor the opposite edge if min-size clamping kicks in, so the
        // panel doesn't "jump" when the user drags past the min.
        if (nw < AGENT_CHAT_MIN_WIDTH) {
          const overflow = AGENT_CHAT_MIN_WIDTH - nw;
          nw = AGENT_CHAT_MIN_WIDTH;
          if (edge === 'left' || edge === 'top-left' || edge === 'bottom-left') {
            nx = nx - overflow;
          }
        }
        if (nh < AGENT_CHAT_MIN_HEIGHT) {
          const overflow = AGENT_CHAT_MIN_HEIGHT - nh;
          nh = AGENT_CHAT_MIN_HEIGHT;
          if (edge === 'top' || edge === 'top-left' || edge === 'top-right') {
            ny = ny - overflow;
          }
        }

        const next = clampAgentChatBounds(
          { x: nx, y: ny, width: nw, height: nh },
          window.innerWidth,
          window.innerHeight
        );
        setPanelBounds(next);
      }

      function onEnd(): void {
        setIsPanelResizing(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    []
  );

  /**
   * Reset bounds to the default (CSS-driven bottom-right). Used by a
   * double-click on the header as a nice "escape hatch" when the panel
   * ends up in a weird spot.
   */
  const resetPanelBounds = useCallback((): void => {
    setPanelBounds(null);
  }, []);

  const handleHeaderDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      // Ignore double-clicks on interactive children so button double-clicks
      // don't accidentally trigger a reset.
      const target = event.target as HTMLElement | null;
      if (target && target.closest('button, input, textarea, select, a')) {
        return;
      }
      resetPanelBounds();
    },
    [resetPanelBounds]
  );

  const availableModels = AGENT_MODEL_OPTIONS_BY_PROVIDER[provider];
  const currentModel = availableModels.some((option) => option.id === modelByProvider[provider])
    ? modelByProvider[provider]
    : DEFAULT_AGENT_MODEL_BY_PROVIDER[provider];
  const currentThinking =
    thinkingByProvider[provider] ?? DEFAULT_AGENT_THINKING_BY_PROVIDER[provider];
  const effectiveSystemPrompt = systemPrompt.trim() || DEFAULT_AGENT_SYSTEM_PROMPT;

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    const entry = createHistoryEntryFromConversation(activeConversationId, messages);
    setChatHistory((prev) => upsertChatHistoryEntry(prev, entry, activeConversationId));
  }, [activeConversationId, messages]);

  useEffect(() => {
    writeStoredChatPersistence({
      activeConversationId,
      activeMessages: messages,
      history: chatHistory,
    });
  }, [activeConversationId, chatHistory, messages]);

  useEffect(() => {
    if (!isOpen) return;
    void window.producerPlayer.agentCheckProvider(provider).then((available) => {
      setProviderAvailable(available);
    });
  }, [isOpen, provider]);

  useEffect(() => {
    let alive = true;

    void window.producerPlayer
      .getEnvironment()
      .then((environment) => {
        if (!alive) return;
        setAutoOpenDelayMs(
          environment.isTestMode
            ? AGENT_AUTO_OPEN_DELAY_TEST_MS
            : AGENT_AUTO_OPEN_DELAY_DEFAULT_MS
        );
      })
      .catch(() => {
        if (!alive) return;
        setAutoOpenDelayMs(AGENT_AUTO_OPEN_DELAY_DEFAULT_MS);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (
      !shouldRunFirstLaunchOnboarding ||
      isOpen ||
      onboardingScheduledRef.current ||
      autoOpenDelayMs === null
    ) {
      return;
    }

    onboardingScheduledRef.current = true;
    const timeoutId = window.setTimeout(() => {
      setIsOpen(true);
      localStorage.setItem(AGENT_PANEL_SEEN_STORAGE_KEY, 'true');
    }, autoOpenDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [autoOpenDelayMs, isOpen, shouldRunFirstLaunchOnboarding]);

  const scrollToBottom = useCallback(() => {
    if (timelineRef.current && !userScrolledUpRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, historyOpen, scrollToBottom]);

  const handleTimelineScroll = useCallback(() => {
    const el = timelineRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    userScrolledUpRef.current = !atBottom;
  }, []);

  useEffect(() => {
    const unsubscribe = window.producerPlayer.onAgentEvent((event: AgentEvent) => {
      switch (event.type) {
        case 'text-delta': {
          const streamId = streamingMessageIdRef.current;
          if (!streamId) {
            const newId = nextMessageId();
            streamingMessageIdRef.current = newId;
            setMessages((prev) => [
              ...prev,
              {
                id: newId,
                role: 'agent',
                content: event.content,
                timestamp: Date.now(),
                status: 'streaming',
              },
            ]);
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId ? { ...m, content: m.content + event.content } : m
              )
            );
          }
          break;
        }

        case 'turn-complete': {
          if (ignoredTurnCompleteCountRef.current > 0) {
            ignoredTurnCompleteCountRef.current -= 1;
            break;
          }

          const completedId = streamingMessageIdRef.current;
          streamingMessageIdRef.current = null;
          setIsStreaming(false);
          if (completedId && !isOpenRef.current) {
            setUnreadCount((prev) => prev + 1);
          }
          if (completedId) {
            setMessages((prev) => {
              const next = prev.map((m) => {
                if (m.id !== completedId) {
                  return m;
                }

                return {
                  ...m,
                  status: 'complete' as const,
                  ...(event.usage ? { usage: event.usage } : {}),
                };
              });

              return next.filter(
                (m) => !(m.id === completedId && m.role === 'agent' && m.content.length === 0)
              );
            });
          }
          break;
        }

        case 'error': {
          const erroredId = streamingMessageIdRef.current;
          streamingMessageIdRef.current = null;
          setIsStreaming(false);
          setMessages((prev) => {
            const next = erroredId
              ? prev.map((m) =>
                  m.id === erroredId ? { ...m, status: 'error' as const } : m
                )
              : prev;

            return [
              ...next,
              {
                id: nextMessageId(),
                role: 'system',
                content: `Error: ${event.message}`,
                timestamp: Date.now(),
                status: 'error',
              },
            ];
          });
          break;
        }

        case 'approval-request': {
          setApprovalRequest({
            approvalId: event.approvalId,
            toolName: event.toolName,
            description: event.description,
          });
          break;
        }

        case 'session-ended': {
          setSessionActive(false);
          setIsStreaming(false);
          streamingMessageIdRef.current = null;
          ignoredTurnCompleteCountRef.current = 0;
          break;
        }

        default:
          break;
      }
    });

    return unsubscribe;
  }, []);

  const resetActiveSession = useCallback(() => {
    if (sessionActive) {
      void window.producerPlayer.agentDestroySession();
      setSessionActive(false);
    }
    streamingMessageIdRef.current = null;
    ignoredTurnCompleteCountRef.current = 0;
    setIsStreaming(false);
  }, [sessionActive]);

  const handleNewChat = useCallback(() => {
    resetActiveSession();
    setMessages([]);
    setActiveConversationId(createConversationId());
    setHistoryOpen(false);
    userScrolledUpRef.current = false;
  }, [resetActiveSession]);

  const handleRestoreHistory = useCallback(
    (conversationId: string) => {
      const selected = chatHistory.find((entry) => entry.id === conversationId);
      if (!selected) return;

      resetActiveSession();
      setMessages(normalizeMessagesForPersistence(selected.messages));
      setActiveConversationId(selected.id);
      setHistoryOpen(false);
      setHelpDialogOpen(false);
      userScrolledUpRef.current = false;
    },
    [chatHistory, resetActiveSession]
  );

  const handleDeleteHistoryEntry = useCallback(
    (conversationId: string) => {
      setChatHistory((prev) =>
        normalizeChatHistory(
          prev.filter((entry) => entry.id !== conversationId),
          activeConversationId
        )
      );

      if (conversationId === activeConversationId) {
        resetActiveSession();
        setMessages([]);
        setActiveConversationId(createConversationId());
        userScrolledUpRef.current = false;
      }
    },
    [activeConversationId, resetActiveSession]
  );

  const handleTogglePanel = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        localStorage.setItem(AGENT_PANEL_SEEN_STORAGE_KEY, 'true');
        setUnreadCount(0);
      } else {
        setSettingsOpen(false);
        setHistoryOpen(false);
        setHelpDialogOpen(false);
      }
      return next;
    });
  }, []);

  const handleToggleSettings = useCallback(() => {
    setSettingsOpen((prev) => !prev);
    setHistoryOpen(false);
    setHelpDialogOpen(false);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setIsOpen(true);
    setSettingsOpen(true);
    setHistoryOpen(false);
    setHelpDialogOpen(false);
    userScrolledUpRef.current = false;
    localStorage.setItem(AGENT_PANEL_SEEN_STORAGE_KEY, 'true');
  }, []);

  useEffect(() => {
    const handleOpenSettingsRequest = () => {
      handleOpenSettings();
    };

    window.addEventListener(OPEN_AGENT_SETTINGS_EVENT, handleOpenSettingsRequest);

    return () => {
      window.removeEventListener(OPEN_AGENT_SETTINGS_EVENT, handleOpenSettingsRequest);
    };
  }, [handleOpenSettings]);

  const handleToggleHistory = useCallback(() => {
    setHistoryOpen((prev) => !prev);
    setSettingsOpen(false);
    setHelpDialogOpen(false);
  }, []);

  const handleToggleHelp = useCallback(() => {
    setHelpDialogOpen((prev) => !prev);
    setSettingsOpen(false);
    setHistoryOpen(false);
  }, []);

  const handleOpenTutorialSource = useCallback((url: string) => {
    void window.producerPlayer.openExternalUrl(url);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasPreferencesModifier = event.metaKey || event.ctrlKey;
      const isPreferencesShortcut =
        hasPreferencesModifier &&
        !event.shiftKey &&
        !event.altKey &&
        (event.key === ',' || event.code === 'Comma');

      if (!isPreferencesShortcut) {
        return;
      }

      event.preventDefault();
      handleOpenSettings();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleOpenSettings]);

  const handleRemoveAttachment = useCallback((path: string) => {
    setPendingAttachments((prev) => prev.filter((entry) => entry.path !== path));
    void window.producerPlayer.agentClearAttachments([path]).catch(() => {
      // Best-effort cleanup; if it fails the periodic sweep will catch it.
    });
  }, []);

  const handleClearAllAttachments = useCallback(() => {
    const paths = pendingAttachments.map((entry) => entry.path);
    setPendingAttachments([]);
    if (paths.length > 0) {
      void window.producerPlayer.agentClearAttachments(paths).catch(() => {});
    }
  }, [pendingAttachments]);

  const handleFilesAttached = useCallback(
    async (files: FileList | File[]) => {
      const incoming = Array.from(files ?? []);
      if (incoming.length === 0) return;

      const remainingSlots = Math.max(
        0,
        MAX_AGENT_ATTACHMENTS_PER_TURN - pendingAttachments.length,
      );

      if (remainingSlots === 0) {
        setAttachmentError(
          `You can attach at most ${MAX_AGENT_ATTACHMENTS_PER_TURN} files per message.`,
        );
        return;
      }

      const filesToSave = incoming.slice(0, remainingSlots);
      const overflow = incoming.length - filesToSave.length;

      const saved: AgentAttachment[] = [];
      const errors: string[] = [];

      for (const file of filesToSave) {
        try {
          const buffer = await file.arrayBuffer();
          const result = await window.producerPlayer.agentSaveAttachment({
            name: file.name,
            mimeType: file.type,
            data: buffer,
          });
          saved.push(result);
        } catch (error) {
          errors.push(
            `${file.name}: ${error instanceof Error ? error.message : 'failed to attach'}`,
          );
        }
      }

      if (saved.length > 0) {
        setPendingAttachments((prev) => [...prev, ...saved]);
      }

      if (errors.length > 0) {
        setAttachmentError(errors.join(' · '));
      } else if (overflow > 0) {
        setAttachmentError(
          `Only the first ${filesToSave.length} file${filesToSave.length === 1 ? '' : 's'} attached — the ${MAX_AGENT_ATTACHMENTS_PER_TURN}-per-message cap was reached.`,
        );
      } else {
        setAttachmentError(null);
      }
    },
    [pendingAttachments.length],
  );

  const handlePanelDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragEnterCountRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handlePanelDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handlePanelDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    // Mirror T3 Code's behavior: ignore dragleave events whose relatedTarget is
    // still inside the panel. Without this, crossing internal child boundaries
    // (messages, chips, buttons) briefly decrements the counter and causes the
    // overlay to flicker during a continuous drag.
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    dragEnterCountRef.current = Math.max(0, dragEnterCountRef.current - 1);
    if (dragEnterCountRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handlePanelDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!eventHasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragEnterCountRef.current = 0;
      setIsDragOver(false);

      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;

      void handleFilesAttached(files);
    },
    [handleFilesAttached],
  );

  const handleSendMessage = useCallback(
    async (text: string, options?: { bypassHistoryGuard?: boolean }) => {
      const trimmedMessage = text.trim();
      if (!trimmedMessage && pendingAttachments.length === 0) return;
      if (historyOpen && !options?.bypassHistoryGuard) return;

      if (isStreaming) {
        const interruptedMessageId = streamingMessageIdRef.current;

        if (interruptedMessageId) {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === interruptedMessageId
                ? { ...message, status: 'stopped' as const }
                : message
            )
          );
        }

        ignoredTurnCompleteCountRef.current += 1;
        try {
          await window.producerPlayer.agentInterrupt();
        } catch {
          ignoredTurnCompleteCountRef.current = Math.max(
            0,
            ignoredTurnCompleteCountRef.current - 1
          );
        }
        streamingMessageIdRef.current = null;
        setIsStreaming(false);
      }

      if (!sessionActive) {
        const historySeed = buildHistorySeed(messages);
        await window.producerPlayer.agentStartSession({
          provider,
          mode: 'analysis',
          model: currentModel,
          thinking: currentThinking,
          systemPrompt: effectiveSystemPrompt,
          ...(historySeed.length > 0 ? { history: historySeed } : {}),
        });
        setSessionActive(true);
      }

      const attachmentsForTurn = pendingAttachments;
      const attachmentSummary =
        attachmentsForTurn.length > 0
          ? attachmentsForTurn.map((a) => a.name).join(', ')
          : '';
      const displayContent =
        attachmentsForTurn.length > 0
          ? trimmedMessage.length > 0
            ? `${trimmedMessage}\n\n[Attached: ${attachmentSummary}]`
            : `[Attached: ${attachmentSummary}]`
          : trimmedMessage;

      const userMsg: AgentChatMessage = {
        id: nextMessageId(),
        role: 'user',
        content: displayContent,
        timestamp: Date.now(),
        status: 'complete',
      };
      const pendingAssistantId = nextMessageId();

      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: pendingAssistantId,
          role: 'agent',
          content: '',
          timestamp: Date.now(),
          status: 'streaming',
        },
      ]);
      streamingMessageIdRef.current = pendingAssistantId;
      setIsStreaming(true);
      userScrolledUpRef.current = false;

      // Attachments travel with the turn; clear the pending list from the UI
      // as soon as the turn is sent. The temp files are cleaned up after the
      // agent's reply or by the periodic sweep.
      setPendingAttachments([]);
      setAttachmentError(null);

      const context = getAnalysisContext();
      const uiContext = captureAgentUiContext();

      // If the user only attached files (no typed prompt), nudge the agent
      // to react to them explicitly so the turn has a clear ask.
      const messageForAgent =
        trimmedMessage.length > 0
          ? trimmedMessage
          : attachmentsForTurn.length > 0
            ? `I attached ${attachmentsForTurn.length} file${attachmentsForTurn.length === 1 ? '' : 's'} (${attachmentSummary}). Please take a look.`
            : trimmedMessage;

      await window.producerPlayer.agentSendTurn({
        message: messageForAgent,
        context,
        uiContext,
        ...(attachmentsForTurn.length > 0 ? { attachments: attachmentsForTurn } : {}),
      });

      // Best-effort cleanup of the attachment temp files after the turn has
      // been dispatched. The agent subprocess has already been handed the
      // absolute paths and will read them itself before its first response.
      if (attachmentsForTurn.length > 0) {
        window.setTimeout(() => {
          void window.producerPlayer
            .agentClearAttachments(attachmentsForTurn.map((a) => a.path))
            .catch(() => {});
        }, 60_000);
      }
    },
    [
      currentModel,
      currentThinking,
      effectiveSystemPrompt,
      getAnalysisContext,
      historyOpen,
      isStreaming,
      messages,
      pendingAttachments,
      provider,
      sessionActive,
    ]
  );

  useEffect(() => {
    if (!promptRequest?.id) {
      return;
    }

    if (lastHandledPromptRequestIdRef.current === promptRequest.id) {
      return;
    }

    lastHandledPromptRequestIdRef.current = promptRequest.id;
    setIsOpen(true);
    setSettingsOpen(false);
    setHistoryOpen(false);
    setHelpDialogOpen(false);
    userScrolledUpRef.current = false;
    localStorage.setItem(AGENT_PANEL_SEEN_STORAGE_KEY, 'true');

    void handleSendMessage(promptRequest.prompt, { bypassHistoryGuard: true });
  }, [handleSendMessage, promptRequest]);

  const handleInterrupt = useCallback(() => {
    void window.producerPlayer.agentInterrupt();
    const stoppedId = streamingMessageIdRef.current;
    streamingMessageIdRef.current = null;
    setIsStreaming(false);
    if (stoppedId) {
      setMessages((prev) => prev.map((m) => (m.id === stoppedId ? { ...m, status: 'stopped' } : m)));
    }
  }, []);

  const handleApproval = useCallback(
    (decision: 'allow' | 'deny') => {
      if (!approvalRequest) return;
      void window.producerPlayer.agentRespondApproval({
        approvalId: approvalRequest.approvalId,
        decision,
      });
      setApprovalRequest(null);
    },
    [approvalRequest]
  );

  const handleCopyMessage = useCallback((content: string) => {
    void window.producerPlayer.copyTextToClipboard(content);
  }, []);

  const handleProviderChange = useCallback(
    (newProvider: AgentProviderId) => {
      if (newProvider === provider) return;
      resetActiveSession();
      localStorage.setItem(AGENT_PROVIDER_STORAGE_KEY, newProvider);
      setProvider(newProvider);
      setProviderAvailable(null);
      void window.producerPlayer.agentCheckProvider(newProvider).then((available) => {
        setProviderAvailable(available);
      });
    },
    [provider, resetActiveSession]
  );

  const handleModelChange = useCallback(
    (model: AgentModelId) => {
      resetActiveSession();
      localStorage.setItem(`${AGENT_MODEL_STORAGE_PREFIX}${provider}`, model);
      setModelByProvider((prev) => ({
        ...prev,
        [provider]: model,
      }));
    },
    [provider, resetActiveSession]
  );

  const handleThinkingChange = useCallback(
    (thinking: AgentThinkingEffort) => {
      resetActiveSession();
      localStorage.setItem(`${AGENT_THINKING_STORAGE_PREFIX}${provider}`, thinking);
      setThinkingByProvider((prev) => ({
        ...prev,
        [provider]: thinking,
      }));
    },
    [provider, resetActiveSession]
  );

  const handleSystemPromptChange = useCallback(
    (nextPrompt: string) => {
      resetActiveSession();
      setSystemPrompt(nextPrompt);

      if (nextPrompt.trim().length > 0) {
        localStorage.setItem(AGENT_SYSTEM_PROMPT_STORAGE_KEY, nextPrompt);
        return;
      }

      localStorage.removeItem(AGENT_SYSTEM_PROMPT_STORAGE_KEY);
    },
    [resetActiveSession]
  );

  const providerUnavailableCopy =
    provider === 'claude'
      ? {
          title: 'Claude Code CLI not found. Install it with:',
          command: 'npm i -g @anthropic-ai/claude-code',
          followup: 'Then authenticate with your subscription:',
          followupCommand: 'claude auth',
        }
      : {
          title: 'Codex CLI not found. Install or update it, then make sure `codex` is on your PATH.',
          command: 'codex --version',
          followup: 'Then authenticate with your subscription:',
          followupCommand: 'codex login',
        };

  // When the panel has explicit bounds (user dragged/resized), apply them as
  // inline styles and disable the CSS-driven bottom/right anchoring via the
  // `agent-chat-panel--positioned` class.
  //
  // The closed/minimized transform for the default (bottom-anchored) panel is
  // `translateY(calc(100% - 4px))`, which slides it below the viewport because
  // the panel's own bottom edge starts flush with the viewport bottom. For the
  // positioned case that math doesn't work — e.g. a panel at y=0 on a 900px
  // viewport would only slide down by its own height, still leaving most of
  // it visible. Instead we compute the distance needed to push the panel's
  // top edge to just above the viewport bottom (4px peek).
  //
  // Codex-reviewed 2026-04-18: positioned panel minimize bug (translateY of
  // own-height wasn't enough to push it offscreen).
  const panelStyle: CSSProperties = panelBounds
    ? {
        top: panelBounds.y,
        left: panelBounds.x,
        width: panelBounds.width,
        height: panelBounds.height,
        transform: isOpen
          ? 'translateY(0)'
          : `translateY(${Math.max(
              0,
              viewportHeight - panelBounds.y - 4
            )}px)`,
      }
    : {
        transform: isOpen ? 'translateY(0)' : 'translateY(calc(100% - 4px))',
      };

  const panelClassName = [
    'agent-chat-panel',
    isOpen ? 'agent-chat-panel--open' : '',
    isDragOver ? 'agent-chat-panel--drag-over' : '',
    panelBounds ? 'agent-chat-panel--positioned' : '',
    isPanelDragging ? 'agent-chat-panel--dragging' : '',
    isPanelResizing ? 'agent-chat-panel--resizing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <button
        type="button"
        className="agent-toggle-button"
        onClick={handleTogglePanel}
        data-testid="agent-panel-toggle"
        title={isOpen ? 'Minimize Producey Boy' : 'Open Producey Boy'}
        aria-label={isOpen ? 'Minimize Producey Boy' : `Open Producey Boy${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {!isOpen && unreadCount > 0 && (
          <span className="agent-toggle-badge" data-testid="agent-toggle-badge">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <div
        ref={panelRef}
        className={panelClassName}
        style={panelStyle}
        data-testid="agent-chat-panel"
        onDragEnter={handlePanelDragEnter}
        onDragOver={handlePanelDragOver}
        onDragLeave={handlePanelDragLeave}
        onDrop={handlePanelDrop}
      >
        {isDragOver && (
          <div
            className="agent-drop-overlay"
            data-testid="agent-drop-overlay"
            aria-hidden="true"
          >
            <div className="agent-drop-overlay-inner">
              <svg
                viewBox="0 0 24 24"
                width="42"
                height="42"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div className="agent-drop-overlay-title">Drop files to attach</div>
              <div className="agent-drop-overlay-hint">
                Any file works — images, audio, project files, documents.
              </div>
            </div>
          </div>
        )}
        <div
          ref={headerRef}
          className="agent-panel-header"
          data-testid="agent-panel-header"
          onPointerDown={handleHeaderPointerDown}
          onDoubleClick={handleHeaderDoubleClick}
        >
          <div className="agent-panel-header-left">
            <div className="agent-panel-avatar" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 15c2.5-4 5.2-6 8-6s5.5 2 8 6" />
                <path d="M4 9c2.5-4 5.2-6 8-6s5.5 2 8 6" opacity="0.55" />
                <path d="M7 18c1.6-1.2 3.3-1.8 5-1.8s3.4.6 5 1.8" />
              </svg>
            </div>
            <div className="agent-panel-heading-copy">
              <h3 className="agent-panel-title" data-testid="agent-panel-title">
                Producey Boy
              </h3>
            </div>
          </div>
          <div className="agent-panel-header-right">
            <button
              type="button"
              className="agent-header-button"
              onClick={handleToggleHelp}
              data-testid="agent-help-toggle"
              title="Assistant setup help"
              aria-label="Assistant setup help"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M9.6 9a2.4 2.4 0 1 1 4.8 0c0 1.9-2.4 2.2-2.4 4" />
                <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
              </svg>
            </button>
            <button
              type="button"
              className={`agent-header-button ${historyOpen ? 'agent-header-button--active' : ''}`}
              onClick={handleToggleHistory}
              data-testid="agent-history-toggle"
              title="Chat history"
              aria-label="Chat history"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v5h5" />
                <path d="M12 7v5l3 3" />
              </svg>
            </button>
            <button
              type="button"
              className={`agent-header-button ${settingsOpen ? 'agent-header-button--active' : ''}`}
              onClick={handleToggleSettings}
              data-testid="agent-settings-toggle"
              title="Assistant settings"
              aria-label="Assistant settings"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V22a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 9.44 4.1V4a2 2 0 1 1 4 0v.09c0 .67.4 1.28 1.01 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01c.24.61.84 1.01 1.51 1.01H20a2 2 0 1 1 0 4h-.09c-.67 0-1.28.4-1.51 1.01z" />
              </svg>
            </button>
            <button
              type="button"
              className="agent-header-button"
              onClick={() => {
                setIsOpen(false);
                setSettingsOpen(false);
                setHistoryOpen(false);
                setHelpDialogOpen(false);
              }}
              data-testid="agent-panel-close"
              title="Minimize"
              aria-label="Minimize"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M6 12h12" />
              </svg>
            </button>
          </div>
        </div>

        {settingsOpen && (
          <AgentSettings
            provider={provider}
            model={currentModel}
            thinking={currentThinking}
            availableModels={availableModels}
            availableThinkingOptions={AGENT_THINKING_OPTIONS}
            systemPrompt={systemPrompt}
            onProviderChange={handleProviderChange}
            onModelChange={handleModelChange}
            onThinkingChange={handleThinkingChange}
            onSystemPromptChange={handleSystemPromptChange}
            onNewChat={handleNewChat}
            onOpenHistory={() => setHistoryOpen(true)}
            hasHistory={chatHistory.length > 0}
            onClose={() => setSettingsOpen(false)}
            controlsDisabled={isStreaming}
          />
        )}

        {approvalRequest && (
          <div className="agent-approval-banner" role="alertdialog" data-testid="agent-approval-banner">
            <div className="agent-approval-info">
              <strong>{approvalRequest.toolName}</strong>
              <span>{approvalRequest.description}</span>
            </div>
            <div className="agent-approval-actions">
              <button
                type="button"
                className="agent-approval-allow"
                onClick={() => handleApproval('allow')}
                title="Allow this tool action"
              >
                Allow
              </button>
              <button
                type="button"
                className="agent-approval-deny"
                onClick={() => handleApproval('deny')}
                title="Deny this tool action"
              >
                Deny
              </button>
            </div>
          </div>
        )}

        <div
          className={`agent-timeline ${helpDialogOpen ? 'agent-timeline--help' : ''}`}
          ref={timelineRef}
          onScroll={handleTimelineScroll}
          role="log"
          aria-live="polite"
          data-testid="agent-timeline"
        >
          {helpDialogOpen ? (
            <div
              className="agent-help-state"
              role="region"
              aria-label="Assistant setup help"
              data-testid="agent-help-dialog"
            >
              <div className="agent-help-dialog agent-help-dialog--inline">
                <div className="agent-help-dialog-header">
                  <h4>Set up Producey Boy</h4>
                  <button
                    type="button"
                    className="agent-help-close"
                    onClick={() => setHelpDialogOpen(false)}
                    data-testid="agent-help-close"
                    title="Close help"
                  >
                    ✕
                  </button>
                </div>
                <p>
                  This assistant uses your local CLI login, so you can run sessions through your
                  existing subscription without wiring separate per-message API billing in-app.
                </p>
                <p className="agent-help-note">
                  Long-chat note: automatic compaction has not been verified in this desktop flow
                  yet. If the context gets too long or stale, use <strong>Start new chat</strong>{' '}
                  in Settings to reset the conversation cleanly.
                </p>
                <ol className="agent-help-steps">
                  {EMPTY_CHAT_SETUP_STEPS.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <div className="agent-help-commands">
                  <div>
                    <strong>Claude Code</strong>
                    <code>npm i -g @anthropic-ai/claude-code</code>
                    <code>claude auth</code>
                  </div>
                  <div>
                    <strong>Codex</strong>
                    <code>codex --version</code>
                    <code>codex login</code>
                  </div>
                </div>
                <div className="agent-help-sources" data-testid="agent-help-tutorial-sources">
                  <strong>Tutorial source context</strong>
                  <p>
                    For app walkthroughs, Producey Boy can ground instructions in the public
                    Producer Player repo/docs:
                  </p>
                  <ul>
                    {APP_TUTORIAL_SOURCE_LINKS.map((source) => (
                      <li key={source.url}>
                        <button
                          type="button"
                          className="agent-help-source-link"
                          onClick={() => handleOpenTutorialSource(source.url)}
                          title={`Open ${source.label}`}
                        >
                          {source.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : historyOpen ? (
            <div className="agent-history-state" data-testid="agent-history-state">
              <div className="agent-history-header-row">
                <h4 className="agent-history-title">Chat history</h4>
                <button
                  type="button"
                  className="agent-history-close"
                  onClick={() => setHistoryOpen(false)}
                  data-testid="agent-history-close"
                  title="Back to current chat"
                >
                  Back to chat
                </button>
              </div>

              {chatHistory.length === 0 ? (
                <p className="agent-history-empty" data-testid="agent-history-empty">
                  No saved chats yet. Messages are saved automatically and will appear here.
                </p>
              ) : (
                <ul className="agent-history-list">
                  {chatHistory.map((entry) => (
                    <li key={entry.id} className="agent-history-item" data-testid="agent-history-item">
                      <div className="agent-history-item-copy">
                        <strong>{entry.title}</strong>
                        <span>
                          {formatRelativeTime(entry.updatedAt)} · {entry.messages.length} messages
                        </span>
                      </div>
                      <div className="agent-history-item-actions">
                        <button
                          type="button"
                          className="agent-history-action"
                          onClick={() => handleRestoreHistory(entry.id)}
                          data-testid="agent-history-open"
                          title="Open this chat"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className="agent-history-action agent-history-action--danger"
                          onClick={() => handleDeleteHistoryEntry(entry.id)}
                          data-testid="agent-history-delete"
                          title="Delete from history"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              {providerAvailable === false && (
                <div className="agent-provider-notice" data-testid="agent-provider-notice">
                  <p>{providerUnavailableCopy.title}</p>
                  <code>{providerUnavailableCopy.command}</code>
                  <p>{providerUnavailableCopy.followup}</p>
                  {providerUnavailableCopy.followupCommand ? (
                    <code>{providerUnavailableCopy.followupCommand}</code>
                  ) : null}
                </div>
              )}

              {messages.length === 0 && providerAvailable !== false && (
                <div className="agent-empty-state" data-testid="agent-empty-state">
                  <p className="agent-empty-state-title">
                    Set up once, then use your CLI subscription directly from this panel.
                  </p>
                  <p
                    className="agent-empty-state-hint"
                    data-testid="agent-empty-state-dnd-hint"
                  >
                    Tip: drag any file onto this panel to attach it to your next message.
                  </p>
                  <ol className="agent-empty-state-steps" data-testid="agent-empty-state-steps">
                    {EMPTY_CHAT_SETUP_STEPS.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    className="agent-empty-state-help"
                    onClick={() => {
                      setHelpDialogOpen(true);
                      setSettingsOpen(false);
                      setHistoryOpen(false);
                    }}
                    data-testid="agent-empty-state-help"
                    title="Open setup help for configuring the assistant"
                  >
                    Open setup help
                  </button>
                  <div className="agent-starter-prompts">
                    {STARTER_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        className="agent-starter-chip"
                        onClick={() => void handleSendMessage(prompt)}
                        data-testid="agent-starter-chip"
                        title={`Send: ${prompt}`}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`agent-message agent-message--${msg.role}`}
                  data-testid={`agent-message-${msg.role}`}
                >
                  <div className="agent-message-bubble">
                    <div className="agent-message-content">
                      {msg.role === 'agent' &&
                      msg.status === 'streaming' &&
                      msg.content.trim().length === 0 ? (
                        <span className="agent-thinking-label" data-testid="agent-thinking-label">
                          Thinking
                          <span className="agent-thinking-dots" aria-hidden="true">
                            <span>.</span>
                            <span>.</span>
                            <span>.</span>
                          </span>
                        </span>
                      ) : msg.role === 'agent' ? (
                        <AgentMarkdownContent content={msg.content} />
                      ) : (
                        <span>{msg.content}</span>
                      )}
                      {msg.status === 'stopped' && (
                        <span className="agent-stopped-label"> (stopped)</span>
                      )}
                    </div>
                    <div className="agent-message-meta">
                      <span className="agent-message-time">{formatRelativeTime(msg.timestamp)}</span>
                      {msg.role === 'agent' && msg.status === 'complete' && (
                        <button
                          type="button"
                          className="agent-copy-button"
                          onClick={() => handleCopyMessage(msg.content)}
                          title="Copy message"
                        >
                          Copy
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {isStreaming && !streamingMessageIdRef.current && (
                <div className="agent-typing-indicator" data-testid="agent-typing-indicator">
                  <span className="agent-thinking-label">
                    Thinking
                    <span className="agent-thinking-dots" aria-hidden="true">
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </span>
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <AgentComposer
          onSend={handleSendMessage}
          onInterrupt={handleInterrupt}
          isStreaming={isStreaming}
          disabled={providerAvailable === false || historyOpen || helpDialogOpen}
          attachments={pendingAttachments}
          attachmentError={attachmentError}
          onRemoveAttachment={handleRemoveAttachment}
          onClearAttachments={handleClearAllAttachments}
          onDismissAttachmentError={() => setAttachmentError(null)}
          onPasteFiles={(files) => {
            void handleFilesAttached(files);
          }}
        />

        {/* Resize handles — eight overlay divs (4 sides + 4 corners). The
         * top-left + bottom-right handles also render the two-diagonal-line
         * drag hint via CSS ::before / ::after. */}
        <div
          className="agent-resize-handle agent-resize-handle--top"
          data-testid="agent-resize-handle-top"
          onPointerDown={(e) => startResize('top', e)}
        />
        <div
          className="agent-resize-handle agent-resize-handle--right"
          data-testid="agent-resize-handle-right"
          onPointerDown={(e) => startResize('right', e)}
        />
        <div
          className="agent-resize-handle agent-resize-handle--bottom"
          data-testid="agent-resize-handle-bottom"
          onPointerDown={(e) => startResize('bottom', e)}
        />
        <div
          className="agent-resize-handle agent-resize-handle--left"
          data-testid="agent-resize-handle-left"
          onPointerDown={(e) => startResize('left', e)}
        />
        <div
          className="agent-resize-handle agent-resize-handle--top-left"
          data-testid="agent-resize-handle-top-left"
          onPointerDown={(e) => startResize('top-left', e)}
        />
        <div
          className="agent-resize-handle agent-resize-handle--top-right"
          data-testid="agent-resize-handle-top-right"
          onPointerDown={(e) => startResize('top-right', e)}
        />
        <div
          className="agent-resize-handle agent-resize-handle--bottom-left"
          data-testid="agent-resize-handle-bottom-left"
          onPointerDown={(e) => startResize('bottom-left', e)}
        />
        <div
          className="agent-resize-handle agent-resize-handle--bottom-right"
          data-testid="agent-resize-handle-bottom-right"
          onPointerDown={(e) => startResize('bottom-right', e)}
        />
      </div>
    </>
  );
}

/**
 * Renders agent Markdown content using safe DOM APIs (createElement + textContent).
 * No innerHTML or dangerouslySetInnerHTML. Content comes from the local Claude CLI
 * subprocess and is rendered via textContent for all user-visible strings.
 */
function AgentMarkdownContent({ content }: { content: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.textContent = '';
    const fragment = markdownToFragment(content);
    containerRef.current.appendChild(fragment);
  }, [content]);

  return <div className="agent-markdown" ref={containerRef} />;
}

function markdownToFragment(md: string): DocumentFragment {
  const fragment = document.createDocumentFragment();

  const segments: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let codeMatch: RegExpExecArray | null;
  let lastIndex = 0;

  while ((codeMatch = codeBlockRegex.exec(md)) !== null) {
    if (codeMatch.index > lastIndex) {
      segments.push({ type: 'text', content: md.slice(lastIndex, codeMatch.index) });
    }
    segments.push({ type: 'code', content: codeMatch[2].trimEnd(), lang: codeMatch[1] || undefined });
    lastIndex = codeMatch.index + codeMatch[0].length;
  }
  if (lastIndex < md.length) {
    segments.push({ type: 'text', content: md.slice(lastIndex) });
  }

  for (const segment of segments) {
    if (segment.type === 'code') {
      const pre = document.createElement('pre');
      pre.className = 'agent-code-block';
      if (segment.lang) pre.setAttribute('data-language', segment.lang);
      const code = document.createElement('code');
      code.textContent = segment.content;
      pre.appendChild(code);
      fragment.appendChild(pre);
      continue;
    }

    const lines = segment.content.split('\n');
    let inList = false;
    let listEl: HTMLUListElement | HTMLOListElement | null = null;
    let listType: 'ul' | 'ol' = 'ul';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Table detection
      if (line.startsWith('|') && i + 1 < lines.length && lines[i + 1]?.match(/^\|[\s:|-]+\|$/)) {
        if (inList && listEl) { fragment.appendChild(listEl); inList = false; listEl = null; }
        const headerLine = line;
        i++;
        const bodyLines: string[] = [];
        while (i + 1 < lines.length && lines[i + 1]?.startsWith('|')) {
          i++;
          bodyLines.push(lines[i]);
        }
        fragment.appendChild(buildTable(headerLine, bodyLines));
        continue;
      }

      // Headings
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        if (inList && listEl) { fragment.appendChild(listEl); inList = false; listEl = null; }
        const heading = document.createElement(`h${headingMatch[1].length}`);
        appendInlineMarkdown(heading, headingMatch[2]);
        fragment.appendChild(heading);
        continue;
      }

      // Unordered list
      const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)/);
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          if (inList && listEl) fragment.appendChild(listEl);
          listEl = document.createElement('ul');
          inList = true;
          listType = 'ul';
        }
        const li = document.createElement('li');
        appendInlineMarkdown(li, ulMatch[2]);
        listEl!.appendChild(li);
        continue;
      }

      // Ordered list
      const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
      if (olMatch) {
        if (!inList || listType !== 'ol') {
          if (inList && listEl) fragment.appendChild(listEl);
          listEl = document.createElement('ol');
          inList = true;
          listType = 'ol';
        }
        const li = document.createElement('li');
        appendInlineMarkdown(li, olMatch[2]);
        listEl!.appendChild(li);
        continue;
      }

      if (inList && listEl && line.trim() === '') {
        fragment.appendChild(listEl);
        inList = false;
        listEl = null;
        continue;
      }

      if (line.trim() === '') continue;

      if (inList && listEl) { fragment.appendChild(listEl); inList = false; listEl = null; }
      const p = document.createElement('p');
      appendInlineMarkdown(p, line);
      fragment.appendChild(p);
    }

    if (inList && listEl) {
      fragment.appendChild(listEl);
    }
  }

  return fragment;
}

function buildTable(headerRow: string, bodyRows: string[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'agent-table';

  const thead = document.createElement('thead');
  const headerTr = document.createElement('tr');
  const headers = headerRow.split('|').filter((c) => c.trim());
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h.trim();
    headerTr.appendChild(th);
  }
  thead.appendChild(headerTr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of bodyRows) {
    const tr = document.createElement('tr');
    const cells = row.split('|').filter((c) => c.trim());
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c.trim();
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return table;
}

function appendInlineMarkdown(parent: HTMLElement, text: string): void {
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIdx = 0;
  let inlineMatch: RegExpExecArray | null;

  while ((inlineMatch = regex.exec(text)) !== null) {
    if (inlineMatch.index > lastIdx) {
      parent.appendChild(document.createTextNode(text.slice(lastIdx, inlineMatch.index)));
    }
    const token = inlineMatch[0];

    if (token.startsWith('`')) {
      const code = document.createElement('code');
      code.className = 'agent-inline-code';
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    } else if (token.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else if (token.startsWith('*')) {
      const em = document.createElement('em');
      em.textContent = token.slice(1, -1);
      parent.appendChild(em);
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const a = document.createElement('a');
        a.textContent = linkMatch[1];
        a.href = linkMatch[2];
        a.target = '_blank';
        a.rel = 'noopener';
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(token));
      }
    }

    lastIdx = inlineMatch.index + token.length;
  }

  if (lastIdx < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIdx)));
  }
}
