import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { AgentAttachment } from '@producer-player/contracts';
import {
  appendBlockquoteToComposerText,
  formatSelectionAsBlockquote,
} from './agentChatSelection';
import {
  AGENT_VOICE_SETTINGS_UPDATED_EVENT,
  getAgentMicChannelModeLabel,
  readStoredAgentMicChannelMode,
  readStoredAgentMicDeviceId,
  readStoredAgentSttProvider,
  type AgentMicChannelMode,
  type AgentSttProviderId,
} from './agentVoiceSettings';
import {
  buildRecordingGraph,
  errorToMessage,
  getAudioConstraints,
  getProviderDisplayName,
  stopMediaStream,
  transcribeAudioBlob,
} from './lib/sttTranscribe';
import { requestOpenAgentSettings } from './AgentChatPanel';

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

/**
 * v3.267 — Imperative handle exposed to the parent (`AgentChatPanel`) for the
 * "Floating selection → Add to chat" feature. Lets the panel push a quoted
 * reference into the composer input WITHOUT lifting `text` state up (which
 * would mean re-plumbing the entire composer + its auto-resize / mic / send
 * flow). The handle is intentionally narrow — only the operations the
 * selection-tooltip feature needs.
 */
export interface AgentComposerHandle {
  /**
   * Append the given selection text to the composer input as a Markdown
   * blockquote, then focus the textarea so the user can immediately type
   * their question. Idempotent-by-content: each call appends a NEW quote;
   * we never overwrite existing input (Ethan voice 7199: "each adds another
   * reference to the input. Don't overwrite.").
   */
  appendQuotedSelection: (text: string) => void;
}

/**
 * v3.239 — true when `getUserMedia` rejected because the user / OS denied
 * microphone access. See identical helper in `lib/useMicTranscribe.ts`.
 */
function isMicPermissionError(error: unknown): boolean {
  if (!error) return false;
  const name =
    typeof (error as { name?: unknown }).name === 'string'
      ? (error as { name: string }).name
      : '';
  const message =
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message.toLowerCase()
      : '';
  return (
    name === 'NotAllowedError' ||
    name === 'SecurityError' ||
    message.includes('permission denied') ||
    message.includes('not allowed')
  );
}

function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type MicState = 'idle' | 'arming' | 'recording' | 'processing' | 'error';

interface ToastMessage {
  id: number;
  text: string;
}

const MAX_ROWS = 6;
const MIN_ROWS = 1;
const TOAST_AUTO_DISMISS_MS = 5000;
const WAVEFORM_BAR_COUNT = 24;
const WAVEFORM_UPDATE_INTERVAL_MS = 50;
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

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
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

export const AgentComposer = forwardRef<AgentComposerHandle, AgentComposerProps>(
  function AgentComposer(
    {
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
    }: AgentComposerProps,
    forwardedRef,
  ): JSX.Element {
  const [text, setText] = useState('');
  const [micState, setMicState] = useState<MicState>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [sttProvider, setSttProvider] = useState<AgentSttProviderId>(() =>
    readStoredAgentSttProvider()
  );
  const [micDeviceId, setMicDeviceId] = useState(() =>
    readStoredAgentMicDeviceId()
  );
  const [micChannelMode, setMicChannelMode] = useState<AgentMicChannelMode>(() =>
    readStoredAgentMicChannelMode()
  );
  const [hasSelectedProviderKey, setHasSelectedProviderKey] = useState(false);
  const voiceSettingsCheckedRef = useRef(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isArming = micState === 'arming';
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

  // v3.267 — Imperative handle for the floating "Add to chat" tooltip. When
  // the user clicks Add, AgentChatPanel calls `appendQuotedSelection(text)`
  // here, which:
  //   1. Formats the selection as a Markdown blockquote (pure helper),
  //   2. Concatenates onto current input with exactly one blank-line gap,
  //   3. Focuses the textarea + scrolls the caret to the end so the next
  //      keystroke continues after the quote.
  // We use the functional `setText(prev => ...)` form so simultaneous quote
  // additions (e.g. two fast clicks) don't drop one due to stale closure.
  // The auto-resize useEffect downstream picks up the new content on the
  // next render — no manual layout poke required.
  useImperativeHandle(
    forwardedRef,
    () => ({
      appendQuotedSelection(rawText: string) {
        const blockquote = formatSelectionAsBlockquote(rawText);
        if (blockquote.length === 0) return;
        setText((previous) => appendBlockquoteToComposerText(previous, blockquote));
        // Defer focus to the next tick so the state update has flushed and
        // the textarea's auto-grow has applied — focusing earlier can land
        // the caret in the OLD (smaller) textarea and visually pop.
        window.requestAnimationFrame(() => {
          const node = textareaRef.current;
          if (!node) return;
          node.focus();
          // Move caret to the very end so the next keystroke continues below
          // the quote (the appendBlockquoteToComposerText helper already
          // leaves two trailing newlines for the caret to land on).
          const len = node.value.length;
          try {
            node.setSelectionRange(len, len);
          } catch {
            /* selectionRange isn't supported on all textarea modes; ignore */
          }
          // Scroll caret into view for long composer content.
          node.scrollTop = node.scrollHeight;
        });
      },
    }),
    [],
  );

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
      setMicDeviceId(readStoredAgentMicDeviceId());
      setMicChannelMode(readStoredAgentMicChannelMode());
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
      stopMediaStream(recordingStreamRef.current);
      recordingStreamRef.current = null;
      stopMediaStream(mediaStreamRef.current);
      mediaStreamRef.current = null;
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
    if (disabled || isStreaming || isArming || isProcessing) {
      return;
    }

    if (isRecording) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      stopDurationTimer();
      return;
    }

    setMicState('arming');
    setRecordingDuration(0);

    const activeProvider = readStoredAgentSttProvider();
    const activeDeviceId = readStoredAgentMicDeviceId();
    const activeChannelMode = readStoredAgentMicChannelMode();
    setSttProvider(activeProvider);
    setMicDeviceId(activeDeviceId);
    setMicChannelMode(activeChannelMode);

    // Lazy-check the API key on first mic interaction to avoid
    // reading the stored key file on app startup.
    let key: string | null = null;
    if (!voiceSettingsCheckedRef.current) {
      voiceSettingsCheckedRef.current = true;
      await refreshVoiceSettings();
      key = await readKeyForProvider(activeProvider);
      if (!key) {
        const providerName = getProviderDisplayName(activeProvider);
        // v3.239 — reroute the user straight to the relevant API key
        // section in the Settings tab so they can configure it without
        // hunting for the panel.
        requestOpenAgentSettings({ scrollTo: 'sttKey' });
        showToast(
          `Set up a ${providerName} API key in Producey Boy settings to enable voice input`
        );
        flashError();
        return;
      }
      // Key exists — fall through to start recording
    } else if (!hasSelectedProviderKey) {
      const providerName = getProviderDisplayName(activeProvider);
      requestOpenAgentSettings({ scrollTo: 'sttKey' });
      showToast(
        `Set up a ${providerName} API key in Producey Boy settings to enable voice input`
      );
      flashError();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        getAudioConstraints(activeDeviceId, activeChannelMode)
      );
      mediaStreamRef.current = stream;

      const { audioContext, analyser, recordingStream } = buildRecordingGraph(
        stream,
        activeChannelMode
      );
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      recordingStreamRef.current = recordingStream;

      if (audioContext.state === 'suspended') {
        await audioContext.resume().catch(() => undefined);
      }

      const preferredMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : null;

      const mediaRecorder = preferredMimeType
        ? new MediaRecorder(recordingStream, { mimeType: preferredMimeType })
        : new MediaRecorder(recordingStream);

      audioChunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stopMediaStream(recordingStream);
        recordingStreamRef.current = null;
        stopMediaStream(stream);
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        cleanupAudioContext();
        setMicState('processing');

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || 'audio/webm',
        });
        audioChunksRef.current = [];

        key ??= await readKeyForProvider(activeProvider);
        if (!key) {
          await refreshVoiceSettings();
          requestOpenAgentSettings({ scrollTo: 'sttKey' });
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
      stopMediaStream(recordingStreamRef.current);
      recordingStreamRef.current = null;
      stopMediaStream(mediaStreamRef.current);
      mediaStreamRef.current = null;
      cleanupAudioContext();
      // v3.239 — if the mic was blocked at the OS / browser permission
      // layer, send the user to the Settings panel so they can grant
      // microphone permission (the row sits adjacent to the API key
      // sections we anchor to).
      if (isMicPermissionError(error)) {
        requestOpenAgentSettings({ scrollTo: 'sttKey' });
      }
      showToast(errorToMessage(error));
      flashError();
    }
  }, [
    cleanupAudioContext,
    disabled,
    flashError,
    hasSelectedProviderKey,
    isArming,
    isProcessing,
    isRecording,
    isStreaming,
    refreshVoiceSettings,
    showToast,
    startDurationTimer,
    stopDurationTimer,
  ]);

  const canSend = (text.trim().length > 0 || hasAttachments) && !disabled;
  const voiceSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined';
  // v3.108 — keep the mic visible even while the assistant is streaming an
  // answer. Previously it was hidden and replaced by the stop button so the
  // user couldn't start dictating their next prompt without aborting the
  // current generation. Now the mic is always present; the stop button sits
  // alongside it (only when streaming) so the user can do both.
  const showMic = true;
  const micClickable = voiceSupported && !disabled && !isArming && !isProcessing;
  const providerDisplayName = getProviderDisplayName(sttProvider);
  const micInputTitle = [
    micDeviceId === 'default' ? 'default microphone' : 'selected microphone',
    getAgentMicChannelModeLabel(micChannelMode).toLowerCase(),
  ].join(' · ');
  const micTitle = voiceSettingsCheckedRef.current && !hasSelectedProviderKey
    ? `Add ${providerDisplayName} API key in Settings to enable voice input`
    : !voiceSupported
      ? 'Voice input is not supported in this environment'
      : isArming
        ? `Opening ${micInputTitle}...`
        : isProcessing
          ? `Transcribing with ${providerDisplayName}...`
          : isRecording
            ? `Stop recording (${providerDisplayName})`
            : `Record voice message (${providerDisplayName}; ${micInputTitle})`;

  const micButtonClass = [
    'agent-mic-button',
    isArming ? 'agent-mic-button--arming' : '',
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

      {/* Instant microphone feedback */}
      {isArming ? (
        <div className="agent-processing-overlay" data-testid="agent-mic-arming-overlay">
          <div className="agent-processing-spinner" />
          <span className="agent-processing-label">Opening microphone...</span>
        </div>
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
          disabled={disabled || isRecording || isArming || isProcessing}
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
              {isArming || isProcessing ? (
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
  },
);
