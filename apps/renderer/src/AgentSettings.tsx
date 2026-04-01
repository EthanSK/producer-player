import { useCallback, useEffect, useState } from 'react';
import type {
  AgentModelDefinition,
  AgentModelId,
  AgentProviderId,
  AgentThinkingEffort,
  AgentThinkingOption,
} from '@producer-player/contracts';
import { AGENT_PROVIDER_LABELS } from './agentModels';
import {
  AGENT_STT_PROVIDER_LABELS,
  type AgentSttProviderId,
  notifyAgentVoiceSettingsUpdated,
  readStoredAgentSttProvider,
  writeStoredAgentSttProvider,
} from './agentVoiceSettings';

interface AgentSettingsProps {
  provider: AgentProviderId;
  model: AgentModelId;
  thinking: AgentThinkingEffort;
  availableModels: readonly AgentModelDefinition[];
  availableThinkingOptions: readonly AgentThinkingOption[];
  systemPrompt: string;
  onProviderChange: (provider: AgentProviderId) => void;
  onModelChange: (model: AgentModelId) => void;
  onThinkingChange: (thinking: AgentThinkingEffort) => void;
  onSystemPromptChange: (prompt: string) => void;
  onResetSystemPrompt: () => void;
  onNewChat: () => void;
  onOpenHistory: () => void;
  hasHistory: boolean;
  onClose: () => void;
  controlsDisabled?: boolean;
}

export function AgentSettings({
  provider,
  model,
  thinking,
  availableModels,
  availableThinkingOptions,
  systemPrompt,
  onProviderChange,
  onModelChange,
  onThinkingChange,
  onSystemPromptChange,
  onResetSystemPrompt,
  onNewChat,
  onOpenHistory,
  hasHistory,
  onClose,
  controlsDisabled = false,
}: AgentSettingsProps): JSX.Element {
  const [sttProvider, setSttProvider] = useState<AgentSttProviderId>(() =>
    readStoredAgentSttProvider()
  );

  const [deepgramKey, setDeepgramKey] = useState('');
  const [deepgramKeySet, setDeepgramKeySet] = useState(false);
  const [deepgramKeyError, setDeepgramKeyError] = useState<string | null>(null);

  const [assemblyAiKey, setAssemblyAiKey] = useState('');
  const [assemblyAiKeySet, setAssemblyAiKeySet] = useState(false);
  const [assemblyAiKeyError, setAssemblyAiKeyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      window.producerPlayer.agentGetDeepgramKey(),
      window.producerPlayer.agentGetAssemblyAiKey(),
    ])
      .then(([storedDeepgramKey, storedAssemblyAiKey]) => {
        if (cancelled) return;
        setDeepgramKeySet(storedDeepgramKey !== null && storedDeepgramKey.length > 0);
        setAssemblyAiKeySet(storedAssemblyAiKey !== null && storedAssemblyAiKey.length > 0);
        setDeepgramKeyError(null);
        setAssemblyAiKeyError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const fallback = 'Could not read saved speech-to-text keys.';
        const message = error instanceof Error ? error.message : fallback;
        setDeepgramKeySet(false);
        setAssemblyAiKeySet(false);
        setDeepgramKeyError(message);
        setAssemblyAiKeyError(message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveDeepgramKey = useCallback(async () => {
    const trimmed = deepgramKey.trim();
    if (!trimmed) return;

    try {
      await window.producerPlayer.agentStoreDeepgramKey(trimmed);
      setDeepgramKeySet(true);
      setDeepgramKey('');
      setDeepgramKeyError(null);
      notifyAgentVoiceSettingsUpdated();
    } catch (error: unknown) {
      setDeepgramKeyError(
        error instanceof Error ? error.message : 'Could not save Deepgram key.'
      );
    }
  }, [deepgramKey]);

  const handleClearDeepgramKey = useCallback(async () => {
    try {
      await window.producerPlayer.agentClearDeepgramKey();
      setDeepgramKeySet(false);
      setDeepgramKeyError(null);
      notifyAgentVoiceSettingsUpdated();
    } catch (error: unknown) {
      setDeepgramKeyError(
        error instanceof Error ? error.message : 'Could not clear Deepgram key.'
      );
    }
  }, []);

  const handleSaveAssemblyAiKey = useCallback(async () => {
    const trimmed = assemblyAiKey.trim();
    if (!trimmed) return;

    try {
      await window.producerPlayer.agentStoreAssemblyAiKey(trimmed);
      setAssemblyAiKeySet(true);
      setAssemblyAiKey('');
      setAssemblyAiKeyError(null);
      notifyAgentVoiceSettingsUpdated();
    } catch (error: unknown) {
      setAssemblyAiKeyError(
        error instanceof Error ? error.message : 'Could not save AssemblyAI key.'
      );
    }
  }, [assemblyAiKey]);

  const handleClearAssemblyAiKey = useCallback(async () => {
    try {
      await window.producerPlayer.agentClearAssemblyAiKey();
      setAssemblyAiKeySet(false);
      setAssemblyAiKeyError(null);
      notifyAgentVoiceSettingsUpdated();
    } catch (error: unknown) {
      setAssemblyAiKeyError(
        error instanceof Error ? error.message : 'Could not clear AssemblyAI key.'
      );
    }
  }, []);

  const handleSttProviderChange = useCallback((nextProvider: AgentSttProviderId) => {
    setSttProvider(nextProvider);
    writeStoredAgentSttProvider(nextProvider);
  }, []);

  const handleNewChatClick = useCallback(() => {
    onNewChat();
    onClose();
  }, [onClose, onNewChat]);

  const handleOpenHistoryClick = useCallback(() => {
    onOpenHistory();
    onClose();
  }, [onClose, onOpenHistory]);

  return (
    <div className="agent-settings" data-testid="agent-settings">
      <div className="agent-settings-section">
        <label className="agent-settings-label">Provider</label>
        <div className="agent-settings-provider-row">
          {(['claude', 'codex'] as const).map((providerId) => (
            <button
              key={providerId}
              type="button"
              className={`agent-settings-provider-option ${provider === providerId ? 'agent-settings-provider-option--active' : ''}`}
              onClick={() => onProviderChange(providerId)}
              disabled={controlsDisabled}
              data-testid={`agent-provider-${providerId}`}
            >
              {AGENT_PROVIDER_LABELS[providerId]}
            </button>
          ))}
        </div>
      </div>

      <div className="agent-settings-section">
        <label className="agent-settings-label" htmlFor="agent-model-select">
          Model
        </label>
        <select
          id="agent-model-select"
          className="agent-settings-model-select"
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          disabled={controlsDisabled}
          data-testid="agent-model-select"
        >
          {availableModels.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="agent-settings-section">
        <label className="agent-settings-label" htmlFor="agent-thinking-select">
          Thinking
        </label>
        <select
          id="agent-thinking-select"
          className="agent-settings-model-select"
          value={thinking}
          onChange={(event) => onThinkingChange(event.target.value as AgentThinkingEffort)}
          disabled={controlsDisabled}
          data-testid="agent-thinking-select"
        >
          {availableThinkingOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="agent-settings-section">
        <label className="agent-settings-label" htmlFor="agent-system-prompt-input">
          System prompt
        </label>
        <textarea
          id="agent-system-prompt-input"
          className="agent-settings-system-prompt"
          value={systemPrompt}
          onChange={(event) => onSystemPromptChange(event.target.value)}
          disabled={controlsDisabled}
          rows={8}
          spellCheck={false}
          data-testid="agent-system-prompt-input"
        />
        <div className="agent-settings-system-prompt-actions">
          <button
            type="button"
            className="agent-settings-system-prompt-reset"
            onClick={onResetSystemPrompt}
            disabled={controlsDisabled}
            data-testid="agent-system-prompt-reset"
            title="Reset assistant settings"
          >
            Reset settings
          </button>
        </div>
        <p className="agent-settings-reset-help">
          Resets assistant settings only (provider, model, thinking, prompt). Song order,
          checklist items, ratings, and files are not changed.
        </p>
      </div>

      <div className="agent-settings-section">
        <label className="agent-settings-label">Speech-to-text provider</label>
        <div className="agent-settings-provider-row agent-settings-provider-row--stt">
          {(['deepgram', 'assemblyai'] as const).map((providerId) => (
            <button
              key={providerId}
              type="button"
              className={`agent-settings-provider-option ${sttProvider === providerId ? 'agent-settings-provider-option--active' : ''}`}
              onClick={() => handleSttProviderChange(providerId)}
              disabled={controlsDisabled}
              data-testid={`agent-stt-provider-${providerId}`}
            >
              {AGENT_STT_PROVIDER_LABELS[providerId]}
            </button>
          ))}
        </div>
        <p className="agent-settings-key-help" data-testid="agent-stt-provider-help">
          Save both keys if you want, then switch between providers any time.
        </p>
      </div>

      <div className="agent-settings-section">
        <label className="agent-settings-label">Deepgram API key</label>
        {deepgramKeySet ? (
          <div className="agent-settings-key-row">
            <span className="agent-settings-key-status">Key set</span>
            <button
              type="button"
              className="agent-settings-key-clear"
              onClick={() => void handleClearDeepgramKey()}
              data-testid="agent-settings-key-clear"
            >
              Clear
            </button>
          </div>
        ) : (
          <div className="agent-settings-key-row">
            <input
              type="password"
              className="agent-settings-key-input"
              value={deepgramKey}
              onChange={(event) => setDeepgramKey(event.target.value)}
              placeholder="Enter API key"
              data-testid="agent-deepgram-key-input"
            />
            <button
              type="button"
              className="agent-settings-key-save"
              onClick={() => void handleSaveDeepgramKey()}
              disabled={!deepgramKey.trim()}
              data-testid="agent-settings-key-save"
            >
              Save
            </button>
          </div>
        )}
        {deepgramKeyError ? (
          <p className="agent-settings-key-error" data-testid="agent-deepgram-key-error">
            {deepgramKeyError}
          </p>
        ) : (
          <p className="agent-settings-key-help" data-testid="agent-deepgram-key-help">
            {sttProvider === 'deepgram'
              ? 'When selected, the microphone button appears beside the message box and uses Deepgram.'
              : 'Saved for quick switching. Select Deepgram above when you want to use it.'}
          </p>
        )}
      </div>

      <div className="agent-settings-section">
        <label className="agent-settings-label">AssemblyAI Universal-3 Pro API key</label>
        {assemblyAiKeySet ? (
          <div className="agent-settings-key-row">
            <span className="agent-settings-key-status">Key set</span>
            <button
              type="button"
              className="agent-settings-key-clear"
              onClick={() => void handleClearAssemblyAiKey()}
              data-testid="agent-assemblyai-key-clear"
            >
              Clear
            </button>
          </div>
        ) : (
          <div className="agent-settings-key-row">
            <input
              type="password"
              className="agent-settings-key-input"
              value={assemblyAiKey}
              onChange={(event) => setAssemblyAiKey(event.target.value)}
              placeholder="Enter API key"
              data-testid="agent-assemblyai-key-input"
            />
            <button
              type="button"
              className="agent-settings-key-save"
              onClick={() => void handleSaveAssemblyAiKey()}
              disabled={!assemblyAiKey.trim()}
              data-testid="agent-assemblyai-key-save"
            >
              Save
            </button>
          </div>
        )}
        {assemblyAiKeyError ? (
          <p className="agent-settings-key-error" data-testid="agent-assemblyai-key-error">
            {assemblyAiKeyError}
          </p>
        ) : (
          <p className="agent-settings-key-help" data-testid="agent-assemblyai-key-help">
            {sttProvider === 'assemblyai'
              ? 'When selected, the microphone button uses AssemblyAI Universal-3 Pro.'
              : 'Saved for quick switching. Select AssemblyAI above when you want to use it.'}
          </p>
        )}
      </div>

      <div className="agent-settings-section agent-settings-section--danger">
        <button
          type="button"
          className="agent-settings-clear-button"
          onClick={handleNewChatClick}
          data-testid="agent-clear-chat"
        >
          Start new chat
        </button>
        <button
          type="button"
          className="agent-settings-clear-button agent-settings-secondary-button"
          onClick={handleOpenHistoryClick}
          data-testid="agent-open-chat-history"
          disabled={!hasHistory}
          title={hasHistory ? 'Open previous chats' : 'No chat history yet'}
        >
          Chat history
        </button>
      </div>
    </div>
  );
}
