/**
 * Shared speech-to-text + audio-graph helpers. Extracted from
 * AgentComposer.tsx in v3.236 so both the agent-chat composer AND the
 * lighter inline mic affordance on the checklist inputs can share the
 * exact same network / WebAudio code paths. Any bug fix to channel
 * routing or transcription handling propagates to both consumers.
 *
 * IMPORTANT — these helpers are intentionally side-effect-free and do
 * NOT touch React state. State management lives in the consumer (the
 * AgentComposer's own component-local state, or the lightweight
 * useMicTranscribe hook for checklist inputs).
 */

import {
  parseAgentMicChannelIndex,
  type AgentMicChannelMode,
  type AgentSttProviderId,
} from '../agentVoiceSettings';

const DEEPGRAM_TRANSCRIBE_URL =
  'https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true';
const ASSEMBLYAI_UPLOAD_URL = 'https://api.assemblyai.com/v2/upload';
const ASSEMBLYAI_TRANSCRIPT_URL = 'https://api.assemblyai.com/v2/transcript';
const ASSEMBLYAI_POLL_INTERVAL_MS = 800;
const ASSEMBLYAI_MAX_POLL_ATTEMPTS = 45;

export function getProviderDisplayName(provider: AgentSttProviderId): string {
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

export async function transcribeAudioBlob(
  provider: AgentSttProviderId,
  audioBlob: Blob,
  key: string
): Promise<string> {
  if (provider === 'deepgram') {
    return transcribeWithDeepgram(audioBlob, key);
  }
  return transcribeWithAssemblyAi(audioBlob, key);
}

export function errorToMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access denied. Check System Preferences → Privacy → Microphone';
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

export function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function getAudioConstraints(
  deviceId: string,
  channelMode: AgentMicChannelMode
): MediaStreamConstraints {
  const audioConstraints: MediaTrackConstraints = {};

  if (deviceId !== 'default') {
    audioConstraints.deviceId = { exact: deviceId };
  }

  // See v3.108 / v3.121 comments in AgentComposer for full rationale —
  // briefly: always set a channelCount hint so multi-channel interfaces
  // (Scarlett 18i8 etc.) don't return an N-channel stream that the
  // standard WebAudio mixer can't downmix; for `channel-N` modes pass
  // `ideal: N` so we still get the full layout to splitter-route from.
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

function getInputStreamChannelCount(stream: MediaStream): number {
  const track = stream.getAudioTracks()[0];
  if (!track) return 1;
  const settings = track.getSettings();
  if (typeof settings.channelCount === 'number' && settings.channelCount > 0) {
    return settings.channelCount;
  }
  return 2;
}

export function buildRecordingGraph(
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

  // Always run through a splitter so we deterministically pick channel 0
  // for mono/default, channel 0+1 for stereo, or the requested channel
  // for left/right/channel-N. See v3.108 / v3.121 history in
  // AgentComposer for the full multi-channel-interface story.
  const splitter = audioContext.createChannelSplitter(sourceChannelCount);
  source.connect(splitter);
  const destination = audioContext.createMediaStreamDestination();

  const requestedChannelIndex = parseAgentMicChannelIndex(channelMode);
  if (requestedChannelIndex !== null) {
    const zeroBasedIndex = requestedChannelIndex - 1;
    const outputIndex = Math.min(zeroBasedIndex, sourceChannelCount - 1);
    splitter.connect(analyser, outputIndex);
    splitter.connect(destination, outputIndex);
    return { audioContext, analyser, recordingStream: destination.stream };
  }

  if (channelMode === 'left' || channelMode === 'right') {
    const desiredIndex = channelMode === 'left' ? 0 : 1;
    const outputIndex = Math.min(desiredIndex, sourceChannelCount - 1);
    splitter.connect(analyser, outputIndex);
    splitter.connect(destination, outputIndex);
    return { audioContext, analyser, recordingStream: destination.stream };
  }

  if (channelMode === 'stereo') {
    const merger = audioContext.createChannelMerger(2);
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, Math.min(1, sourceChannelCount - 1), 1);
    merger.connect(analyser);
    merger.connect(destination);
    return { audioContext, analyser, recordingStream: destination.stream };
  }

  // mono / default: take channel 0 only.
  splitter.connect(analyser, 0);
  splitter.connect(destination, 0);
  return { audioContext, analyser, recordingStream: destination.stream };
}
