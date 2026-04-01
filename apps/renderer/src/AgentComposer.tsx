import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  AGENT_VOICE_SETTINGS_UPDATED_EVENT,
  readStoredAgentSttProvider,
  type AgentSttProviderId,
} from './agentVoiceSettings';

interface AgentComposerProps {
  onSend: (message: string) => void | Promise<void>;
  onInterrupt: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

const MAX_ROWS = 6;
const MIN_ROWS = 1;
const DEEPGRAM_TRANSCRIBE_URL =
  'https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true';
const ASSEMBLYAI_UPLOAD_URL = 'https://api.assemblyai.com/v2/upload';
const ASSEMBLYAI_TRANSCRIPT_URL = 'https://api.assemblyai.com/v2/transcript';
const ASSEMBLYAI_POLL_INTERVAL_MS = 800;
const ASSEMBLYAI_MAX_POLL_ATTEMPTS = 45;

function normalizeStoredKey(key: string | null): string | null {
  const trimmed = key?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

async function readKeyForProvider(
  provider: AgentSttProviderId
): Promise<string | null> {
  const key =
    provider === 'deepgram'
      ? await window.producerPlayer.agentGetDeepgramKey()
      : await window.producerPlayer.agentGetAssemblyAiKey();

  return normalizeStoredKey(key);
}

function getProviderDisplayName(provider: AgentSttProviderId): string {
  return provider === 'deepgram' ? 'Deepgram' : 'AssemblyAI';
}

function readDeepgramTranscript(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return '';
  }

  const result = payload as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{
          transcript?: unknown;
        }>;
      }>;
    };
  };

  const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return typeof transcript === 'string' ? transcript.trim() : '';
}

async function transcribeWithDeepgram(audioBlob: Blob, key: string): Promise<string> {
  const response = await fetch(DEEPGRAM_TRANSCRIBE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Token ${key}`,
      'Content-Type': audioBlob.type || 'audio/webm',
    },
    body: audioBlob,
  });

  if (!response.ok) {
    throw new Error(`Deepgram API error: ${response.status}`);
  }

  const result = (await response.json()) as unknown;
  return readDeepgramTranscript(result);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function transcribeWithAssemblyAi(audioBlob: Blob, key: string): Promise<string> {
  const uploadResponse = await fetch(ASSEMBLYAI_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: key,
      'Content-Type': 'application/octet-stream',
    },
    body: audioBlob,
  });

  if (!uploadResponse.ok) {
    throw new Error(`AssemblyAI upload failed: ${uploadResponse.status}`);
  }

  const uploadPayload = (await uploadResponse.json()) as {
    upload_url?: unknown;
  };
  const uploadUrl =
    typeof uploadPayload.upload_url === 'string' ? uploadPayload.upload_url : null;

  if (!uploadUrl) {
    throw new Error('AssemblyAI upload response is missing upload_url.');
  }

  const transcriptResponse = await fetch(ASSEMBLYAI_TRANSCRIPT_URL, {
    method: 'POST',
    headers: {
      Authorization: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: uploadUrl,
      speech_model: 'universal',
    }),
  });

  if (!transcriptResponse.ok) {
    throw new Error(`AssemblyAI transcript start failed: ${transcriptResponse.status}`);
  }

  const transcriptPayload = (await transcriptResponse.json()) as {
    id?: unknown;
  };
  const transcriptId =
    typeof transcriptPayload.id === 'string' ? transcriptPayload.id : null;

  if (!transcriptId) {
    throw new Error('AssemblyAI transcript response is missing id.');
  }

  for (let attempt = 0; attempt < ASSEMBLYAI_MAX_POLL_ATTEMPTS; attempt += 1) {
    const statusResponse = await fetch(
      `${ASSEMBLYAI_TRANSCRIPT_URL}/${transcriptId}`,
      {
        method: 'GET',
        headers: {
          Authorization: key,
        },
      }
    );

    if (!statusResponse.ok) {
      throw new Error(`AssemblyAI transcript poll failed: ${statusResponse.status}`);
    }

    const statusPayload = (await statusResponse.json()) as {
      status?: unknown;
      text?: unknown;
      error?: unknown;
    };

    const status =
      typeof statusPayload.status === 'string' ? statusPayload.status : null;

    if (status === 'completed') {
      return typeof statusPayload.text === 'string'
        ? statusPayload.text.trim()
        : '';
    }

    if (status === 'error') {
      const errorMessage =
        typeof statusPayload.error === 'string'
          ? statusPayload.error
          : 'AssemblyAI transcription failed.';
      throw new Error(errorMessage);
    }

    await sleep(ASSEMBLYAI_POLL_INTERVAL_MS);
  }

  throw new Error('AssemblyAI transcription timed out.');
}

async function transcribeAudioBlob(
  provider: AgentSttProviderId,
  audioBlob: Blob,
  key: string
): Promise<string> {
  if (provider === 'deepgram') {
    return transcribeWithDeepgram(audioBlob, key);
  }

  return transcribeWithAssemblyAi(audioBlob, key);
}

export function AgentComposer({
  onSend,
  onInterrupt,
  isStreaming,
  disabled = false,
}: AgentComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [sttProvider, setSttProvider] = useState<AgentSttProviderId>(() =>
    readStoredAgentSttProvider()
  );
  const [hasSelectedProviderKey, setHasSelectedProviderKey] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const refreshVoiceSettings = useCallback(async () => {
    try {
      const provider = readStoredAgentSttProvider();
      setSttProvider(provider);
      const key = await readKeyForProvider(provider);
      setHasSelectedProviderKey(Boolean(key));
    } catch {
      setHasSelectedProviderKey(false);
    }
  }, []);

  useEffect(() => {
    void refreshVoiceSettings();

    const handleVoiceSettingsUpdated = () => {
      void refreshVoiceSettings();
    };

    window.addEventListener(
      AGENT_VOICE_SETTINGS_UPDATED_EVENT,
      handleVoiceSettingsUpdated
    );

    return () => {
      window.removeEventListener(
        AGENT_VOICE_SETTINGS_UPDATED_EVENT,
        handleVoiceSettingsUpdated
      );
    };
  }, [refreshVoiceSettings]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const lineHeight = 20;
    const maxHeight = lineHeight * MAX_ROWS;
    const scrollHeight = textarea.scrollHeight;
    textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    void onSend(trimmed);
    setText('');
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleMicToggle = useCallback(async () => {
    if (!hasSelectedProviderKey || disabled || isStreaming) {
      return;
    }

    if (isRecording) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : null;

      const mediaRecorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;
      const activeProvider = sttProvider;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || 'audio/webm',
        });
        audioChunksRef.current = [];

        const key = await readKeyForProvider(activeProvider);
        if (!key) {
          await refreshVoiceSettings();
          return;
        }

        try {
          const transcript = await transcribeAudioBlob(activeProvider, audioBlob, key);

          if (transcript) {
            setText((previous) =>
              previous ? `${previous} ${transcript}` : transcript
            );
            textareaRef.current?.focus();
          }
        } catch (error) {
          console.error(
            `Voice transcription failed (${getProviderDisplayName(activeProvider)}):`,
            error
          );
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  }, [
    disabled,
    hasSelectedProviderKey,
    isRecording,
    isStreaming,
    refreshVoiceSettings,
    sttProvider,
  ]);

  const canSend = text.trim().length > 0 && !disabled;
  const voiceSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined';
  const showMic = !isStreaming;
  const micEnabled = hasSelectedProviderKey && voiceSupported && !disabled;
  const providerDisplayName = getProviderDisplayName(sttProvider);
  const micTitle = !hasSelectedProviderKey
    ? `Add ${providerDisplayName} API key in Settings to enable voice input`
    : !voiceSupported
      ? 'Voice input is not supported in this environment'
      : isRecording
        ? `Stop recording (${providerDisplayName})`
        : `Record voice message (${providerDisplayName})`;

  return (
    <div className="agent-composer" data-testid="agent-composer">
      <div className="agent-composer-input-row">
        <textarea
          ref={textareaRef}
          className="agent-composer-textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? 'Producey Boy is unavailable'
              : 'Ask Producey Boy about your master...'
          }
          disabled={disabled}
          rows={MIN_ROWS}
          data-testid="agent-composer-input"
        />
        <div className="agent-composer-buttons">
          {showMic ? (
            <button
              type="button"
              className={`agent-mic-button ${isRecording ? 'agent-mic-button--recording' : ''}`}
              onClick={() => void handleMicToggle()}
              data-testid="agent-mic-button"
              title={micTitle}
              disabled={!micEnabled}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          ) : null}

          {isStreaming ? (
            <button
              type="button"
              className="agent-stop-button"
              onClick={onInterrupt}
              data-testid="agent-stop-button"
              title="Stop generation"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : null}

          <button
            type="button"
            className={`agent-send-button ${isStreaming ? 'agent-send-button--steer' : ''}`}
            onClick={handleSend}
            disabled={!canSend}
            data-testid="agent-send-button"
            title={isStreaming ? 'Steer with follow-up message' : 'Send message'}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
