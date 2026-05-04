export const AGENT_VOICE_SETTINGS_UPDATED_EVENT = 'producer-player:agent-voice-settings-updated';

export type AgentSttProviderId = 'deepgram' | 'assemblyai';

/**
 * v3.121 (Concern 2) — extended channel mode set.
 *
 * The original four (mono / stereo / left / right) covered consumer 2-channel
 * mics but did not let users on a multi-channel interface (Scarlett 18i8 with
 * 18 inputs, RME 12+, MOTU 24-channel, etc.) select a SPECIFIC raw input
 * channel. They had to wire whatever channel they wanted to the "left" pin
 * physically, which is impossible on most pre-amp boxes.
 *
 * v3.121 adds `channel-N` (N: 1-based human channel index) for selecting any
 * specific raw input channel. The audio graph routes the (N-1)th splitter
 * output to both the analyser and the MediaRecorder destination — same code
 * path as `left`/`right`, just generalized to N. Mono/stereo/left/right stay
 * for the common consumer case (and as a fallback when the device's actual
 * channel count cannot be detected).
 *
 * Stored format: `channel-1`, `channel-2`, ..., `channel-99`. Caps the upper
 * bound at 99 to keep the picker UI sane and avoid storing nonsense.
 */
export type AgentMicChannelMode =
  | 'default'
  | 'mono'
  | 'stereo'
  | 'left'
  | 'right'
  | `channel-${number}`;

export const AGENT_STT_PROVIDER_STORAGE_KEY = 'producer-player.agent-stt-provider';
export const AGENT_MIC_DEVICE_ID_STORAGE_KEY = 'producer-player.agent-mic-device-id';
export const AGENT_MIC_CHANNEL_MODE_STORAGE_KEY = 'producer-player.agent-mic-channel-mode';

export const AGENT_STT_PROVIDER_LABELS: Record<AgentSttProviderId, string> = {
  deepgram: 'Deepgram Nova-3',
  assemblyai: 'AssemblyAI Universal-3 Pro',
};

/**
 * Static labels for the canonical (non-channel-N) modes. `channel-N` labels
 * are computed on demand by `getAgentMicChannelModeLabel()` since N is
 * unbounded. Use that helper from UI code rather than indexing this map for
 * channel-N modes — direct indexing returns `undefined`.
 */
export const AGENT_MIC_CHANNEL_MODE_LABELS: Record<
  'default' | 'mono' | 'stereo' | 'left' | 'right',
  string
> = {
  default: 'Default channels',
  mono: 'Mono',
  stereo: 'Stereo',
  left: 'Left channel only',
  right: 'Right channel only',
};

const DEFAULT_AGENT_STT_PROVIDER: AgentSttProviderId = 'deepgram';
const DEFAULT_AGENT_MIC_DEVICE_ID = 'default';
const DEFAULT_AGENT_MIC_CHANNEL_MODE: AgentMicChannelMode = 'default';

const CHANNEL_MODE_PREFIX = 'channel-';
const MAX_SUPPORTED_CHANNEL_INDEX = 99;

function isAgentSttProvider(value: unknown): value is AgentSttProviderId {
  return value === 'deepgram' || value === 'assemblyai';
}

/**
 * Parse a `channel-N` mode into its 1-based channel index, or null if the
 * string is not a `channel-N` form / is out of range. Centralized so UI,
 * graph-builder, and storage parser agree on the format.
 */
export function parseAgentMicChannelIndex(
  channelMode: string
): number | null {
  if (!channelMode.startsWith(CHANNEL_MODE_PREFIX)) {
    return null;
  }
  const suffix = channelMode.slice(CHANNEL_MODE_PREFIX.length);
  if (suffix.length === 0) {
    return null;
  }
  // Strict integer parse — reject leading zeros, decimals, signs, hex, etc.
  if (!/^[1-9][0-9]{0,1}$/.test(suffix)) {
    return null;
  }
  const parsed = Number.parseInt(suffix, 10);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_SUPPORTED_CHANNEL_INDEX
  ) {
    return null;
  }
  return parsed;
}

export function buildAgentMicChannelMode(
  oneBasedIndex: number
): AgentMicChannelMode {
  if (
    !Number.isInteger(oneBasedIndex) ||
    oneBasedIndex < 1 ||
    oneBasedIndex > MAX_SUPPORTED_CHANNEL_INDEX
  ) {
    throw new RangeError(
      `Channel index must be an integer in [1, ${MAX_SUPPORTED_CHANNEL_INDEX}] (got ${oneBasedIndex})`
    );
  }
  return `channel-${oneBasedIndex}` as AgentMicChannelMode;
}

export function getAgentMicChannelModeLabel(
  channelMode: AgentMicChannelMode
): string {
  if (
    channelMode === 'default' ||
    channelMode === 'mono' ||
    channelMode === 'stereo' ||
    channelMode === 'left' ||
    channelMode === 'right'
  ) {
    return AGENT_MIC_CHANNEL_MODE_LABELS[channelMode];
  }
  const index = parseAgentMicChannelIndex(channelMode);
  if (index !== null) {
    return `Channel ${index}`;
  }
  return AGENT_MIC_CHANNEL_MODE_LABELS.default;
}

function isAgentMicChannelMode(value: unknown): value is AgentMicChannelMode {
  if (typeof value !== 'string') {
    return false;
  }
  if (
    value === 'default' ||
    value === 'mono' ||
    value === 'stereo' ||
    value === 'left' ||
    value === 'right'
  ) {
    return true;
  }
  return parseAgentMicChannelIndex(value) !== null;
}

export function readStoredAgentSttProvider(): AgentSttProviderId {
  try {
    const stored = localStorage.getItem(AGENT_STT_PROVIDER_STORAGE_KEY);
    return isAgentSttProvider(stored) ? stored : DEFAULT_AGENT_STT_PROVIDER;
  } catch {
    return DEFAULT_AGENT_STT_PROVIDER;
  }
}

export function writeStoredAgentSttProvider(provider: AgentSttProviderId): void {
  localStorage.setItem(AGENT_STT_PROVIDER_STORAGE_KEY, provider);
  notifyAgentVoiceSettingsUpdated();
}

export function readStoredAgentMicDeviceId(): string {
  try {
    const stored = localStorage.getItem(AGENT_MIC_DEVICE_ID_STORAGE_KEY)?.trim();
    return stored && stored.length > 0 ? stored : DEFAULT_AGENT_MIC_DEVICE_ID;
  } catch {
    return DEFAULT_AGENT_MIC_DEVICE_ID;
  }
}

export function writeStoredAgentMicDeviceId(deviceId: string): void {
  const trimmed = deviceId.trim();
  if (!trimmed || trimmed === DEFAULT_AGENT_MIC_DEVICE_ID) {
    localStorage.removeItem(AGENT_MIC_DEVICE_ID_STORAGE_KEY);
  } else {
    localStorage.setItem(AGENT_MIC_DEVICE_ID_STORAGE_KEY, trimmed);
  }
  notifyAgentVoiceSettingsUpdated();
}

export function readStoredAgentMicChannelMode(): AgentMicChannelMode {
  try {
    const stored = localStorage.getItem(AGENT_MIC_CHANNEL_MODE_STORAGE_KEY);
    return isAgentMicChannelMode(stored) ? stored : DEFAULT_AGENT_MIC_CHANNEL_MODE;
  } catch {
    return DEFAULT_AGENT_MIC_CHANNEL_MODE;
  }
}

export function writeStoredAgentMicChannelMode(channelMode: AgentMicChannelMode): void {
  if (channelMode === DEFAULT_AGENT_MIC_CHANNEL_MODE) {
    localStorage.removeItem(AGENT_MIC_CHANNEL_MODE_STORAGE_KEY);
  } else {
    localStorage.setItem(AGENT_MIC_CHANNEL_MODE_STORAGE_KEY, channelMode);
  }
  notifyAgentVoiceSettingsUpdated();
}

export function notifyAgentVoiceSettingsUpdated(): void {
  window.dispatchEvent(new Event(AGENT_VOICE_SETTINGS_UPDATED_EVENT));
}
