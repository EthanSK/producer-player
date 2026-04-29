import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_MIC_CHANNEL_MODE_STORAGE_KEY,
  AGENT_MIC_DEVICE_ID_STORAGE_KEY,
  AGENT_STT_PROVIDER_STORAGE_KEY,
  AGENT_VOICE_SETTINGS_UPDATED_EVENT,
  readStoredAgentMicChannelMode,
  readStoredAgentMicDeviceId,
  readStoredAgentSttProvider,
  writeStoredAgentMicChannelMode,
  writeStoredAgentMicDeviceId,
  writeStoredAgentSttProvider,
} from './agentVoiceSettings';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('agent voice settings storage', () => {
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    dispatchEvent.mockClear();
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('window', { dispatchEvent });
  });

  it('falls back to defaults when stored values are absent or invalid', () => {
    localStorage.setItem(AGENT_STT_PROVIDER_STORAGE_KEY, 'unknown');
    localStorage.setItem(AGENT_MIC_CHANNEL_MODE_STORAGE_KEY, 'center');
    localStorage.setItem(AGENT_MIC_DEVICE_ID_STORAGE_KEY, '   ');

    expect(readStoredAgentSttProvider()).toBe('deepgram');
    expect(readStoredAgentMicChannelMode()).toBe('default');
    expect(readStoredAgentMicDeviceId()).toBe('default');
  });

  it('stores microphone device and channel choices and emits update events', () => {
    writeStoredAgentSttProvider('assemblyai');
    writeStoredAgentMicDeviceId('usb-interface-1');
    writeStoredAgentMicChannelMode('left');

    expect(readStoredAgentSttProvider()).toBe('assemblyai');
    expect(readStoredAgentMicDeviceId()).toBe('usb-interface-1');
    expect(readStoredAgentMicChannelMode()).toBe('left');
    expect(dispatchEvent).toHaveBeenCalledTimes(3);
    expect(dispatchEvent.mock.calls[0]?.[0]).toBeInstanceOf(Event);
    expect((dispatchEvent.mock.calls[0]?.[0] as Event).type).toBe(
      AGENT_VOICE_SETTINGS_UPDATED_EVENT
    );
  });

  it('removes stored microphone overrides when reset to defaults', () => {
    writeStoredAgentMicDeviceId('usb-interface-1');
    writeStoredAgentMicChannelMode('right');

    writeStoredAgentMicDeviceId('default');
    writeStoredAgentMicChannelMode('default');

    expect(localStorage.getItem(AGENT_MIC_DEVICE_ID_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(AGENT_MIC_CHANNEL_MODE_STORAGE_KEY)).toBeNull();
    expect(readStoredAgentMicDeviceId()).toBe('default');
    expect(readStoredAgentMicChannelMode()).toBe('default');
  });
});
