import { useCallback, useEffect, useState } from 'react';
import type {
  AgentModelDefinition,
  AgentModelId,
  AgentProviderId,
} from '@producer-player/contracts';
import { AGENT_PROVIDER_LABELS } from './agentModels';

interface AgentSettingsProps {
  provider: AgentProviderId;
  model: AgentModelId;
  availableModels: readonly AgentModelDefinition[];
  systemPrompt: string;
  onProviderChange: (provider: AgentProviderId) => void;
  onModelChange: (model: AgentModelId) => void;
  onSystemPromptChange: (prompt: string) => void;
  onResetSystemPrompt: () => void;
  onClearChat: () => void;
  onClose: () => void;
  controlsDisabled?: boolean;
}

export function AgentSettings({
  provider,
  model,
  availableModels,
  systemPrompt,
  onProviderChange,
  onModelChange,
  onSystemPromptChange,
  onResetSystemPrompt,
  onClearChat,
  onClose,
  controlsDisabled = false,
}: AgentSettingsProps): JSX.Element {
  const [deepgramKey, setDeepgramKey] = useState('');
  const [deepgramKeySet, setDeepgramKeySet] = useState(false);
  const [hideVoice, setHideVoice] = useState(() => {
    return localStorage.getItem('producer-player.agent-hide-voice') === 'true';
  });
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void window.producerPlayer.agentGetDeepgramKey().then((key) => {
      setDeepgramKeySet(key !== null && key.length > 0);
    });
  }, []);

  const handleSaveDeepgramKey = useCallback(async () => {
    const trimmed = deepgramKey.trim();
    if (!trimmed) return;
    await window.producerPlayer.agentStoreDeepgramKey(trimmed);
    setDeepgramKeySet(true);
    setDeepgramKey('');
  }, [deepgramKey]);

  const handleClearDeepgramKey = useCallback(async () => {
    await window.producerPlayer.agentClearDeepgramKey();
    setDeepgramKeySet(false);
  }, []);

  const handleHideVoiceToggle = useCallback(() => {
    setHideVoice((prev) => {
      const next = !prev;
      localStorage.setItem('producer-player.agent-hide-voice', next ? 'true' : 'false');
      return next;
    });
  }, []);

  const handleClearChat = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    onClearChat();
    setConfirmClear(false);
    onClose();
  }, [confirmClear, onClearChat, onClose]);

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
          >
            Reset default
          </button>
        </div>
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
              onChange={(e) => setDeepgramKey(e.target.value)}
              placeholder="Enter API key"
              data-testid="agent-deepgram-key-input"
            />
            <button
              type="button"
              className="agent-settings-key-save"
              onClick={() => void handleSaveDeepgramKey()}
              disabled={!deepgramKey.trim()}
            >
              Save
            </button>
          </div>
        )}
      </div>

      <div className="agent-settings-section">
        <label className="agent-settings-toggle-row">
          <input type="checkbox" checked={hideVoice} onChange={handleHideVoiceToggle} />
          <span>Hide voice input</span>
        </label>
      </div>

      <div className="agent-settings-section agent-settings-section--danger">
        <button
          type="button"
          className={`agent-settings-clear-button ${confirmClear ? 'agent-settings-clear-button--confirm' : ''}`}
          onClick={handleClearChat}
          data-testid="agent-clear-chat"
        >
          {confirmClear ? 'Click again to confirm' : 'Clear chat'}
        </button>
      </div>
    </div>
  );
}
