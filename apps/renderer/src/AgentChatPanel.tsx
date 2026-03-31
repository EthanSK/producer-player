import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type {
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

interface StoredActiveChat {
  id: string;
  messages: AgentChatMessage[];
}

interface AgentChatHistoryEntry {
  id: string;
  title: string;
  updatedAt: number;
  messages: AgentChatMessage[];
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
];

const AGENT_PROVIDER_STORAGE_KEY = 'producer-player.agent-provider';
const AGENT_MODEL_STORAGE_PREFIX = 'producer-player.agent-model.';
const AGENT_THINKING_STORAGE_PREFIX = 'producer-player.agent-thinking.';
const AGENT_PANEL_SEEN_STORAGE_KEY = 'producer-player.agent-panel-seen';
const AGENT_PANEL_ONBOARDING_ARMED_STORAGE_KEY =
  'producer-player.agent-panel-onboarding-armed';
const AGENT_ACTIVE_CHAT_STORAGE_KEY = 'producer-player.agent-chat-active.v1';
const AGENT_CHAT_HISTORY_STORAGE_KEY = 'producer-player.agent-chat-history.v1';
const AGENT_AUTO_OPEN_DELAY_DEFAULT_MS = 2 * 60 * 1000;
const AGENT_AUTO_OPEN_DELAY_TEST_MS = 1200;
const AGENT_CHAT_HISTORY_LIMIT = 20;

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

function readStoredActiveChat(): StoredActiveChat {
  const fallback: StoredActiveChat = {
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

function writeStoredActiveChat(chat: StoredActiveChat): void {
  localStorage.setItem(
    AGENT_ACTIVE_CHAT_STORAGE_KEY,
    JSON.stringify({
      id: chat.id,
      messages: normalizeMessagesForPersistence(chat.messages),
    })
  );
}

function readStoredChatHistory(): AgentChatHistoryEntry[] {
  const raw = localStorage.getItem(AGENT_CHAT_HISTORY_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((entry) => {
        if (!isRecord(entry)) return null;

        const id =
          typeof entry.id === 'string' && entry.id.trim().length > 0
            ? entry.id
            : createConversationId();
        const title =
          typeof entry.title === 'string' && entry.title.trim().length > 0
            ? entry.title
            : 'Untitled chat';
        const updatedAt =
          typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
            ? entry.updatedAt
            : Date.now();
        const messages = sanitizeStoredMessages(entry.messages);

        if (messages.length === 0) {
          return null;
        }

        return {
          id,
          title,
          updatedAt,
          messages,
        } satisfies AgentChatHistoryEntry;
      })
      .filter((entry): entry is AgentChatHistoryEntry => entry !== null)
      .slice(0, AGENT_CHAT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeStoredChatHistory(history: AgentChatHistoryEntry[]): void {
  localStorage.setItem(
    AGENT_CHAT_HISTORY_STORAGE_KEY,
    JSON.stringify(
      history.slice(0, AGENT_CHAT_HISTORY_LIMIT).map((entry) => ({
        ...entry,
        messages: normalizeMessagesForPersistence(entry.messages),
      }))
    )
  );
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
  const initialActiveChatRef = useRef<StoredActiveChat>(readStoredActiveChat());

  const [isOpen, setIsOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState(
    initialActiveChatRef.current.id
  );
  const [messages, setMessages] = useState<AgentChatMessage[]>(
    initialActiveChatRef.current.messages
  );
  const [chatHistory, setChatHistory] = useState<AgentChatHistoryEntry[]>(() =>
    readStoredChatHistory()
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
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

  const timelineRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef(false);
  const streamingMessageIdRef = useRef<string | null>(null);
  const onboardingScheduledRef = useRef(false);
  const lastHandledPromptRequestIdRef = useRef<string | null>(null);
  const ignoredTurnCompleteCountRef = useRef(0);

  const availableModels = AGENT_MODEL_OPTIONS_BY_PROVIDER[provider];
  const currentModel = availableModels.some((option) => option.id === modelByProvider[provider])
    ? modelByProvider[provider]
    : DEFAULT_AGENT_MODEL_BY_PROVIDER[provider];
  const currentThinking =
    thinkingByProvider[provider] ?? DEFAULT_AGENT_THINKING_BY_PROVIDER[provider];
  const effectiveSystemPrompt = systemPrompt.trim() || DEFAULT_AGENT_SYSTEM_PROMPT;

  useEffect(() => {
    writeStoredActiveChat({ id: activeConversationId, messages });
  }, [activeConversationId, messages]);

  useEffect(() => {
    writeStoredChatHistory(chatHistory);
  }, [chatHistory]);

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

  const archiveCurrentConversation = useCallback(() => {
    if (messages.length === 0) {
      return;
    }

    const entry: AgentChatHistoryEntry = {
      id: activeConversationId,
      title: buildHistoryTitle(messages),
      updatedAt: Date.now(),
      messages: normalizeMessagesForPersistence(messages),
    };

    setChatHistory((prev) => [entry, ...prev.filter((item) => item.id !== entry.id)].slice(0, AGENT_CHAT_HISTORY_LIMIT));
  }, [activeConversationId, messages]);

  const handleNewChat = useCallback(() => {
    archiveCurrentConversation();
    resetActiveSession();
    setMessages([]);
    setActiveConversationId(createConversationId());
    setHistoryOpen(false);
    userScrolledUpRef.current = false;
  }, [archiveCurrentConversation, resetActiveSession]);

  const handleRestoreHistory = useCallback(
    (conversationId: string) => {
      const selected = chatHistory.find((entry) => entry.id === conversationId);
      if (!selected) return;

      resetActiveSession();
      setMessages(normalizeMessagesForPersistence(selected.messages));
      setActiveConversationId(selected.id);
      setChatHistory((prev) => prev.filter((entry) => entry.id !== conversationId));
      setHistoryOpen(false);
      setHelpDialogOpen(false);
      userScrolledUpRef.current = false;
    },
    [chatHistory, resetActiveSession]
  );

  const handleDeleteHistoryEntry = useCallback((conversationId: string) => {
    setChatHistory((prev) => prev.filter((entry) => entry.id !== conversationId));
  }, []);

  const handleTogglePanel = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        localStorage.setItem(AGENT_PANEL_SEEN_STORAGE_KEY, 'true');
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

  const handleSendMessage = useCallback(
    async (text: string, options?: { bypassHistoryGuard?: boolean }) => {
      const trimmedMessage = text.trim();
      if (!trimmedMessage) return;
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

      const userMsg: AgentChatMessage = {
        id: nextMessageId(),
        role: 'user',
        content: trimmedMessage,
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

      const context = getAnalysisContext();
      const uiContext = captureAgentUiContext();

      await window.producerPlayer.agentSendTurn({
        message: trimmedMessage,
        context,
        uiContext,
      });
    },
    [
      currentModel,
      currentThinking,
      effectiveSystemPrompt,
      getAnalysisContext,
      historyOpen,
      isStreaming,
      messages,
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

  const handleResetAssistantSettings = useCallback(() => {
    const defaultProvider: AgentProviderId = 'claude';

    resetActiveSession();

    // Reset assistant-specific settings only. Intentionally does not touch
    // shared user data (song ordering, checklist items, ratings, etc.).
    localStorage.removeItem(AGENT_PROVIDER_STORAGE_KEY);
    localStorage.removeItem(AGENT_SYSTEM_PROMPT_STORAGE_KEY);
    (['claude', 'codex'] as const).forEach((providerId) => {
      localStorage.removeItem(`${AGENT_MODEL_STORAGE_PREFIX}${providerId}`);
      localStorage.removeItem(`${AGENT_THINKING_STORAGE_PREFIX}${providerId}`);
    });

    setProvider(defaultProvider);
    setModelByProvider({
      claude: DEFAULT_AGENT_MODEL_BY_PROVIDER.claude,
      codex: DEFAULT_AGENT_MODEL_BY_PROVIDER.codex,
    });
    setThinkingByProvider({
      claude: DEFAULT_AGENT_THINKING_BY_PROVIDER.claude,
      codex: DEFAULT_AGENT_THINKING_BY_PROVIDER.codex,
    });
    setSystemPrompt(DEFAULT_AGENT_SYSTEM_PROMPT);
    setProviderAvailable(null);

    void window.producerPlayer
      .agentCheckProvider(defaultProvider)
      .then((available) => {
        setProviderAvailable(available);
      })
      .catch(() => {
        setProviderAvailable(null);
      });
  }, [resetActiveSession]);

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

  const panelStyle: CSSProperties = {
    transform: isOpen ? 'translateY(0)' : 'translateY(calc(100% - 4px))',
  };

  return (
    <>
      <button
        type="button"
        className="agent-toggle-button"
        onClick={handleTogglePanel}
        data-testid="agent-panel-toggle"
        title={isOpen ? 'Minimize Produciboi' : 'Open Produciboi'}
        aria-label={isOpen ? 'Minimize Produciboi' : 'Open Produciboi'}
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
      </button>

      <div
        className={`agent-chat-panel ${isOpen ? 'agent-chat-panel--open' : ''}`}
        style={panelStyle}
        data-testid="agent-chat-panel"
      >
        <div className="agent-panel-header">
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
                Produciboi
              </h3>
              <p className="agent-panel-subtitle">mastering wingman</p>
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
            onResetSystemPrompt={handleResetAssistantSettings}
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
              >
                Allow
              </button>
              <button
                type="button"
                className="agent-approval-deny"
                onClick={() => handleApproval('deny')}
              >
                Deny
              </button>
            </div>
          </div>
        )}

        <div
          className="agent-timeline"
          ref={timelineRef}
          onScroll={handleTimelineScroll}
          role="log"
          aria-live="polite"
          data-testid="agent-timeline"
        >
          {historyOpen ? (
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
                  No saved chats yet. Start a new chat and your previous one will appear here.
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
                      {msg.role === 'agent' ? (
                        <AgentMarkdownContent content={msg.content} />
                      ) : (
                        <span>{msg.content}</span>
                      )}
                      {msg.status === 'streaming' && <span className="agent-typing-cursor" />}
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
                  <span className="agent-typing-dot" />
                  <span className="agent-typing-dot" />
                  <span className="agent-typing-dot" />
                </div>
              )}
            </>
          )}
        </div>

        <AgentComposer
          onSend={handleSendMessage}
          onInterrupt={handleInterrupt}
          isStreaming={isStreaming}
          disabled={providerAvailable === false || historyOpen}
        />

        {helpDialogOpen && (
          <div
            className="agent-help-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Assistant setup help"
            data-testid="agent-help-dialog"
          >
            <div className="agent-help-dialog">
              <div className="agent-help-dialog-header">
                <h4>Set up Produciboi</h4>
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
                Long-chat note: automatic compaction has not been verified in this desktop flow yet.
                If the context gets too long or stale, use <strong>Start new chat</strong> in
                Settings to reset the conversation cleanly. <strong>Reset settings</strong> only
                resets assistant preferences and never touches song order or checklist data.
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
            </div>
          </div>
        )}
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
