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
  type AgentMicChannelMode,
  type AgentSttProviderId,
  buildAgentMicChannelMode,
  getAgentMicChannelModeLabel,
  notifyAgentVoiceSettingsUpdated,
  parseAgentMicChannelIndex,
  readStoredAgentMicChannelMode,
  readStoredAgentMicDeviceId,
  readStoredAgentSttProvider,
  writeStoredAgentMicChannelMode,
  writeStoredAgentMicDeviceId,
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
  onNewChat: () => void;
  onOpenHistory: () => void;
  hasHistory: boolean;
  onClose: () => void;
  controlsDisabled?: boolean;
  // v3.33 Phase 4 — auto-run mastering recommendations on track open.
  // When `false`, opening a new (songId, versionNumber) pair does NOT fire
  // the agent; the "Regenerate AI recommendations" button in fullscreen
  // mastering still works. Default ON.
  autoRecommendEnabled: boolean;
  onAutoRecommendEnabledChange: (enabled: boolean) => void;
  // Item #13 (v3.113) — DANGEROUS bypass-permissions toggle. Off by default
  // (safe). When ON, every spawned session passes the provider's
  // "dangerously bypass permission/approval gating" CLI flag for full
  // file-system + shell access. Persisted in unified state.
  dangerouslyBypassPermissions: boolean;
  onDangerouslyBypassPermissionsChange: (enabled: boolean) => void;
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
  onNewChat,
  onOpenHistory,
  hasHistory,
  onClose,
  controlsDisabled = false,
  autoRecommendEnabled,
  onAutoRecommendEnabledChange,
  dangerouslyBypassPermissions,
  onDangerouslyBypassPermissionsChange,
}: AgentSettingsProps): JSX.Element {
  const [sttProvider, setSttProvider] = useState<AgentSttProviderId>(() =>
    readStoredAgentSttProvider()
  );
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState(() =>
    readStoredAgentMicDeviceId()
  );
  const [micChannelMode, setMicChannelMode] = useState<AgentMicChannelMode>(() =>
    readStoredAgentMicChannelMode()
  );
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [micDevicesLoading, setMicDevicesLoading] = useState(false);
  const [micDevicesError, setMicDevicesError] = useState<string | null>(null);
  // v3.121 (Concern 2) — detected channel count of the currently-selected
  // input device. `null` means "not yet probed" (we render a default
  // mono/stereo/left/right list as a fallback). `1` means the device
  // really is mono — picker collapses to "Default / Mono". `2+` means a
  // multi-channel interface is connected; we expose Channel 1..N for
  // explicit raw-channel routing.
  const [detectedChannelCount, setDetectedChannelCount] = useState<number | null>(null);
  const [channelDetectError, setChannelDetectError] = useState<string | null>(null);

  const [deepgramKey, setDeepgramKey] = useState('');
  const [deepgramKeySet, setDeepgramKeySet] = useState(false);
  const [deepgramKeyError, setDeepgramKeyError] = useState<string | null>(null);

  const [assemblyAiKey, setAssemblyAiKey] = useState('');
  const [assemblyAiKeySet, setAssemblyAiKeySet] = useState(false);
  const [assemblyAiKeyError, setAssemblyAiKeyError] = useState<string | null>(null);

  const refreshMicDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setAudioInputDevices([]);
      setMicDevicesError('Microphone device selection is not supported here.');
      return;
    }

    setMicDevicesLoading(true);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((device) => device.kind === 'audioinput');
      setAudioInputDevices(inputs);
      setMicDevicesError(
        inputs.length > 0 ? null : 'No microphones found. Connect one, then refresh.'
      );
    } catch (error: unknown) {
      setAudioInputDevices([]);
      setMicDevicesError(
        error instanceof Error ? error.message : 'Could not list microphones.'
      );
    } finally {
      setMicDevicesLoading(false);
    }
  }, []);

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

  useEffect(() => {
    void refreshMicDevices();

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) {
      return undefined;
    }

    const handleDeviceChange = () => {
      void refreshMicDevices();
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshMicDevices]);

  // v3.121 (Concern 2) — probe the selected input device to discover its
  // actual channel count. We need this to render a Channel 1..N picker
  // that matches what the device actually exposes (Scarlett 18i8 → 18,
  // RME → 12, MacBook built-in → 1 or 2).
  //
  // Strategy: open a short-lived MediaStream with no channel constraint
  // (so the browser doesn't downmix), read `track.getSettings().channelCount`,
  // and stop the stream immediately. We do this lazily — only when the
  // settings panel is open AND the device choice changed — to avoid
  // surprise mic-permission prompts.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setDetectedChannelCount(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const constraints: MediaStreamConstraints = {
          audio:
            selectedMicDeviceId === 'default'
              ? true
              : { deviceId: { exact: selectedMicDeviceId } },
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        try {
          const track = stream.getAudioTracks()[0];
          const settings = track?.getSettings();
          const reportedCount =
            typeof settings?.channelCount === 'number' && settings.channelCount > 0
              ? Math.min(99, Math.max(1, Math.floor(settings.channelCount)))
              : null;
          if (!cancelled) {
            setDetectedChannelCount(reportedCount);
            setChannelDetectError(null);
          }
        } finally {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (error: unknown) {
        if (cancelled) return;
        // Permission denied / device gone — leave the picker on the
        // canonical mono/stereo/left/right fallback list so the user can
        // still configure something rather than seeing an empty select.
        setDetectedChannelCount(null);
        setChannelDetectError(
          error instanceof Error
            ? error.message
            : 'Could not detect channel count for this device.'
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedMicDeviceId]);

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

  const handleMicDeviceChange = useCallback((deviceId: string) => {
    setSelectedMicDeviceId(deviceId);
    writeStoredAgentMicDeviceId(deviceId);
  }, []);

  const handleMicChannelModeChange = useCallback((channelMode: AgentMicChannelMode) => {
    setMicChannelMode(channelMode);
    writeStoredAgentMicChannelMode(channelMode);
  }, []);

  const handleNewChatClick = useCallback(() => {
    onNewChat();
    onClose();
  }, [onClose, onNewChat]);

  const handleOpenHistoryClick = useCallback(() => {
    onOpenHistory();
    onClose();
  }, [onClose, onOpenHistory]);

  const listedAudioInputDevices = audioInputDevices.filter(
    (device) => device.deviceId !== 'default'
  );
  const selectedMicMissing =
    selectedMicDeviceId !== 'default' &&
    !listedAudioInputDevices.some((device) => device.deviceId === selectedMicDeviceId);

  // v3.121 (Concern 2) — build the channel-mode option list. The canonical
  // four (default/mono/stereo/left/right) always come first as a safety
  // fallback for users on simpler 1- or 2-channel mics. When the probe
  // detected 3+ channels (multi-channel interface), we also expose
  // Channel 1..N so users can route any specific raw input channel.
  //
  // Ordering: canonical list first, then a divider note, then Channel 1..N.
  // We also make sure the user's currently-saved mode is always visible
  // even if the device probe hasn't completed — otherwise picking
  // "Channel 12" on the 18i8 would briefly disappear from the list when
  // they revisit settings before the probe finished.
  const baseChannelModes: AgentMicChannelMode[] = [
    'default',
    'mono',
    'stereo',
    'left',
    'right',
  ];
  const detectedMultiChannelCount =
    detectedChannelCount !== null && detectedChannelCount >= 3
      ? detectedChannelCount
      : 0;
  const dynamicChannelIndices: number[] = [];
  for (let i = 1; i <= detectedMultiChannelCount; i += 1) {
    dynamicChannelIndices.push(i);
  }
  // Ensure the saved mode is in the option list even if the probe hasn't
  // populated channel-N options yet (or the device is disconnected).
  const savedChannelIndex = parseAgentMicChannelIndex(micChannelMode);
  if (
    savedChannelIndex !== null &&
    !dynamicChannelIndices.includes(savedChannelIndex)
  ) {
    dynamicChannelIndices.push(savedChannelIndex);
    dynamicChannelIndices.sort((a, b) => a - b);
  }
  const micChannelModes: AgentMicChannelMode[] = [
    ...baseChannelModes,
    ...dynamicChannelIndices.map((index) => buildAgentMicChannelMode(index)),
  ];

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
              title={`Use ${AGENT_PROVIDER_LABELS[providerId]} as the AI provider`}
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
      </div>

      <div className="agent-settings-section">
        <label
          className="agent-settings-toggle-row"
          title="When ON, opening a new track in fullscreen mastering automatically asks the AI for per-metric recommendations. Turn OFF to avoid automatic LLM spend — the Regenerate button still works manually."
        >
          <input
            type="checkbox"
            className="agent-settings-toggle-input"
            checked={autoRecommendEnabled}
            onChange={(event) => onAutoRecommendEnabledChange(event.target.checked)}
            data-testid="agent-settings-auto-recommend-toggle"
          />
          <span className="agent-settings-toggle-label">
            Auto-generate mastering recommendations when opening tracks
          </span>
        </label>
        <p
          className="agent-settings-key-help"
          data-testid="agent-settings-auto-recommend-help"
        >
          {autoRecommendEnabled
            ? 'The agent runs automatically the first time each track/version is opened in fullscreen mastering.'
            : 'Auto-run is OFF. Click "Regenerate AI recommendations" in fullscreen mastering to fire a run manually.'}
        </p>
      </div>

      {/* Item #13 (v3.113) — DANGEROUS bypass-permissions toggle. Off by
          default. When ON, the spawned CLI is invoked with the provider's
          "skip permissions / bypass approvals" flag, giving the agent
          unrestricted file-system + shell access. Mirrors T3 Code's
          `runtimeMode: 'full-access'` behavior, adapted to PP's
          direct-CLI-spawn architecture. Persisted in unified state via
          `agentDangerouslyBypassPermissions`. */}
      <div className="agent-settings-section agent-settings-section--danger">
        <label
          className="agent-settings-toggle-row"
          title="DANGEROUS. When ON, the AI agent runs with no permission checks and gets full read/write access to your file system and shell. Only enable if you trust what you're about to ask the agent to do."
        >
          <input
            type="checkbox"
            className="agent-settings-toggle-input"
            checked={dangerouslyBypassPermissions}
            onChange={(event) =>
              onDangerouslyBypassPermissionsChange(event.target.checked)
            }
            data-testid="agent-settings-bypass-permissions-toggle"
          />
          <span className="agent-settings-toggle-label">
            Bypass CLI permission checks (DANGEROUS — gives the AI full
            file-system access)
          </span>
        </label>
        <p
          className="agent-settings-key-help"
          data-testid="agent-settings-bypass-permissions-help"
        >
          {dangerouslyBypassPermissions
            ? 'ON. Every new agent session passes the provider’s "dangerously skip permissions / bypass approvals" flag to the underlying CLI. The agent can read and modify any file, run any shell command, and is NOT prompted before doing so. Turn this OFF unless you specifically need full-access mode.'
            : 'OFF (recommended). The agent CLI runs with its normal permission/approval gating. Turn ON only when you intentionally want the agent to have unrestricted file-system + shell access.'}
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
              title={`Use ${AGENT_STT_PROVIDER_LABELS[providerId]} for speech-to-text`}
            >
              {AGENT_STT_PROVIDER_LABELS[providerId]}
            </button>
          ))}
        </div>
        <p className="agent-settings-key-help" data-testid="agent-stt-provider-help">
          Save both keys if you want, then switch between providers any time.
        </p>
      </div>

      <details
        className="agent-settings-section agent-settings-expander"
        data-testid="agent-mic-settings-expander"
      >
        <summary className="agent-settings-expander-summary">
          <span>Microphone input</span>
          <span className="agent-settings-expander-value">
            {selectedMicDeviceId === 'default' ? 'System default' : 'Custom'} ·{' '}
            {getAgentMicChannelModeLabel(micChannelMode)}
          </span>
        </summary>

        <div className="agent-settings-expander-body">
          <div className="agent-settings-section">
            <label className="agent-settings-label" htmlFor="agent-mic-device-select">
              Microphone
            </label>
            <div className="agent-settings-key-row">
              <select
                id="agent-mic-device-select"
                className="agent-settings-model-select"
                value={selectedMicDeviceId}
                onChange={(event) => handleMicDeviceChange(event.target.value)}
                disabled={controlsDisabled || micDevicesLoading}
                data-testid="agent-mic-device-select"
              >
                <option value="default">System default microphone</option>
                {selectedMicMissing ? (
                  <option value={selectedMicDeviceId}>Saved microphone unavailable</option>
                ) : null}
                {listedAudioInputDevices.map((device, index) => (
                  <option key={device.deviceId || `mic-${index}`} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="agent-settings-key-clear"
                onClick={() => void refreshMicDevices()}
                disabled={controlsDisabled || micDevicesLoading}
                data-testid="agent-mic-refresh"
                title="Refresh microphone list"
              >
                {micDevicesLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <p className="agent-settings-key-help" data-testid="agent-mic-device-help">
              Pick the exact input Producey Boy should record from. If names are blank,
              click the mic button once to grant permission, then refresh this list.
            </p>
            {micDevicesError ? (
              <p className="agent-settings-key-error" data-testid="agent-mic-device-error">
                {micDevicesError}
              </p>
            ) : null}
          </div>

          <div className="agent-settings-section">
            <label className="agent-settings-label" htmlFor="agent-mic-channel-select">
              Channel
            </label>
            <select
              id="agent-mic-channel-select"
              className="agent-settings-model-select"
              value={micChannelMode}
              onChange={(event) =>
                handleMicChannelModeChange(event.target.value as AgentMicChannelMode)
              }
              disabled={controlsDisabled}
              data-testid="agent-mic-channel-select"
            >
              {micChannelModes.map((channelMode) => (
                <option key={channelMode} value={channelMode}>
                  {getAgentMicChannelModeLabel(channelMode)}
                </option>
              ))}
            </select>
            <p className="agent-settings-key-help" data-testid="agent-mic-channel-help">
              {detectedChannelCount !== null && detectedChannelCount >= 3 ? (
                <>
                  Detected {detectedChannelCount} input channels. Pick a specific
                  Channel N to route that raw input through to recording — useful
                  for multi-channel interfaces (Scarlett 18i8, RME, etc.) where
                  the mic isn't on channels 1/2.
                </>
              ) : (
                <>
                  Use mono/stereo when the device supports it, or force only the
                  left/right channel when an interface is wired to one side.
                </>
              )}
            </p>
            {channelDetectError ? (
              <p
                className="agent-settings-key-error"
                data-testid="agent-mic-channel-detect-error"
              >
                {channelDetectError}
              </p>
            ) : null}
          </div>
        </div>
      </details>

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
              title="Clear the saved Deepgram API key"
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
              title="Save the Deepgram API key"
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
              title="Clear the saved AssemblyAI API key"
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
              title="Save the AssemblyAI API key"
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
          title="Clear the current conversation and start fresh"
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
