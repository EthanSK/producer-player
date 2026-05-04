import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_MIC_CHANNEL_MODE_STORAGE_KEY,
  AGENT_MIC_DEVICE_ID_STORAGE_KEY,
  AGENT_STT_PROVIDER_STORAGE_KEY,
  AGENT_VOICE_SETTINGS_UPDATED_EVENT,
  buildAgentMicChannelMode,
  getAgentMicChannelModeLabel,
  parseAgentMicChannelIndex,
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

  // v3.121 (Concern 2) — multi-channel-interface picker. Storage,
  // parser, builder and label helper must agree on the `channel-N`
  // wire format (1-based human channel index).
  describe('channel-N modes (multi-channel interfaces)', () => {
    it('stores and reads back channel-N modes', () => {
      writeStoredAgentMicChannelMode('channel-3');
      expect(localStorage.getItem(AGENT_MIC_CHANNEL_MODE_STORAGE_KEY)).toBe(
        'channel-3'
      );
      expect(readStoredAgentMicChannelMode()).toBe('channel-3');

      writeStoredAgentMicChannelMode('channel-12');
      expect(readStoredAgentMicChannelMode()).toBe('channel-12');
    });

    it('parseAgentMicChannelIndex returns the 1-based index for valid forms', () => {
      expect(parseAgentMicChannelIndex('channel-1')).toBe(1);
      expect(parseAgentMicChannelIndex('channel-9')).toBe(9);
      expect(parseAgentMicChannelIndex('channel-18')).toBe(18);
      expect(parseAgentMicChannelIndex('channel-99')).toBe(99);
    });

    it('parseAgentMicChannelIndex rejects malformed strings', () => {
      expect(parseAgentMicChannelIndex('default')).toBeNull();
      expect(parseAgentMicChannelIndex('mono')).toBeNull();
      expect(parseAgentMicChannelIndex('left')).toBeNull();
      expect(parseAgentMicChannelIndex('channel-')).toBeNull();
      expect(parseAgentMicChannelIndex('channel-0')).toBeNull(); // 0-indexed not allowed
      expect(parseAgentMicChannelIndex('channel-100')).toBeNull(); // upper bound
      expect(parseAgentMicChannelIndex('channel--1')).toBeNull(); // negative
      expect(parseAgentMicChannelIndex('channel-abc')).toBeNull();
      expect(parseAgentMicChannelIndex('channel-01')).toBeNull(); // leading zero
      expect(parseAgentMicChannelIndex('channel-1.5')).toBeNull(); // decimal
    });

    it('falls back to default when storage holds an invalid channel-N value', () => {
      localStorage.setItem(AGENT_MIC_CHANNEL_MODE_STORAGE_KEY, 'channel-0');
      expect(readStoredAgentMicChannelMode()).toBe('default');

      localStorage.setItem(AGENT_MIC_CHANNEL_MODE_STORAGE_KEY, 'channel-100');
      expect(readStoredAgentMicChannelMode()).toBe('default');

      localStorage.setItem(AGENT_MIC_CHANNEL_MODE_STORAGE_KEY, 'channel-foo');
      expect(readStoredAgentMicChannelMode()).toBe('default');
    });

    it('buildAgentMicChannelMode round-trips through parse', () => {
      for (const n of [1, 2, 5, 18, 99]) {
        const mode = buildAgentMicChannelMode(n);
        expect(mode).toBe(`channel-${n}`);
        expect(parseAgentMicChannelIndex(mode)).toBe(n);
      }
    });

    it('buildAgentMicChannelMode rejects out-of-range indices', () => {
      expect(() => buildAgentMicChannelMode(0)).toThrow(RangeError);
      expect(() => buildAgentMicChannelMode(-1)).toThrow(RangeError);
      expect(() => buildAgentMicChannelMode(100)).toThrow(RangeError);
      expect(() => buildAgentMicChannelMode(1.5)).toThrow(RangeError);
      expect(() => buildAgentMicChannelMode(Number.NaN)).toThrow(RangeError);
    });

    it('getAgentMicChannelModeLabel renders human labels for both kinds', () => {
      expect(getAgentMicChannelModeLabel('default')).toBe('Default channels');
      expect(getAgentMicChannelModeLabel('mono')).toBe('Mono');
      expect(getAgentMicChannelModeLabel('stereo')).toBe('Stereo');
      expect(getAgentMicChannelModeLabel('left')).toBe('Left channel only');
      expect(getAgentMicChannelModeLabel('right')).toBe('Right channel only');
      expect(getAgentMicChannelModeLabel('channel-1')).toBe('Channel 1');
      expect(getAgentMicChannelModeLabel('channel-12')).toBe('Channel 12');
      expect(getAgentMicChannelModeLabel('channel-99')).toBe('Channel 99');
    });
  });
});
