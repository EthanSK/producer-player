export const AGENT_VOICE_SETTINGS_UPDATED_EVENT = 'producer-player:agent-voice-settings-updated';

export type AgentSttProviderId = 'deepgram' | 'assemblyai';

export const AGENT_STT_PROVIDER_STORAGE_KEY = 'producer-player.agent-stt-provider';

export const AGENT_STT_PROVIDER_LABELS: Record<AgentSttProviderId, string> = {
  deepgram: 'Deepgram Nova-3',
  assemblyai: 'AssemblyAI Universal-3 Pro',
};

const DEFAULT_AGENT_STT_PROVIDER: AgentSttProviderId = 'deepgram';

function isAgentSttProvider(value: unknown): value is AgentSttProviderId {
  return value === 'deepgram' || value === 'assemblyai';
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

export function notifyAgentVoiceSettingsUpdated(): void {
  window.dispatchEvent(new Event(AGENT_VOICE_SETTINGS_UPDATED_EVENT));
}
