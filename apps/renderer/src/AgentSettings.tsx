import { useCallback, useEffect, useState } from 'react';
import type {
  AgentModelDefinition,
  AgentModelId,
  AgentProviderId,
  AgentThinkingEffort,
  AgentThinkingOption,
} from '@producer-player/contracts';
import { AGENT_PROVIDER_LABELS } from './agentModels';
import { notifyAgentVoiceSettingsUpdated } from './agentVoiceSettings';

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
  const [deepgramKey, setDeepgramKey] = useState('');
  const [deepgramKeySet, setDeepgramKeySet] = useState(false);
  const [deepgramKeyError, setDeepgramKeyError] = useState<string | null>(null);

  useEffect(() => {
    void window.producerPlayer
      .agentGetDeepgramKey()
      .then((key) => {
        setDeepgramKeySet(key !== null && key.length > 0);
        setDeepgramKeyError(null);
      })
      .catch((error: unknown) => {
        setDeepgramKeySet(false);
        setDeepgramKeyError(
          error instanceof Error ? error.message : 'Could not read Deepgram key.'
        );
      });
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
        <label className="agent-settings-label">Deepgram API Key</label>
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
            When a key is set, the microphone button appears beside the message box.
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
