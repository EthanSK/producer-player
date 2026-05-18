/**
 * useMicTranscribe — small wrapper around the same Deepgram / AssemblyAI
 * voice-input flow that powers the agent-chat composer. Designed to be
 * reused by any text input that wants a "tap mic, dictate, get a
 * transcript" affordance (e.g. the song / album checklist add-item input,
 * the in-place checklist item edit textarea, etc.).
 *
 * v3.236 (2026-05-17). The agent-chat composer keeps its own bespoke
 * version because it renders a waveform overlay; this hook deliberately
 * skips that visual flourish to keep the inline button minimal. The
 * underlying API-call code (getAudioConstraints, buildRecordingGraph,
 * transcribeWithDeepgram, transcribeWithAssemblyAi) and the voice-settings
 * storage are shared via `agentVoiceSettings.ts` and
 * `lib/sttTranscribe.ts`, so a bug fixed in either of those two flows
 * propagates here automatically.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AGENT_VOICE_SETTINGS_UPDATED_EVENT,
  readStoredAgentMicChannelMode,
  readStoredAgentMicDeviceId,
  readStoredAgentSttProvider,
  type AgentMicChannelMode,
  type AgentSttProviderId,
} from '../agentVoiceSettings';
import { requestOpenAgentSettings } from '../AgentChatPanel';
import {
  buildRecordingGraph,
  errorToMessage,
  getAudioConstraints,
  getProviderDisplayName,
  stopMediaStream,
  transcribeAudioBlob,
} from './sttTranscribe';

export type MicTranscribeState =
  | 'idle'
  | 'arming'
  | 'recording'
  | 'processing'
  | 'error';

const MIC_ERROR_FLASH_MS = 600;

export interface UseMicTranscribeOptions {
  /**
   * Called with the transcript text whenever a recording completes
   * successfully. The caller decides how to merge it with existing input
   * (append, replace, insert at caret, etc.).
   */
  onTranscript: (transcript: string) => void;
  /**
   * Called with a user-facing error message when something goes wrong
   * (mic permission denied, no API key, network failure, etc.). The
   * caller is responsible for surfacing this to the user (toast, inline
   * message, etc.).
   */
  onError?: (message: string) => void;
  /**
   * When true, the hook stays in idle and refuses to start recording.
   * Useful when the parent input is already disabled.
   */
  disabled?: boolean;
}

export interface UseMicTranscribeResult {
  state: MicTranscribeState;
  /**
   * True when the surrounding browser exposes the APIs we need
   * (getUserMedia + MediaRecorder). False on environments where the mic
   * UI should be hidden entirely.
   */
  voiceSupported: boolean;
  /**
   * True when clicking the button should do something (the mic is in
   * idle/recording, the env supports it, and the parent isn't disabled).
   */
  clickable: boolean;
  /**
   * Currently-selected provider (Deepgram / AssemblyAI). Useful for
   * generating tooltip text in the caller.
   */
  provider: AgentSttProviderId;
  /**
   * Toggle between idle and recording. Safe to call in any state — the
   * hook ignores the call if it's mid-arming or mid-processing.
   */
  toggle: () => Promise<void>;
}

/**
 * v3.239 — true when `getUserMedia` rejected because the user / OS denied
 * microphone access (NotAllowedError on Chromium / Webkit, "Permission
 * denied" on some older browsers). Distinguishes a permission failure
 * from a hardware / NotFoundError so we only reroute the user to the
 * settings panel when the fix is actually there.
 */
function isMicPermissionError(error: unknown): boolean {
  if (!error) return false;
  // DOMException has `name`; Error has `message`.
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

async function readKeyForProvider(
  provider: AgentSttProviderId
): Promise<string | null> {
  const key =
    provider === 'deepgram'
      ? await window.producerPlayer.agentGetDeepgramKey()
      : await window.producerPlayer.agentGetAssemblyAiKey();
  const trimmed = key?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function useMicTranscribe(
  options: UseMicTranscribeOptions
): UseMicTranscribeResult {
  const { onTranscript, onError, disabled = false } = options;

  const [state, setState] = useState<MicTranscribeState>('idle');
  const [provider, setProvider] = useState<AgentSttProviderId>(() =>
    readStoredAgentSttProvider()
  );

  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const errorFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashError = useCallback((message: string) => {
    onErrorRef.current?.(message);
    setState('error');
    if (errorFlashTimerRef.current) clearTimeout(errorFlashTimerRef.current);
    errorFlashTimerRef.current = setTimeout(() => {
      setState('idle');
      errorFlashTimerRef.current = null;
    }, MIC_ERROR_FLASH_MS);
  }, []);

  // Keep `provider` state in sync with stored value whenever the user
  // tweaks it in Producey Boy settings.
  useEffect(() => {
    const handleVoiceSettingsUpdated = () => {
      setProvider(readStoredAgentSttProvider());
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
  }, []);

  // Unmount-safe teardown — stop any live recording, close the audio
  // context, release the mic. Mirrors the equivalent block in
  // AgentComposer (the 2026-04-16 6ae527b fix).
  useEffect(() => {
    return () => {
      if (errorFlashTimerRef.current) clearTimeout(errorFlashTimerRef.current);
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          /* ignore */
        }
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

  const voiceSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined';

  const isArming = state === 'arming';
  const isRecording = state === 'recording';
  const isProcessing = state === 'processing';

  const clickable =
    voiceSupported && !disabled && !isArming && !isProcessing;

  const toggle = useCallback(async () => {
    if (disabled || isArming || isProcessing) return;

    if (isRecording) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    setState('arming');

    const activeProvider = readStoredAgentSttProvider();
    const activeDeviceId = readStoredAgentMicDeviceId();
    const activeChannelMode: AgentMicChannelMode = readStoredAgentMicChannelMode();
    setProvider(activeProvider);

    let key: string | null = null;
    try {
      key = await readKeyForProvider(activeProvider);
    } catch {
      key = null;
    }
    if (!key) {
      // v3.239 — instead of silently flashing the error and forcing the
      // user to hunt for the settings panel, open the Agent Chat panel,
      // switch to the Settings tab, and scroll to the relevant API key
      // section. We still show the error toast so the reason is clear.
      const providerName = getProviderDisplayName(activeProvider);
      requestOpenAgentSettings({ scrollTo: 'sttKey' });
      flashError(
        `Set up a ${providerName} API key in Producey Boy settings to enable voice input`
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        getAudioConstraints(activeDeviceId, activeChannelMode)
      );
      mediaStreamRef.current = stream;

      const { audioContext, recordingStream } = buildRecordingGraph(
        stream,
        activeChannelMode
      );
      audioContextRef.current = audioContext;
      recordingStreamRef.current = recordingStream;

      if (audioContext.state === 'suspended') {
        await audioContext.resume().catch(() => undefined);
      }

      const preferredMimeType = MediaRecorder.isTypeSupported(
        'audio/webm;codecs=opus'
      )
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
        if (audioContextRef.current) {
          void audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }
        setState('processing');

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || 'audio/webm',
        });
        audioChunksRef.current = [];

        if (!key) {
          requestOpenAgentSettings({ scrollTo: 'sttKey' });
          flashError(
            `${getProviderDisplayName(activeProvider)} API key is missing. Add it in Producey Boy settings.`
          );
          return;
        }

        try {
          const transcript = await transcribeAudioBlob(
            activeProvider,
            audioBlob,
            key
          );
          if (transcript) {
            onTranscriptRef.current(transcript);
          }
          setState('idle');
        } catch (error) {
          // Best-effort console log so dev tools surface the underlying
          // network/API response — matches the existing AgentComposer
          // behavior.
          console.error(
            `Voice transcription failed (${getProviderDisplayName(activeProvider)}):`,
            error
          );
          flashError(`Transcription failed: ${errorToMessage(error)}`);
        }
      };

      mediaRecorder.start();
      setState('recording');
    } catch (error) {
      console.error('Failed to start recording:', error);
      stopMediaStream(recordingStreamRef.current);
      recordingStreamRef.current = null;
      stopMediaStream(mediaStreamRef.current);
      mediaStreamRef.current = null;
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      // v3.239 — if the mic was blocked at the OS / browser permission
      // layer, send the user to the Settings panel so they can find the
      // microphone permission row (which sits right above the API key
      // sections). Anchor to the STT key section — it's adjacent and
      // ensures the mic-permission UI is visible.
      if (isMicPermissionError(error)) {
        requestOpenAgentSettings({ scrollTo: 'sttKey' });
      }
      flashError(errorToMessage(error));
    }
  }, [disabled, flashError, isArming, isProcessing, isRecording]);

  return {
    state,
    voiceSupported,
    clickable,
    provider,
    toggle,
  };
}
