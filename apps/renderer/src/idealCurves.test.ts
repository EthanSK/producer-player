import { describe, expect, it } from 'vitest';
import {
  IDEAL_CURVE_MAX_FREQ,
  IDEAL_CURVE_MIN_FREQ,
  IDEAL_CURVE_POINT_COUNT,
  IDEAL_STEM_GUIDES,
  IDEAL_STEM_IDS,
  buildAllIdealStemCurves,
  buildIdealStemCurve,
} from './idealCurves';

describe('ideal stem EQ curves', () => {
  it('builds deterministic 256-point log-spaced curves for every stem', () => {
    const curves = buildAllIdealStemCurves();

    expect(Object.keys(curves).sort()).toEqual([...IDEAL_STEM_IDS].sort());

    for (const stemId of IDEAL_STEM_IDS) {
      const curve = curves[stemId];
      const secondBuild = buildIdealStemCurve(stemId);

      expect(curve).toEqual(secondBuild);
      expect(curve.length).toBe(IDEAL_CURVE_POINT_COUNT);
      expect(curve[0].freq).toBeCloseTo(IDEAL_CURVE_MIN_FREQ, 8);
      expect(curve[curve.length - 1].freq).toBeCloseTo(IDEAL_CURVE_MAX_FREQ, 8);

      const firstRatio = curve[1].freq / curve[0].freq;
      for (let i = 1; i < curve.length; i++) {
        expect(curve[i].freq).toBeGreaterThan(curve[i - 1].freq);
        expect(Number.isFinite(curve[i].gainDb)).toBe(true);
        if (i > 1) {
          expect(curve[i].freq / curve[i - 1].freq).toBeCloseTo(firstRatio, 10);
        }
      }
    }
  });

  it('keeps guide metadata educational and citation-aware', () => {
    for (const stemId of IDEAL_STEM_IDS) {
      const guide = IDEAL_STEM_GUIDES[stemId];
      expect(guide.id).toBe(stemId);
      expect(guide.label.length).toBeGreaterThan(2);
      expect(guide.summary.length).toBeGreaterThan(24);
      expect(guide.explanation.length).toBeGreaterThan(80);
      expect(guide.listeningNotes.length).toBeGreaterThanOrEqual(3);
      expect(guide.sourcePlaceholder).toContain('Citation TODO');
      expect(guide.anchors.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('expresses sensible stem differences in the teaching curves', () => {
    const bass = buildIdealStemCurve('bass');
    const vocals = buildIdealStemCurve('vocals');
    const drums = buildIdealStemCurve('drums');

    const nearestGain = (curve: typeof bass, freq: number): number =>
      curve.reduce((best, point) => (
        Math.abs(Math.log10(point.freq) - Math.log10(freq)) <
        Math.abs(Math.log10(best.freq) - Math.log10(freq))
          ? point
          : best
      )).gainDb;

    expect(nearestGain(bass, 70)).toBeGreaterThan(nearestGain(vocals, 70));
    expect(nearestGain(vocals, 3000)).toBeGreaterThan(nearestGain(bass, 3000));
    expect(nearestGain(drums, 5000)).toBeGreaterThan(nearestGain(drums, 500));
  });
});
