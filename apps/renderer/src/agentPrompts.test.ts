/**
 * v3.34 — unit tests for the AI-recommendations prompt/parse/fingerprint
 * helpers in agentPrompts.ts.
 *
 * Tier: MUST-ADD (from TEST_COVERAGE_AUDIT_2026-04-19.md Codex-surfaced
 * gap #3). These functions back the v3.30-v3.33 AI recommendations
 * pipeline — a bug here either silently drops a rec, burns an agent
 * call, or leaves `analysisVersion` misaligned so stale-detection fires
 * spuriously.
 */
import { describe, expect, it } from 'vitest';
import {
  computeMasteringAnalysisVersion,
  parseMasteringRecommendationsResponse,
} from './agentPrompts';

describe('parseMasteringRecommendationsResponse', () => {
  it('parses a fenced ```json block with multiple metrics', () => {
    const text = `Sure, here's what I'd do.\n\n\`\`\`json\n{\n  "recommendations": {\n    "integrated_lufs": {\n      "recommendedValue": "-14.0 LUFS",\n      "recommendedRawValue": -14.0,\n      "reason": "Match streaming target."\n    },\n    "true_peak": {\n      "recommendedValue": "-1.0 dBTP",\n      "recommendedRawValue": -1.0,\n      "reason": "Keep headroom."\n    }\n  }\n}\n\`\`\`\n\nDone.`;
    const out = parseMasteringRecommendationsResponse(text);
    expect(out).not.toBeNull();
    expect(Object.keys(out!)).toEqual(['integrated_lufs', 'true_peak']);
    expect(out!.integrated_lufs.recommendedValue).toBe('-14.0 LUFS');
    expect(out!.integrated_lufs.recommendedRawValue).toBe(-14.0);
    expect(out!.true_peak.reason).toBe('Keep headroom.');
  });

  it('parses a bare JSON object with no fence and prose around it', () => {
    const text = `Here are my recs {"recommendations":{"crest_factor":{"recommendedValue":"12 dB","recommendedRawValue":12,"reason":"Comfortable dynamics."}}} — let me know.`;
    const out = parseMasteringRecommendationsResponse(text);
    expect(out).not.toBeNull();
    expect(out!.crest_factor.recommendedValue).toBe('12 dB');
    expect(out!.crest_factor.recommendedRawValue).toBe(12);
  });

  it('parses multiple metrics with nested objects and escaped quotes in reason', () => {
    const text = `\`\`\`json\n{"recommendations":{"m1":{"recommendedValue":"a","reason":"He said \\"ok\\""},"m2":{"recommendedValue":"b","reason":"nested {curly} inside"}}}\n\`\`\``;
    const out = parseMasteringRecommendationsResponse(text);
    expect(out).not.toBeNull();
    expect(Object.keys(out!)).toEqual(['m1', 'm2']);
    expect(out!.m1.reason).toBe('He said "ok"');
    expect(out!.m2.reason).toBe('nested {curly} inside');
  });

  it('returns null for empty input', () => {
    expect(parseMasteringRecommendationsResponse('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    const text = '```json\n{ not valid json }\n```';
    expect(parseMasteringRecommendationsResponse(text)).toBeNull();
  });

  it('returns null when JSON parses but shape is wrong (missing recommendations)', () => {
    const text = '```json\n{"foo": "bar"}\n```';
    expect(parseMasteringRecommendationsResponse(text)).toBeNull();
  });

  it('returns null when recommendations is an array, not an object', () => {
    const text = '```json\n{"recommendations": ["a", "b"]}\n```';
    expect(parseMasteringRecommendationsResponse(text)).toBeNull();
  });

  it('parses array-form recommendations with metricId fields', () => {
    const text = `\`\`\`json
{
  "recommendations": [
    {
      "metricId": "integrated_lufs",
      "recommendedValue": "-14.0 LUFS",
      "recommendedRawValue": -14,
      "reason": "Streaming target."
    },
    {
      "metric_id": "true_peak",
      "recommended_value": "-1.0 dBTP",
      "recommended_raw_value": -1,
      "rationale": "Leave headroom."
    }
  ]
}
\`\`\``;
    const out = parseMasteringRecommendationsResponse(text);
    expect(out).not.toBeNull();
    expect(out!.integrated_lufs.recommendedValue).toBe('-14.0 LUFS');
    expect(out!.integrated_lufs.recommendedRawValue).toBe(-14);
    expect(out!.true_peak.recommendedValue).toBe('-1.0 dBTP');
    expect(out!.true_peak.recommendedRawValue).toBe(-1);
    expect(out!.true_peak.reason).toBe('Leave headroom.');
  });

  it('parses top-level metric maps when the agent omits the recommendations wrapper', () => {
    const text = `\`\`\`json
{
  "integrated_lufs": {
    "target_value": "-13.5 LUFS",
    "target_raw_value": -13.5,
    "explanation": "The current master is quiet for the target."
  },
  "crest_factor": {
    "suggestedValue": "10 dB",
    "numericValue": 10,
    "justification": "Keeps punch without over-compression."
  }
}
\`\`\``;
    const out = parseMasteringRecommendationsResponse(text);
    expect(out).not.toBeNull();
    expect(out!.integrated_lufs.recommendedValue).toBe('-13.5 LUFS');
    expect(out!.integrated_lufs.recommendedRawValue).toBe(-13.5);
    expect(out!.integrated_lufs.reason).toBe(
      'The current master is quiet for the target.',
    );
    expect(out!.crest_factor.recommendedValue).toBe('10 dB');
    expect(out!.crest_factor.recommendedRawValue).toBe(10);
  });

  it('drops entries with empty recommendedValue', () => {
    const text = `\`\`\`json\n{"recommendations":{"good":{"recommendedValue":"-14 LUFS","reason":"ok"},"empty":{"recommendedValue":"","reason":"bogus"}}}\n\`\`\``;
    const out = parseMasteringRecommendationsResponse(text);
    expect(out).not.toBeNull();
    expect(Object.keys(out!)).toEqual(['good']);
    expect(out!.empty).toBeUndefined();
  });

  it('drops entries with missing recommendedValue entirely', () => {
    const text = `\`\`\`json\n{"recommendations":{"good":{"recommendedValue":"x","reason":"y"},"bad":{"reason":"no value"}}}\n\`\`\``;
    const out = parseMasteringRecommendationsResponse(text);
    expect(out).not.toBeNull();
    expect(Object.keys(out!)).toEqual(['good']);
  });

  it('drops non-finite recommendedRawValue (NaN/Infinity) but keeps the rec with a string value', () => {
    const text = `\`\`\`json\n{"recommendations":{"m":{"recommendedValue":"keep","recommendedRawValue":null,"reason":"r"}}}\n\`\`\``;
    const out = parseMasteringRecommendationsResponse(text);
    expect(out).not.toBeNull();
    expect(out!.m.recommendedValue).toBe('keep');
    expect(out!.m.recommendedRawValue).toBeUndefined();
  });

  it('defaults reason to empty string when missing', () => {
    const text = `\`\`\`json\n{"recommendations":{"m":{"recommendedValue":"x"}}}\n\`\`\``;
    const out = parseMasteringRecommendationsResponse(text);
    expect(out).not.toBeNull();
    expect(out!.m.reason).toBe('');
  });

  it('returns null when every entry is malformed (no valid recs survive)', () => {
    const text = `\`\`\`json\n{"recommendations":{"a":{"reason":"no value"},"b":null}}\n\`\`\``;
    expect(parseMasteringRecommendationsResponse(text)).toBeNull();
  });

  it('handles fenced block without "json" language tag', () => {
    const text = '```\n{"recommendations":{"x":{"recommendedValue":"y","reason":"z"}}}\n```';
    const out = parseMasteringRecommendationsResponse(text);
    expect(out).not.toBeNull();
    expect(out!.x.recommendedValue).toBe('y');
  });

  it('handles prose before AND after the fenced block', () => {
    const text =
      'Some intro.\n```json\n{"recommendations":{"lufs":{"recommendedValue":"-13","reason":"r"}}}\n```\nSome outro.';
    const out = parseMasteringRecommendationsResponse(text);
    expect(out).not.toBeNull();
    expect(out!.lufs.recommendedValue).toBe('-13');
  });

  it('parses a bare JSON object with 5+ metrics (regression: old lazy regex truncated to first 2)', () => {
    const text = `Recs: {"recommendations":${'{' +
      ['a', 'b', 'c', 'd', 'e', 'f']
        .map((k) => `"${k}":{"recommendedValue":"${k}V","reason":"${k}r"}`)
        .join(',') +
      '}'}}`;
    const out = parseMasteringRecommendationsResponse(text);
    expect(out).not.toBeNull();
    expect(Object.keys(out!).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

describe('computeMasteringAnalysisVersion', () => {
  it('is deterministic for the same input', () => {
    const input = {
      integratedLufs: -14.2,
      truePeakDbfs: -1.0,
      loudnessRangeLufs: 5.5,
      crestFactorDb: 12.4,
      peakDbfs: -0.8,
      tonalBalance: { low: 0.33, mid: 0.34, high: 0.33 },
      sampleRateHz: 44100,
    };
    expect(computeMasteringAnalysisVersion(input)).toBe(
      computeMasteringAnalysisVersion(input),
    );
  });

  it('rounds numeric inputs to 2 decimals so micro-float drift does not flip the fingerprint', () => {
    const a = computeMasteringAnalysisVersion({
      integratedLufs: -14.201,
      truePeakDbfs: -1.001,
      loudnessRangeLufs: 5.501,
      crestFactorDb: 12.401,
      peakDbfs: -0.801,
      tonalBalance: null,
      sampleRateHz: 44100,
    });
    const b = computeMasteringAnalysisVersion({
      integratedLufs: -14.199,
      truePeakDbfs: -0.999,
      loudnessRangeLufs: 5.499,
      crestFactorDb: 12.399,
      peakDbfs: -0.799,
      tonalBalance: null,
      sampleRateHz: 44100,
    });
    // All inputs round to the same 2dp values → same fingerprint.
    expect(a).toBe(b);
  });

  it('produces a different fingerprint when a tonal-balance band changes (even slightly past rounding)', () => {
    const base = {
      integratedLufs: -14,
      truePeakDbfs: -1,
      loudnessRangeLufs: 5,
      crestFactorDb: 12,
      peakDbfs: -1,
      tonalBalance: { low: 0.33, mid: 0.34, high: 0.33 },
      sampleRateHz: 44100,
    };
    const shifted = {
      ...base,
      tonalBalance: { low: 0.4, mid: 0.3, high: 0.3 },
    };
    expect(computeMasteringAnalysisVersion(base)).not.toBe(
      computeMasteringAnalysisVersion(shifted),
    );
  });

  it('normalizes null/undefined/NaN to "n/a" without throwing', () => {
    const version = computeMasteringAnalysisVersion({
      integratedLufs: null,
      truePeakDbfs: undefined,
      loudnessRangeLufs: Number.NaN,
      crestFactorDb: null,
      peakDbfs: null,
      tonalBalance: null,
      sampleRateHz: null,
    });
    expect(version).toContain('n/a');
    // All 7 slots n/a → fingerprint is a deterministic "n/a::n/a::n/a::n/a::n/a::n/a::n/a".
    expect(version.split('::').every((s) => s === 'n/a')).toBe(true);
  });

  it('distinguishes 44100 Hz vs 48000 Hz sample rate (integer-level field matters)', () => {
    const base = {
      integratedLufs: -14,
      truePeakDbfs: -1,
      loudnessRangeLufs: 5,
      crestFactorDb: 12,
      peakDbfs: -1,
      tonalBalance: null,
      sampleRateHz: 44100,
    };
    expect(computeMasteringAnalysisVersion(base)).not.toBe(
      computeMasteringAnalysisVersion({ ...base, sampleRateHz: 48000 }),
    );
  });

  it('tonalBalance null vs provided produces different fingerprints', () => {
    const a = computeMasteringAnalysisVersion({
      integratedLufs: -14,
      truePeakDbfs: -1,
      loudnessRangeLufs: 5,
      crestFactorDb: 12,
      peakDbfs: -1,
      tonalBalance: null,
      sampleRateHz: 44100,
    });
    const b = computeMasteringAnalysisVersion({
      integratedLufs: -14,
      truePeakDbfs: -1,
      loudnessRangeLufs: 5,
      crestFactorDb: 12,
      peakDbfs: -1,
      tonalBalance: { low: 0, mid: 0, high: 0 },
      sampleRateHz: 44100,
    });
    expect(a).not.toBe(b);
  });

  it('returns a string joined by :: in deterministic field order', () => {
    const version = computeMasteringAnalysisVersion({
      integratedLufs: -14,
      truePeakDbfs: -1,
      loudnessRangeLufs: 5,
      crestFactorDb: 12,
      peakDbfs: -1,
      tonalBalance: null,
      sampleRateHz: 44100,
    });
    // 7 fields: integratedLufs, truePeakDbfs, loudnessRangeLufs,
    // crestFactorDb, peakDbfs, tonalBalance, sampleRateHz.
    expect(version.split('::').length).toBe(7);
  });
});
