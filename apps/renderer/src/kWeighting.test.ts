import { describe, expect, it } from 'vitest';
import {
  buildKWeightingCurve,
  kWeightingDbAtFrequency,
  K_WEIGHTING_REFERENCE_SAMPLE_RATE,
} from './kWeighting';

describe('K-weighting curve (ITU-R BS.1770-4)', () => {
  it('exposes the canonical 48 kHz reference sample rate', () => {
    expect(K_WEIGHTING_REFERENCE_SAMPLE_RATE).toBe(48000);
  });

  it('reads as 0 dB at 1 kHz (normalization anchor)', () => {
    const valueAt1k = kWeightingDbAtFrequency(1000);
    expect(valueAt1k).toBeCloseTo(0, 5);
  });

  it('mildly attenuates 100 Hz', () => {
    const valueAt100 = kWeightingDbAtFrequency(100);
    // BS.1770-4 K-weighting at 100 Hz is roughly -2 dB. The RLB
    // high-pass has -3 dB at ~38 Hz, so 100 Hz is already comfortably
    // in the pass-band; the stage-1 pre-filter contributes another small
    // negative offset because the high-shelf has not yet engaged.
    expect(valueAt100).toBeLessThan(-1);
    expect(valueAt100).toBeGreaterThan(-4);
  });

  it('attenuates 38 Hz (RLB -3 dB knee region)', () => {
    const valueAt38 = kWeightingDbAtFrequency(38);
    // RLB stage is -3 dB at ~38 Hz. Combined with the pre-filter and
    // 1-kHz normalization, the published curve sits roughly -6 to -8 dB
    // here.
    expect(valueAt38).toBeLessThan(-4);
    expect(valueAt38).toBeGreaterThan(-10);
  });

  it('strongly attenuates sub-bass at 20 Hz', () => {
    const valueAt20 = kWeightingDbAtFrequency(20);
    // BS.1770-4 K-weighting plots show roughly -13 to -15 dB at 20 Hz.
    expect(valueAt20).toBeLessThan(-10);
    expect(valueAt20).toBeGreaterThan(-18);
  });

  it('boosts high frequencies — ~ +4 dB around 10 kHz', () => {
    const valueAt10k = kWeightingDbAtFrequency(10000);
    // Pre-filter high-shelf asymptote is roughly +4 dB above ~1.5 kHz,
    // so 10 kHz should sit very close to +4 dB after normalization.
    expect(valueAt10k).toBeGreaterThan(3);
    expect(valueAt10k).toBeLessThan(5);
  });

  it('is monotonically near-flat above 2 kHz at the +4 dB plateau', () => {
    const v2k = kWeightingDbAtFrequency(2000);
    const v5k = kWeightingDbAtFrequency(5000);
    const v10k = kWeightingDbAtFrequency(10000);
    // All three are inside the high-shelf region; differences should be
    // small and bounded by the +4 dB plateau.
    expect(v2k).toBeGreaterThan(0);
    expect(v5k).toBeGreaterThan(v2k);
    expect(v10k).toBeGreaterThanOrEqual(v5k - 0.5);
    expect(v10k).toBeLessThan(5);
  });

  it('builds a curve with the requested number of log-spaced points', () => {
    const curve = buildKWeightingCurve(64);
    expect(curve.length).toBe(64);
    expect(curve[0].freq).toBeCloseTo(20, 5);
    expect(curve[curve.length - 1].freq).toBeCloseTo(20000, 5);

    // Strictly increasing in frequency (log-spaced).
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].freq).toBeGreaterThan(curve[i - 1].freq);
    }
  });

  it('curve values match the spot-frequency function', () => {
    const curve = buildKWeightingCurve(128);
    // Find the point closest to 1 kHz and confirm it is near 0 dB.
    let best = curve[0];
    let bestDist = Math.abs(Math.log10(best.freq) - Math.log10(1000));
    for (const p of curve) {
      const d = Math.abs(Math.log10(p.freq) - Math.log10(1000));
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    expect(best.gainDb).toBeCloseTo(kWeightingDbAtFrequency(best.freq), 6);
    // And the closest-to-1k sample should be within ~0.5 dB of 0 dB.
    expect(Math.abs(best.gainDb)).toBeLessThan(0.5);
  });
});
