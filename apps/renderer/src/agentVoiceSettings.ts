export const AGENT_VOICE_SETTINGS_UPDATED_EVENT = 'producer-player:agent-voice-settings-updated';

export type AgentSttProviderId = 'deepgram' | 'assemblyai';
export type AgentMicChannelMode = 'default' | 'mono' | 'stereo' | 'left' | 'right';

export const AGENT_STT_PROVIDER_STORAGE_KEY = 'producer-player.agent-stt-provider';
export const AGENT_MIC_DEVICE_ID_STORAGE_KEY = 'producer-player.agent-mic-device-id';
export const AGENT_MIC_CHANNEL_MODE_STORAGE_KEY = 'producer-player.agent-mic-channel-mode';

export const AGENT_STT_PROVIDER_LABELS: Record<AgentSttProviderId, string> = {
  deepgram: 'Deepgram Nova-3',
  assemblyai: 'AssemblyAI Universal-3 Pro',
};

export const AGENT_MIC_CHANNEL_MODE_LABELS: Record<AgentMicChannelMode, string> = {
  default: 'Default channels',
  mono: 'Mono',
  stereo: 'Stereo',
  left: 'Left channel only',
  right: 'Right channel only',
};

const DEFAULT_AGENT_STT_PROVIDER: AgentSttProviderId = 'deepgram';
const DEFAULT_AGENT_MIC_DEVICE_ID = 'default';
const DEFAULT_AGENT_MIC_CHANNEL_MODE: AgentMicChannelMode = 'default';

function isAgentSttProvider(value: unknown): value is AgentSttProviderId {
  return value === 'deepgram' || value === 'assemblyai';
}

function isAgentMicChannelMode(value: unknown): value is AgentMicChannelMode {
  return (
    value === 'default' ||
    value === 'mono' ||
    value === 'stereo' ||
    value === 'left' ||
    value === 'right'
  );
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
