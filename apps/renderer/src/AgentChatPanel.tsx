import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type {
  AgentContext,
  AgentEvent,
  AgentModelId,
  AgentProviderId,
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
  DEFAULT_AGENT_MODEL_BY_PROVIDER,
} from './agentModels';

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  status?: 'streaming' | 'complete' | 'stopped' | 'error';
  usage?: AgentTokenUsage;
}

interface AgentChatPanelProps {
  getAnalysisContext: () => AgentContext | null;
}

const STARTER_PROMPTS = [
  'How is my loudness?',
  'Compare to reference',
  'Check for clipping',
  'Is this ready for Spotify?',
];

const AGENT_PROVIDER_STORAGE_KEY = 'producer-player.agent-provider';
const AGENT_MODEL_STORAGE_PREFIX = 'producer-player.agent-model.';

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

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `msg-${messageIdCounter}-${Date.now()}`;
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

export function AgentChatPanel({ getAnalysisContext }: AgentChatPanelProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [provider, setProvider] = useState<AgentProviderId>(() => readStoredProvider());
  const [modelByProvider, setModelByProvider] = useState<Record<AgentProviderId, AgentModelId>>(() => ({
    claude: readStoredModel('claude'),
    codex: readStoredModel('codex'),
  }));
  const [systemPrompt, setSystemPrompt] = useState<string>(() => readStoredAgentSystemPrompt());
  const [providerAvailable, setProviderAvailable] = useState<boolean | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showFirstUseBadge, setShowFirstUseBadge] = useState(() => {
    return localStorage.getItem('producer-player.agent-panel-seen') !== 'true';
  });
  const [approvalRequest, setApprovalRequest] = useState<{
    approvalId: string;
    toolName: string;
    description: string;
  } | null>(null);

  const timelineRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef(false);
  const streamingMessageIdRef = useRef<string | null>(null);

  const availableModels = AGENT_MODEL_OPTIONS_BY_PROVIDER[provider];
  const currentModel = availableModels.some((option) => option.id === modelByProvider[provider])
    ? modelByProvider[provider]
    : DEFAULT_AGENT_MODEL_BY_PROVIDER[provider];
  const effectiveSystemPrompt = systemPrompt.trim() || DEFAULT_AGENT_SYSTEM_PROMPT;

  useEffect(() => {
    if (!isOpen) return;
    void window.producerPlayer.agentCheckProvider(provider).then((available) => {
      setProviderAvailable(available);
    });
  }, [isOpen, provider]);

  const scrollToBottom = useCallback(() => {
    if (timelineRef.current && !userScrolledUpRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

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
                m.id === streamId
                  ? { ...m, content: m.content + event.content }
                  : m
              )
            );
          }
          break;
        }

        case 'turn-complete': {
          const completedId = streamingMessageIdRef.current;
          streamingMessageIdRef.current = null;
          setIsStreaming(false);
          if (completedId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === completedId
                  ? { ...m, status: 'complete', usage: event.usage }
                  : m
              )
            );
          }
          break;
        }

        case 'error': {
          streamingMessageIdRef.current = null;
          setIsStreaming(false);
          setMessages((prev) => [
            ...prev,
            {
              id: nextMessageId(),
              role: 'system',
              content: `Error: ${event.message}`,
              timestamp: Date.now(),
              status: 'error',
            },
          ]);
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
          break;
        }

        default:
          break;
      }
    });

    return unsubscribe;
  }, []);

  const handleTogglePanel = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev && showFirstUseBadge) {
        setShowFirstUseBadge(false);
        localStorage.setItem('producer-player.agent-panel-seen', 'true');
      }
      return !prev;
    });
  }, [showFirstUseBadge]);

  const resetActiveSession = useCallback(() => {
    if (sessionActive) {
      void window.producerPlayer.agentDestroySession();
      setSessionActive(false);
    }
    streamingMessageIdRef.current = null;
    setIsStreaming(false);
  }, [sessionActive]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      if (!sessionActive) {
        await window.producerPlayer.agentStartSession({
          provider,
          mode: 'analysis',
          model: currentModel,
          systemPrompt: effectiveSystemPrompt,
        });
        setSessionActive(true);
      }

      const userMsg: AgentChatMessage = {
        id: nextMessageId(),
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
        status: 'complete',
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      userScrolledUpRef.current = false;

      const context = getAnalysisContext();
      const uiContext = captureAgentUiContext();

      await window.producerPlayer.agentSendTurn({
        message: text.trim(),
        context,
        uiContext,
      });
    },
    [currentModel, effectiveSystemPrompt, getAnalysisContext, isStreaming, provider, sessionActive]
  );

  const handleInterrupt = useCallback(() => {
    void window.producerPlayer.agentInterrupt();
    const stoppedId = streamingMessageIdRef.current;
    streamingMessageIdRef.current = null;
    setIsStreaming(false);
    if (stoppedId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === stoppedId ? { ...m, status: 'stopped' } : m
        )
      );
    }
  }, []);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    resetActiveSession();
  }, [resetActiveSession]);

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

  const handleResetSystemPrompt = useCallback(() => {
    resetActiveSession();
    localStorage.removeItem(AGENT_SYSTEM_PROMPT_STORAGE_KEY);
    setSystemPrompt(DEFAULT_AGENT_SYSTEM_PROMPT);
  }, [resetActiveSession]);

  const providerUnavailableCopy =
    provider === 'claude'
      ? {
          title: 'Claude Code CLI not found. Install it with:',
          command: 'npm i -g @anthropic-ai/claude-code',
          followup: 'Then authenticate:',
          followupCommand: 'claude auth',
        }
      : {
          title: 'Codex CLI not found. Install or update it, then make sure `codex` is on your PATH.',
          command: 'codex --version',
          followup: 'Once it is available, reopen the panel or switch providers to retry detection.',
          followupCommand: '',
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
        title={isOpen ? 'Close AI assistant' : 'Open AI assistant'}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {showFirstUseBadge && (
          <span className="agent-experimental-badge">Experimental</span>
        )}
      </button>

      <div
        className={`agent-chat-panel ${isOpen ? 'agent-chat-panel--open' : ''}`}
        style={panelStyle}
        data-testid="agent-chat-panel"
      >
        <div className="agent-panel-header">
          <div className="agent-panel-header-left">
            <div className="agent-panel-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 15c2.5-4 5.2-6 8-6s5.5 2 8 6" />
                <path d="M4 9c2.5-4 5.2-6 8-6s5.5 2 8 6" opacity="0.55" />
                <path d="M7 18c1.6-1.2 3.3-1.8 5-1.8s3.4.6 5 1.8" />
              </svg>
            </div>
            <div className="agent-panel-heading-copy">
              <h3 className="agent-panel-title" data-testid="agent-panel-title">Produceboi agent</h3>
              <p className="agent-panel-subtitle">Mastering wingman for the tricky bits.</p>
            </div>
            <span className="agent-experimental-label">Experimental</span>
          </div>
          <div className="agent-panel-header-right">
            <button
              type="button"
              className="agent-settings-button"
              onClick={() => setSettingsOpen((prev) => !prev)}
              data-testid="agent-settings-toggle"
              title="Settings"
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
              className="agent-close-button"
              onClick={() => setIsOpen(false)}
              data-testid="agent-panel-close"
              title="Minimize"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 12h12" />
              </svg>
            </button>
          </div>
        </div>

        {settingsOpen && (
          <AgentSettings
            provider={provider}
            model={currentModel}
            availableModels={availableModels}
            systemPrompt={systemPrompt}
            onProviderChange={handleProviderChange}
            onModelChange={handleModelChange}
            onSystemPromptChange={handleSystemPromptChange}
            onResetSystemPrompt={handleResetSystemPrompt}
            onClearChat={handleClearChat}
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
                Produceboi can help with mastering, loudness, tone, and audio gremlins.
              </p>
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
                  {msg.status === 'streaming' && (
                    <span className="agent-typing-cursor" />
                  )}
                  {msg.status === 'stopped' && (
                    <span className="agent-stopped-label"> (stopped)</span>
                  )}
                </div>
                <div className="agent-message-meta">
                  <span className="agent-message-time">
                    {formatRelativeTime(msg.timestamp)}
                  </span>
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
        </div>

        <AgentComposer
          onSend={handleSendMessage}
          onInterrupt={handleInterrupt}
          isStreaming={isStreaming}
          disabled={providerAvailable === false}
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
