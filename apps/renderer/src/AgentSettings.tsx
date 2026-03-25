import { useCallback, useEffect, useState } from 'react';
import type { AgentProviderId } from '@producer-player/contracts';

interface AgentSettingsProps {
  provider: AgentProviderId;
  onProviderChange: (provider: AgentProviderId) => void;
  onClearChat: () => void;
  onClose: () => void;
}

export function AgentSettings({
  provider,
  onProviderChange,
  onClearChat,
  onClose,
}: AgentSettingsProps): JSX.Element {
  const [deepgramKey, setDeepgramKey] = useState('');
  const [deepgramKeySet, setDeepgramKeySet] = useState(false);
  const [hideVoice, setHideVoice] = useState(() => {
    return localStorage.getItem('producer-player.agent-hide-voice') === 'true';
  });
  const [confirmClear, setConfirmClear] = useState(false);

  // Load Deepgram key status
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
          <button
            type="button"
            className={`agent-settings-provider-option ${provider === 'claude' ? 'agent-settings-provider-option--active' : ''}`}
            onClick={() => onProviderChange('claude')}
          >
            Claude
          </button>
          <button
            type="button"
            className={`agent-settings-provider-option ${provider === 'codex' ? 'agent-settings-provider-option--active' : ''}`}
            onClick={() => onProviderChange('codex')}
            disabled
            title="Codex support coming soon"
          >
            Codex
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
          <input
            type="checkbox"
            checked={hideVoice}
            onChange={handleHideVoiceToggle}
          />
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
