import type {
  PluginChainItem,
  PluginProcessBlockItem,
  TrackPluginChain,
} from '@producer-player/contracts';

export const PLUGIN_AUDIO_PROCESSOR_BUFFER_SIZE = 4096;
/**
 * The native plug-in sidecar replies asynchronously. Hold a small, fixed
 * timeline so a processed reply can only replace the exact dry block that
 * produced it. Two 4096-frame blocks are about 171 ms at 48 kHz: enough for a
 * warm Audio Unit round-trip without ever replaying an older block later.
 */
export const PLUGIN_AUDIO_OUTPUT_LATENCY_BLOCKS = 2;
/**
 * Per-plugin I/O gain (Ableton-style sandwich) — `inputGainLinear` /
 * `outputGainLinear`. Linear multipliers; 1 = unity (default), 0 = silent,
 * 2 = +6 dB. Anything outside [MIN..MAX] gets clamped.
 */
export const PLUGIN_SLOT_GAIN_DEFAULT = 1;
export const PLUGIN_SLOT_GAIN_MIN = 0;
export const PLUGIN_SLOT_GAIN_MAX = 2;
const BASE64_CHUNK_SIZE = 0x8000;

export interface PluginAudioTimelineBlock {
  sequence: number;
  generation: number;
  expectsProcessedAudio: boolean;
  drySamples: Float32Array;
}

export interface PluginAudioTimelineOutput extends PluginAudioTimelineBlock {
  samples: Float32Array;
  usedProcessedAudio: boolean;
}

export interface PluginNativePrewarmPlaybackDecision {
  audioPaused: boolean;
  playbackSongId: string | null;
  prewarmSongId: string | null;
  prewarmRequiredForPlayback: boolean;
}

interface PendingPluginAudioTimelineBlock extends PluginAudioTimelineBlock {
  processedSamples: Float32Array | null;
}

/**
 * Sequence-lock asynchronous plug-in replies to the source block that created
 * them. A late reply is discarded after its block's output deadline; it can
 * never be shifted into a later callback and sound like a restart/stutter.
 *
 * The timeline remains continuous across song generations. That is important:
 * the delayed tail of track A must be emitted before the first block of track B
 * during a natural album handoff.
 */
export class PluginAudioOutputTimeline {
  private readonly pending: PendingPluginAudioTimelineBlock[] = [];
  private readonly bySequence = new Map<number, PendingPluginAudioTimelineBlock>();
  private nextSequence = 1;

  constructor(
    readonly latencyBlocks: number = PLUGIN_AUDIO_OUTPUT_LATENCY_BLOCKS,
  ) {
    if (!Number.isInteger(latencyBlocks) || latencyBlocks < 1) {
      throw new Error('Plugin audio output latency must be at least one block.');
    }
  }

  enqueue(options: {
    generation: number;
    expectsProcessedAudio: boolean;
    drySamples: Float32Array;
  }): PluginAudioTimelineBlock {
    const block: PendingPluginAudioTimelineBlock = {
      sequence: this.nextSequence,
      generation: options.generation,
      expectsProcessedAudio: options.expectsProcessedAudio,
      drySamples: options.drySamples,
      processedSamples: null,
    };
    this.nextSequence += 1;
    this.pending.push(block);
    this.bySequence.set(block.sequence, block);
    return block;
  }

  attachProcessed(options: {
    sequence: number;
    generation: number;
    samples: Float32Array;
  }): boolean {
    const block = this.bySequence.get(options.sequence);
    if (
      !block ||
      block.generation !== options.generation ||
      options.samples.length < block.drySamples.length
    ) {
      return false;
    }
    block.processedSamples = options.samples;
    return true;
  }

  takeOutput(): PluginAudioTimelineOutput | null {
    if (this.pending.length <= this.latencyBlocks) {
      return null;
    }
    const block = this.pending.shift();
    if (!block) return null;
    this.bySequence.delete(block.sequence);
    const usedProcessedAudio =
      block.expectsProcessedAudio && block.processedSamples !== null;
    return {
      sequence: block.sequence,
      generation: block.generation,
      expectsProcessedAudio: block.expectsProcessedAudio,
      drySamples: block.drySamples,
      samples: usedProcessedAudio ? block.processedSamples! : block.drySamples,
      usedProcessedAudio,
    };
  }

  get queueDepth(): number {
    return this.pending.length;
  }

  clear(): void {
    this.pending.length = 0;
    this.bySequence.clear();
  }
}

/**
 * A native plug-in constructor cannot be cancelled safely once it has begun.
 * Playback should wait for it only when that exact song needs the plug-in for
 * its audible route. An unrelated song's idle prewarm must never delay normal
 * zero-plug-in playback.
 */
export function shouldWaitForPluginNativePrewarm(
  decision: PluginNativePrewarmPlaybackDecision,
): boolean {
  return Boolean(
    decision.audioPaused &&
      decision.prewarmRequiredForPlayback &&
      decision.playbackSongId &&
      decision.prewarmSongId === decision.playbackSongId,
  );
}

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
