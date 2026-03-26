export const AGENT_VOICE_SETTINGS_UPDATED_EVENT = 'producer-player:agent-voice-settings-updated';

export function notifyAgentVoiceSettingsUpdated(): void {
  window.dispatchEvent(new Event(AGENT_VOICE_SETTINGS_UPDATED_EVENT));
}
