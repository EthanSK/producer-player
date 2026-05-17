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
  getAgentMicChannelModeLabel,
  parseAgentMicChannelIndex,
  readStoredAgentMicChannelMode,
  readStoredAgentMicDeviceId,
  readStoredAgentSttProvider,
  type AgentMicChannelMode,
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
  if (error instanceof DOMException && error.name === 'OverconstrainedError') {
    return 'Selected microphone is unavailable. Pick another microphone in Producey Boy settings.';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unknown error occurred.';
}

function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function getAudioConstraints(
  deviceId: string,
  channelMode: AgentMicChannelMode
): MediaStreamConstraints {
  const audioConstraints: MediaTrackConstraints = {};

  if (deviceId !== 'default') {
    audioConstraints.deviceId = { exact: deviceId };
  }

  // v3.108 — Scarlett 18i8 / RME / multi-channel interface fix:
  // Always supply a channelCount hint, even for "default" mode. Without
  // one, getUserMedia hands back the device's native channel count
  // (e.g. 18 channels for the 18i8), and Web Audio's standard speaker
  // mixers do NOT know how to fold N!=1,2,4,6 down to mono — the analyser
  // sees silence, the MediaRecorder produces an Opus stream with too many
  // channels, and Deepgram/AssemblyAI return an empty transcript.
  //
  // v3.121 (Concern 2) — for `channel-N` (specific raw input), DO NOT
  // force a `channelCount: 1` constraint. The browser would honor the
  // ideal=1 hint and downmix the multi-channel input before we ever see
  // it, dropping channels 2..N. We must accept the device's full
  // channel layout so the splitter in buildRecordingGraph can route the
  // user's chosen channel. Most platforms cap raw multi-channel input at
  // the device's native channel count; passing `ideal: oneBasedIndex`
  // tells the browser "I want at least this many channels." Falling back
  // to `audio: true` works on Chromium/Electron where the constraint is
  // best-effort.
  const requestedChannelIndex = parseAgentMicChannelIndex(channelMode);
  if (requestedChannelIndex !== null) {
    audioConstraints.channelCount = { ideal: requestedChannelIndex };
  } else if (channelMode === 'mono' || channelMode === 'default') {
    audioConstraints.channelCount = { ideal: 1 };
  } else if (
    channelMode === 'stereo' ||
    channelMode === 'left' ||
    channelMode === 'right'
  ) {
    audioConstraints.channelCount = { ideal: 2 };
  }

  return Object.keys(audioConstraints).length > 0
    ? { audio: audioConstraints }
    : { audio: true };
}

/**
 * Read the actual channel count of the negotiated input stream. The
 * `getUserMedia` `channelCount` constraint is `ideal`, not `exact`, so
 * a multi-channel interface (Scarlett 18i8 etc.) may still return more
 * than 1/2 channels. We need the real number to size the splitter
 * correctly — using a splitter with the wrong channel count silently
 * drops audio.
 */
function getInputStreamChannelCount(stream: MediaStream): number {
  const track = stream.getAudioTracks()[0];
  if (!track) return 1;
  const settings = track.getSettings();
  // `MediaTrackSettings.channelCount` is the spec-defined property but
  // not all browsers populate it for every device class. Fall back to a
  // sensible default of 2 (the most common stereo mic case).
  if (typeof settings.channelCount === 'number' && settings.channelCount > 0) {
    return settings.channelCount;
  }
  return 2;
}

function buildRecordingGraph(
  inputStream: MediaStream,
  channelMode: AgentMicChannelMode
): {
  audioContext: AudioContext;
  analyser: AnalyserNode;
  recordingStream: MediaStream;
} {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(inputStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.7;

  const sourceChannelCount = Math.max(1, getInputStreamChannelCount(inputStream));

  // v3.108 — for multi-channel interfaces (Scarlett 18i8 with 18 inputs,
  // RME with 12, etc.), connecting `source` directly to `analyser` invokes
  // the WebAudio default channel mixer, which only knows the 1/2/4/6
  // speaker layouts. With 18 channels the result is silent (or
  // implementation-defined). Always run through a splitter so we
  // deterministically pick channel 0 for mono/default, channel 0+1 for
  // stereo, or the requested channel for left/right. Bonus: this also
  // gives us a clean MediaStreamDestination to feed MediaRecorder with,
  // instead of routing the raw multi-channel stream through it (which
  // produces an Opus/WebM file the STT services can't decode).
  const splitter = audioContext.createChannelSplitter(sourceChannelCount);
  source.connect(splitter);
  const destination = audioContext.createMediaStreamDestination();

  // v3.121 (Concern 2) — explicit `channel-N` mode for multi-channel
  // interfaces (Scarlett 18i8, RME, etc.). Routes the (N-1)-th splitter
  // output to both analyser and MediaRecorder destination. Clamps to the
  // device's actual channel count so a user who picked Channel 12 on a
  // 2-channel device still gets a usable stream (channel 1) rather than
  // silence.
  const requestedChannelIndex = parseAgentMicChannelIndex(channelMode);
  if (requestedChannelIndex !== null) {
    const zeroBasedIndex = requestedChannelIndex - 1;
    const outputIndex = Math.min(zeroBasedIndex, sourceChannelCount - 1);
    splitter.connect(analyser, outputIndex);
    splitter.connect(destination, outputIndex);
    return { audioContext, analyser, recordingStream: destination.stream };
  }

  if (channelMode === 'left' || channelMode === 'right') {
    // Stereo split: route the chosen side to both analyser and recorder.
    // Fall back to channel 0 if the device only delivered one channel
    // (defensive — should be rare given the channelCount: { ideal: 2 }
    // constraint).
    const desiredIndex = channelMode === 'left' ? 0 : 1;
    const outputIndex = Math.min(desiredIndex, sourceChannelCount - 1);
    splitter.connect(analyser, outputIndex);
    splitter.connect(destination, outputIndex);
    return { audioContext, analyser, recordingStream: destination.stream };
  }

  if (channelMode === 'stereo') {
    // True stereo: merge channels 0+1 back into a 2-channel stream so
    // both the analyser and the recorder see well-formed stereo audio.
    const merger = audioContext.createChannelMerger(2);
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, Math.min(1, sourceChannelCount - 1), 1);
    merger.connect(analyser);
    merger.connect(destination);
    return { audioContext, analyser, recordingStream: destination.stream };
  }

  // mono / default: take channel 0 only. This is the path that fixes
  // the Scarlett 18i8 "input 1, no waveform, empty transcription" bug.
  splitter.connect(analyser, 0);
  splitter.connect(destination, 0);
  return { audioContext, analyser, recordingStream: destination.stream };
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
        showToast(
          `Set up a ${providerName} API key in Producey Boy settings to enable voice input`
        );
        flashError();
        return;
      }
      // Key exists — fall through to start recording
    } else if (!hasSelectedProviderKey) {
      const providerName = getProviderDisplayName(activeProvider);
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
}
