import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { AgentAttachment } from '@producer-player/contracts';
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
  attachments?: AgentAttachment[];
  attachmentError?: string | null;
  onRemoveAttachment?: (path: string) => void;
  onClearAttachments?: () => void;
  onDismissAttachmentError?: () => void;
  /**
   * Called when the user pastes files into the composer (cmd+v on a clipboard
   * image screenshot, etc). Mirrors T3 Code's onComposerPaste — we pass the
   * pasted files up so the panel can stage them alongside drag-and-drop.
   */
  onPasteFiles?: (files: File[]) => void;
}

function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type MicState = 'idle' | 'recording' | 'processing' | 'error';

interface ToastMessage {
  id: number;
  text: string;
}

const MAX_ROWS = 6;
const MIN_ROWS = 1;
const TOAST_AUTO_DISMISS_MS = 5000;
const WAVEFORM_BAR_COUNT = 24;
const WAVEFORM_UPDATE_INTERVAL_MS = 50;
const DEEPGRAM_TRANSCRIBE_URL =
  'https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true';
const ASSEMBLYAI_UPLOAD_URL = 'https://api.assemblyai.com/v2/upload';
const ASSEMBLYAI_TRANSCRIPT_URL = 'https://api.assemblyai.com/v2/transcript';
const ASSEMBLYAI_POLL_INTERVAL_MS = 800;
const ASSEMBLYAI_MAX_POLL_ATTEMPTS = 45;
const MIC_ERROR_FLASH_MS = 600;

let nextToastId = 1;

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
      speech_models: ['universal-3-pro'],
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

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function errorToMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access denied. Check System Preferences \u2192 Privacy \u2192 Microphone';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No microphone found. Please connect a microphone and try again.';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unknown error occurred.';
}

/* ── Toast component ────────────────────────────────────────── */

function AgentToast({
  message,
  onDismiss,
}: {
  message: ToastMessage;
  onDismiss: (id: number) => void;
}): JSX.Element {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(message.id), TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message.id, onDismiss]);

  return (
    <div className="agent-toast" data-testid="agent-toast">
      <span className="agent-toast-text">{message.text}</span>
      <button
        type="button"
        className="agent-toast-close"
        onClick={() => onDismiss(message.id)}
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}

/* ── Waveform visualizer ────────────────────────────────────── */

function RecordingWaveform({
  analyser,
  duration,
}: {
  analyser: AnalyserNode | null;
  duration: number;
}): JSX.Element {
  const [barHeights, setBarHeights] = useState<number[]>(
    () => Array.from({ length: WAVEFORM_BAR_COUNT }, () => 2)
  );
  const animFrameRef = useRef(0);

  useEffect(() => {
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let lastUpdate = 0;

    const tick = (time: number) => {
      if (time - lastUpdate >= WAVEFORM_UPDATE_INTERVAL_MS) {
        lastUpdate = time;
        analyser.getByteFrequencyData(dataArray);

        const step = Math.max(1, Math.floor(bufferLength / WAVEFORM_BAR_COUNT));
        const heights: number[] = [];
        for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
          const idx = Math.min(i * step, bufferLength - 1);
          // Map 0-255 to 2-20 (pixel height)
          heights.push(2 + (dataArray[idx] / 255) * 18);
        }
        setBarHeights(heights);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [analyser]);

  return (
    <div className="agent-recording-overlay" data-testid="agent-recording-overlay">
      <div className="agent-recording-indicator" />
      <div className="agent-waveform" data-testid="agent-waveform">
        {barHeights.map((h, i) => (
          <div
            key={i}
            className="agent-waveform-bar"
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
      <span className="agent-recording-timer" data-testid="agent-recording-timer">
        {formatDuration(duration)}
      </span>
    </div>
  );
}

/* ── Main composer ──────────────────────────────────────────── */

export function AgentComposer({
  onSend,
  onInterrupt,
  isStreaming,
  disabled = false,
  attachments = [],
  attachmentError = null,
  onRemoveAttachment,
  onClearAttachments,
  onDismissAttachmentError,
  onPasteFiles,
}: AgentComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const [micState, setMicState] = useState<MicState>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [sttProvider, setSttProvider] = useState<AgentSttProviderId>(() =>
    readStoredAgentSttProvider()
  );
  const [hasSelectedProviderKey, setHasSelectedProviderKey] = useState(false);
  const voiceSettingsCheckedRef = useRef(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isRecording = micState === 'recording';
  const isProcessing = micState === 'processing';

  const showToast = useCallback((text: string) => {
    const id = nextToastId;
    nextToastId += 1;
    setToasts((prev) => [...prev, { id, text }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const flashError = useCallback(() => {
    setMicState('error');
    if (errorFlashTimerRef.current) clearTimeout(errorFlashTimerRef.current);
    errorFlashTimerRef.current = setTimeout(() => {
      setMicState('idle');
      errorFlashTimerRef.current = null;
    }, MIC_ERROR_FLASH_MS);
  }, []);

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
    const handleVoiceSettingsUpdated = () => {
      voiceSettingsCheckedRef.current = true;
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

  // BUG FIX (2026-04-16, 6ae527b): unmount only closed AudioContext, leaving MediaRecorder and
  // MediaStream tracks running — mic stayed active after component unmount mid-recording.
  // Found by GPT-5.4 full-codebase audit, 2026-04-16.
  useEffect(() => {
    return () => {
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      if (errorFlashTimerRef.current) clearTimeout(errorFlashTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
        mediaRecorderRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, []);

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

  const hasAttachments = attachments.length > 0;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (disabled) return;
    if (!trimmed && !hasAttachments) return;
    void onSend(trimmed);
    setText('');
  }, [text, disabled, hasAttachments, onSend]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  const startDurationTimer = useCallback(() => {
    setRecordingDuration(0);
    stopDurationTimer();
    durationIntervalRef.current = setInterval(() => {
      setRecordingDuration((prev) => prev + 1);
    }, 1000);
  }, [stopDurationTimer]);

  const cleanupAudioContext = useCallback(() => {
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const handleMicToggle = useCallback(async () => {
    if (disabled || isStreaming || isProcessing) {
      return;
    }

    // Lazy-check the API key on first mic interaction to avoid
    // reading the stored key file on app startup.
    if (!voiceSettingsCheckedRef.current) {
      voiceSettingsCheckedRef.current = true;
      await refreshVoiceSettings();
      // Re-read current provider after refresh
      const currentProvider = readStoredAgentSttProvider();
      const key = await readKeyForProvider(currentProvider);
      if (!key) {
        const providerName = getProviderDisplayName(currentProvider);
        showToast(
          `Set up a ${providerName} API key in Producey Boy settings to enable voice input`
        );
        flashError();
        return;
      }
      // Key exists — fall through to start recording
    } else if (!hasSelectedProviderKey) {
      const providerName = getProviderDisplayName(sttProvider);
      showToast(
        `Set up a ${providerName} API key in Producey Boy settings to enable voice input`
      );
      flashError();
      return;
    }

    if (isRecording) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      stopDurationTimer();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Set up Web Audio API analyser for waveform
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyserRef.current = analyser;

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
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        cleanupAudioContext();
        setMicState('processing');

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || 'audio/webm',
        });
        audioChunksRef.current = [];

        const key = await readKeyForProvider(activeProvider);
        if (!key) {
          await refreshVoiceSettings();
          showToast(
            `${getProviderDisplayName(activeProvider)} API key is missing. Add it in Producey Boy settings.`
          );
          flashError();
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
          setMicState('idle');
        } catch (error) {
          console.error(
            `Voice transcription failed (${getProviderDisplayName(activeProvider)}):`,
            error
          );
          showToast(
            `Transcription failed: ${errorToMessage(error)}`
          );
          flashError();
        }
      };

      mediaRecorder.start();
      setMicState('recording');
      startDurationTimer();
    } catch (error) {
      console.error('Failed to start recording:', error);
      cleanupAudioContext();
      showToast(errorToMessage(error));
      flashError();
    }
  }, [
    cleanupAudioContext,
    disabled,
    flashError,
    hasSelectedProviderKey,
    isProcessing,
    isRecording,
    isStreaming,
    refreshVoiceSettings,
    showToast,
    startDurationTimer,
    stopDurationTimer,
    sttProvider,
  ]);

  const canSend = (text.trim().length > 0 || hasAttachments) && !disabled;
  const voiceSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined';
  const showMic = !isStreaming;
  const micClickable = voiceSupported && !disabled && !isProcessing;
  const providerDisplayName = getProviderDisplayName(sttProvider);
  const micTitle = voiceSettingsCheckedRef.current && !hasSelectedProviderKey
    ? `Add ${providerDisplayName} API key in Settings to enable voice input`
    : !voiceSupported
      ? 'Voice input is not supported in this environment'
      : isProcessing
        ? `Transcribing with ${providerDisplayName}...`
        : isRecording
          ? `Stop recording (${providerDisplayName})`
          : `Record voice message (${providerDisplayName})`;

  const micButtonClass = [
    'agent-mic-button',
    isRecording ? 'agent-mic-button--recording' : '',
    isProcessing ? 'agent-mic-button--processing' : '',
    micState === 'error' ? 'agent-mic-button--error' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="agent-composer" data-testid="agent-composer">
      {/* Attached-file chips (above the input) */}
      {hasAttachments ? (
        <div
          className="agent-attachment-chips"
          data-testid="agent-attachment-chips"
          aria-label={`${attachments.length} attached file${attachments.length === 1 ? '' : 's'}`}
        >
          {attachments.map((attachment) => (
            <div
              key={attachment.path}
              className="agent-attachment-chip"
              data-testid="agent-attachment-chip"
              title={`${attachment.name} — ${formatAttachmentSize(attachment.sizeBytes)}`}
            >
              <span className="agent-attachment-chip-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </span>
              <span className="agent-attachment-chip-name">{attachment.name}</span>
              <span className="agent-attachment-chip-size">
                {formatAttachmentSize(attachment.sizeBytes)}
              </span>
              <button
                type="button"
                className="agent-attachment-chip-remove"
                onClick={() => onRemoveAttachment?.(attachment.path)}
                data-testid="agent-attachment-chip-remove"
                title={`Remove ${attachment.name}`}
                aria-label={`Remove ${attachment.name}`}
              >
                ×
              </button>
            </div>
          ))}
          {attachments.length > 1 && onClearAttachments ? (
            <button
              type="button"
              className="agent-attachment-clear-all"
              onClick={onClearAttachments}
              data-testid="agent-attachment-clear-all"
              title="Remove all attachments"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}

      {attachmentError ? (
        <div
          className="agent-attachment-error"
          data-testid="agent-attachment-error"
          role="alert"
        >
          <span>{attachmentError}</span>
          <button
            type="button"
            className="agent-attachment-error-dismiss"
            onClick={() => onDismissAttachmentError?.()}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}

      {/* Recording waveform overlay */}
      {isRecording ? (
        <RecordingWaveform
          analyser={analyserRef.current}
          duration={recordingDuration}
        />
      ) : null}

      {/* Processing indicator */}
      {isProcessing ? (
        <div className="agent-processing-overlay" data-testid="agent-processing-overlay">
          <div className="agent-processing-spinner" />
          <span className="agent-processing-label">Transcribing...</span>
        </div>
      ) : null}

      <div className="agent-composer-input-row">
        <textarea
          ref={textareaRef}
          className="agent-composer-textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            if (!onPasteFiles) return;
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) return;
            event.preventDefault();
            onPasteFiles(files);
          }}
          placeholder={
            disabled
              ? 'Producey Boy is unavailable'
              : hasAttachments
                ? 'Add a note to send with your attachments (optional)...'
                : 'Ask Producey Boy about your master — or drag a file here to attach it.'
          }
          disabled={disabled || isRecording || isProcessing}
          rows={MIN_ROWS}
          data-testid="agent-composer-input"
        />
        <div className="agent-composer-buttons">
          {showMic ? (
            <button
              type="button"
              className={micButtonClass}
              onClick={() => void handleMicToggle()}
              data-testid="agent-mic-button"
              title={micTitle}
              disabled={!micClickable}
            >
              {isProcessing ? (
                <div className="agent-mic-spinner" />
              ) : (
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
              )}
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

      {/* Toast notifications */}
      {toasts.length > 0 ? (
        <div className="agent-toast-container" data-testid="agent-toast-container">
          {toasts.map((msg) => (
            <AgentToast key={msg.id} message={msg} onDismiss={dismissToast} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
