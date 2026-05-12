import type {
  PluginChainItem,
  PluginProcessBlockItem,
  TrackPluginChain,
} from '@producer-player/contracts';

export const PLUGIN_AUDIO_PROCESSOR_BUFFER_SIZE = 4096;
/**
 * Per-plugin I/O gain (Ableton-style sandwich) — `inputGainLinear` /
 * `outputGainLinear`. Linear multipliers; 1 = unity (default), 0 = silent,
 * 2 = +6 dB. Anything outside [MIN..MAX] gets clamped.
 */
export const PLUGIN_SLOT_GAIN_DEFAULT = 1;
export const PLUGIN_SLOT_GAIN_MIN = 0;
export const PLUGIN_SLOT_GAIN_MAX = 2;
const BASE64_CHUNK_SIZE = 0x8000;

export function clampPluginSlotGainLinear(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return PLUGIN_SLOT_GAIN_DEFAULT;
  }
  return Math.min(
    PLUGIN_SLOT_GAIN_MAX,
    Math.max(PLUGIN_SLOT_GAIN_MIN, value),
  );
}

export function getPluginSlotInputGain(item: PluginChainItem): number {
  return clampPluginSlotGainLinear(item.inputGainLinear);
}

export function getPluginSlotOutputGain(item: PluginChainItem): number {
  return clampPluginSlotGainLinear(item.outputGainLinear);
}

export function getEnabledPluginProcessChain(
  chain: TrackPluginChain,
  loadedInstanceIds: ReadonlySet<string>,
  opts: { referencePlayback?: boolean; requireLoaded?: boolean } = {},
): PluginProcessBlockItem[] {
  if (opts.referencePlayback) return [];
  return chain.items
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((item) => item.enabled && (!opts.requireLoaded || loadedInstanceIds.has(item.instanceId)))
    .map((item) => ({
      instanceId: item.instanceId,
      enabled: true,
    }));
}

/**
 * Apply per-slot input gain to an interleaved stereo float32 block in-place
 * before the buffer is shipped to the plugin sidecar. A unity gain (1.0) is
 * a no-op fast-path. The output gain is applied symmetrically by
 * {@link applyPluginSlotOutputGainInPlace} after processing.
 *
 * Both gains compose multiplicatively when multiple plugins are in the
 * chain: the App.tsx pipeline calls this per-slot in chain order.
 */
export function applyGainInPlace(samples: Float32Array, gain: number): void {
  if (gain === 1 || !Number.isFinite(gain)) return;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = samples[i]! * gain;
  }
}

export function interleaveStereoSamples(
  left: Float32Array,
  right: Float32Array,
  frames: number,
): Float32Array {
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    out[i * 2] = left[i] ?? 0;
    out[i * 2 + 1] = right[i] ?? left[i] ?? 0;
  }
  return out;
}

export function writeInterleavedStereoSamples(
  interleaved: Float32Array,
  left: Float32Array,
  right: Float32Array,
  frames: number,
): boolean {
  if (interleaved.length < frames * 2) return false;
  for (let i = 0; i < frames; i++) {
    left[i] = interleaved[i * 2] ?? 0;
    right[i] = interleaved[i * 2 + 1] ?? interleaved[i * 2] ?? 0;
  }
  return true;
}

export function float32InterleavedToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    let chunkString = '';
    for (let j = 0; j < chunk.length; j++) {
      chunkString += String.fromCharCode(chunk[j]);
    }
    binary += chunkString;
  }
  return btoa(binary);
}

export function base64ToFloat32Interleaved(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Processed plugin buffer is not float32-aligned.');
  }
  return new Float32Array(bytes.buffer);
}
