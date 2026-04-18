/**
 * v3.28.0 — Unit tests for the Mastering Checklist rule module.
 *
 * One fixture per rule plus the shared cross-cutting behaviour:
 *   - Null measured/analysis inputs render as `unavailable` (NOT fail).
 *   - Legacy row IDs (`lufs`, `true-peak`, `dc-offset`, `clipping`) are
 *     still present in the registry for the v3.26 promotion flow.
 *   - Category ordering + grouping.
 */

import { describe, expect, it } from 'vitest';
import type { AudioFileAnalysis } from '@producer-player/contracts';
import type { TrackAnalysisResult } from './audioAnalysis';
import {
  MASTERING_CHECKLIST_CATEGORY_ORDER,
  MASTERING_CHECKLIST_RULES,
  getMasteringChecklistRuleById,
  groupMasteringChecklistRules,
  masteringChecklistStatusIcon,
  type MasteringChecklistEvaluationInput,
  type MasteringChecklistRule,
} from './masteringChecklistRules';

function makeMeasured(overrides: Partial<AudioFileAnalysis> = {}): AudioFileAnalysis {
  return {
    filePath: '/tmp/fake.wav',
    measuredWith: 'ffmpeg-ebur128-volumedetect',
    integratedLufs: -12,
    loudnessRangeLufs: 7,
    truePeakDbfs: -1.5,
    samplePeakDbfs: -1.8,
    meanVolumeDbfs: -18,
    maxMomentaryLufs: -8,
    maxShortTermLufs: -10,
    sampleRateHz: 44100,
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<TrackAnalysisResult> = {}): TrackAnalysisResult {
  return {
    peakDbfs: -1,
    integratedLufsEstimate: -14,
    frameLoudnessDbfs: [-20, -15, -14, -14, -15, -16, -20, -30, -50, -70],
    frameDurationSeconds: 0.25,
    durationSeconds: 2.5,
    tonalBalance: { low: 0.3, mid: 0.55, high: 0.15 },
    rmsDbfs: -12,
    crestFactorDb: 11,
    dcOffset: 0,
    clipCount: 0,
    waveformPeaks: new Float32Array(0),
    ...overrides,
  };
}

function evaluate(id: string, input: MasteringChecklistEvaluationInput) {
  const rule = getMasteringChecklistRuleById(id);
  if (!rule) throw new Error(`Rule not found: ${id}`);
  return rule.evaluate(input);
}

describe('MASTERING_CHECKLIST_RULES registry', () => {
  it('includes the four legacy row IDs so the v3.26 promotion flow keeps working', () => {
    const ids = new Set(MASTERING_CHECKLIST_RULES.map((r) => r.id));
    expect(ids).toContain('lufs');
    expect(ids).toContain('true-peak');
    expect(ids).toContain('dc-offset');
    expect(ids).toContain('clipping');
  });

  it('has unique rule IDs', () => {
    const ids = MASTERING_CHECKLIST_RULES.map((r) => r.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('contains at least 16 rules (4 legacy + 12 new from the Phase 1 plan)', () => {
    expect(MASTERING_CHECKLIST_RULES.length).toBeGreaterThanOrEqual(16);
  });

  it('assigns every rule to one of the six canonical categories', () => {
    const allowed = new Set(MASTERING_CHECKLIST_CATEGORY_ORDER);
    for (const rule of MASTERING_CHECKLIST_RULES) {
      expect(allowed.has(rule.category)).toBe(true);
    }
  });
});

describe('groupMasteringChecklistRules', () => {
  it('returns one entry per category in render order', () => {
    const groups = groupMasteringChecklistRules();
    expect(groups.map((g) => g.category)).toEqual([
      'Loudness',
      'Peaks',
      'Dynamics',
      'Stereo',
      'Spectrum',
      'Housekeeping',
    ]);
  });

  it('preserves in-registry rule order within each category', () => {
    const loudness = groupMasteringChecklistRules().find((g) => g.category === 'Loudness');
    expect(loudness).toBeDefined();
    // Registry declares LUFS first in the Loudness group — assert that
    // grouping doesn't reshuffle within a category.
    expect(loudness!.rules[0].id).toBe('lufs');
  });
});

describe('masteringChecklistStatusIcon', () => {
  it('returns distinct glyphs for pass/warn/fail/unavailable', () => {
    const pass = masteringChecklistStatusIcon('pass');
    const warn = masteringChecklistStatusIcon('warn');
    const fail = masteringChecklistStatusIcon('fail');
    const unavailable = masteringChecklistStatusIcon('unavailable');
    const set = new Set([pass, warn, fail, unavailable]);
    expect(set.size).toBe(4);
    // Guard against regressing back to the "fail renders ⚠" bug.
    expect(warn).not.toBe(fail);
  });
});

describe('unavailable handling (bug fix 5: null ffmpeg values no longer class as fail)', () => {
  it('returns unavailable when measured is null for an ffmpeg-sourced rule', () => {
    const result = evaluate('lufs', { measured: null, analysis: makeAnalysis() });
    expect(result.status).toBe('unavailable');
  });

  it('returns unavailable when analysis is null for a renderer-sourced rule', () => {
    const result = evaluate('dc-offset', { measured: makeMeasured(), analysis: null });
    expect(result.status).toBe('unavailable');
  });

  it('returns unavailable for LUFS when ffmpeg emitted a null integratedLufs', () => {
    const result = evaluate('lufs', {
      measured: makeMeasured({ integratedLufs: null }),
      analysis: makeAnalysis(),
    });
    expect(result.status).toBe('unavailable');
  });
});

describe('evaluateLufs', () => {
  it('passes at -12 LUFS (inside the streaming band)', () => {
    const r = evaluate('lufs', { measured: makeMeasured({ integratedLufs: -12 }), analysis: makeAnalysis() });
    expect(r.status).toBe('pass');
  });

  it('fails at -5 LUFS (above -7 means crushed — new v3.28 threshold)', () => {
    const r = evaluate('lufs', { measured: makeMeasured({ integratedLufs: -5 }), analysis: makeAnalysis() });
    expect(r.status).toBe('fail');
  });

  it('warns between -8 and -7 LUFS', () => {
    const r = evaluate('lufs', { measured: makeMeasured({ integratedLufs: -7.5 }), analysis: makeAnalysis() });
    expect(r.status).toBe('warn');
  });

  it('fails below -20 LUFS', () => {
    const r = evaluate('lufs', { measured: makeMeasured({ integratedLufs: -25 }), analysis: makeAnalysis() });
    expect(r.status).toBe('fail');
  });

  it('warns between -20 and -16 LUFS (quiet)', () => {
    const r = evaluate('lufs', { measured: makeMeasured({ integratedLufs: -18 }), analysis: makeAnalysis() });
    expect(r.status).toBe('warn');
  });
});

describe('evaluateTruePeak', () => {
  it('passes below -1 dBTP', () => {
    const r = evaluate('true-peak', { measured: makeMeasured({ truePeakDbfs: -1.5 }), analysis: makeAnalysis() });
    expect(r.status).toBe('pass');
  });

  it('warns between -1 and 0 dBTP', () => {
    const r = evaluate('true-peak', { measured: makeMeasured({ truePeakDbfs: -0.5 }), analysis: makeAnalysis() });
    expect(r.status).toBe('warn');
  });

  it('fails at or above 0 dBTP', () => {
    const r = evaluate('true-peak', { measured: makeMeasured({ truePeakDbfs: 0 }), analysis: makeAnalysis() });
    expect(r.status).toBe('fail');
  });
});

describe('evaluateDcOffset', () => {
  it('passes at 0', () => {
    const r = evaluate('dc-offset', { measured: makeMeasured(), analysis: makeAnalysis({ dcOffset: 0 }) });
    expect(r.status).toBe('pass');
  });
  it('warns at 0.01', () => {
    const r = evaluate('dc-offset', { measured: makeMeasured(), analysis: makeAnalysis({ dcOffset: 0.01 }) });
    expect(r.status).toBe('warn');
  });
});

describe('evaluateClipping (v3.28 graduated tiers — bug fix 3)', () => {
  it('passes at 0 clips', () => {
    const r = evaluate('clipping', { measured: makeMeasured(), analysis: makeAnalysis({ clipCount: 0 }) });
    expect(r.status).toBe('pass');
  });
  it('warns at 1-3 clips', () => {
    const r1 = evaluate('clipping', { measured: makeMeasured(), analysis: makeAnalysis({ clipCount: 1 }) });
    const r3 = evaluate('clipping', { measured: makeMeasured(), analysis: makeAnalysis({ clipCount: 3 }) });
    expect(r1.status).toBe('warn');
    expect(r3.status).toBe('warn');
  });
  it('fails at 4 or more clips', () => {
    const r = evaluate('clipping', { measured: makeMeasured(), analysis: makeAnalysis({ clipCount: 4 }) });
    expect(r.status).toBe('fail');
  });
});

describe('A1 — Loudness Range', () => {
  it('passes at 7 LU', () => {
    const r = evaluate('loudness-range', { measured: makeMeasured({ loudnessRangeLufs: 7 }), analysis: makeAnalysis() });
    expect(r.status).toBe('pass');
  });
  it('warns below 4 LU', () => {
    const r = evaluate('loudness-range', { measured: makeMeasured({ loudnessRangeLufs: 3 }), analysis: makeAnalysis() });
    expect(r.status).toBe('warn');
  });
  it('warns above 15 LU', () => {
    const r = evaluate('loudness-range', { measured: makeMeasured({ loudnessRangeLufs: 20 }), analysis: makeAnalysis() });
    expect(r.status).toBe('warn');
  });
  it('fails below 2 LU', () => {
    const r = evaluate('loudness-range', { measured: makeMeasured({ loudnessRangeLufs: 1 }), analysis: makeAnalysis() });
    expect(r.status).toBe('fail');
  });
});

describe('A2 — Short-term vs Integrated gap', () => {
  it('passes when gap is 2 LU', () => {
    const r = evaluate('short-term-gap', {
      measured: makeMeasured({ maxShortTermLufs: -10, integratedLufs: -12 }),
      analysis: makeAnalysis(),
    });
    expect(r.status).toBe('pass');
  });
  it('warns when gap > 6 LU', () => {
    const r = evaluate('short-term-gap', {
      measured: makeMeasured({ maxShortTermLufs: -5, integratedLufs: -14 }),
      analysis: makeAnalysis(),
    });
    expect(r.status).toBe('warn');
  });
  it('fails when gap > 10 LU', () => {
    const r = evaluate('short-term-gap', {
      measured: makeMeasured({ maxShortTermLufs: -3, integratedLufs: -14 }),
      analysis: makeAnalysis(),
    });
    expect(r.status).toBe('fail');
  });
});

describe('A3 — Momentary peak loudness', () => {
  it('passes at -10 LUFS', () => {
    const r = evaluate('momentary-peak', { measured: makeMeasured({ maxMomentaryLufs: -10 }), analysis: makeAnalysis() });
    expect(r.status).toBe('pass');
  });
  it('warns above -5 LUFS', () => {
    const r = evaluate('momentary-peak', { measured: makeMeasured({ maxMomentaryLufs: -4 }), analysis: makeAnalysis() });
    expect(r.status).toBe('warn');
  });
  it('fails above -3 LUFS', () => {
    const r = evaluate('momentary-peak', { measured: makeMeasured({ maxMomentaryLufs: -2 }), analysis: makeAnalysis() });
    expect(r.status).toBe('fail');
  });
});

describe('A4 — Crest factor / PLR', () => {
  it('passes at 11 dB', () => {
    const r = evaluate('crest-factor', { measured: makeMeasured(), analysis: makeAnalysis({ crestFactorDb: 11 }) });
    expect(r.status).toBe('pass');
  });
  it('warns below 8 dB', () => {
    const r = evaluate('crest-factor', { measured: makeMeasured(), analysis: makeAnalysis({ crestFactorDb: 7 }) });
    expect(r.status).toBe('warn');
  });
  it('fails below 6 dB', () => {
    const r = evaluate('crest-factor', { measured: makeMeasured(), analysis: makeAnalysis({ crestFactorDb: 5 }) });
    expect(r.status).toBe('fail');
  });
});

describe('A5 — Sample-peak vs true-peak delta (ISP risk)', () => {
  it('passes when delta small and levels low', () => {
    const r = evaluate('isp-risk', {
      measured: makeMeasured({ samplePeakDbfs: -3, truePeakDbfs: -2.9 }),
      analysis: makeAnalysis(),
    });
    expect(r.status).toBe('pass');
  });
  it('passes when big delta but true peak still safely below -1 dBTP', () => {
    const r = evaluate('isp-risk', {
      measured: makeMeasured({ samplePeakDbfs: -5, truePeakDbfs: -3 }),
      analysis: makeAnalysis(),
    });
    expect(r.status).toBe('pass');
  });
  it('warns when delta > 0.5 dB AND true peak > -1 dBTP', () => {
    const r = evaluate('isp-risk', {
      measured: makeMeasured({ samplePeakDbfs: -1.2, truePeakDbfs: -0.3 }),
      analysis: makeAnalysis(),
    });
    expect(r.status).toBe('warn');
  });
});

describe('A7 — Spectral balance — bass', () => {
  it('passes with balanced low band', () => {
    const r = evaluate('spectral-bass', {
      measured: makeMeasured(),
      analysis: makeAnalysis({ tonalBalance: { low: 0.3, mid: 0.55, high: 0.15 } }),
    });
    expect(r.status).toBe('pass');
  });
  it('warns when low > 0.5 (muddy)', () => {
    const r = evaluate('spectral-bass', {
      measured: makeMeasured(),
      analysis: makeAnalysis({ tonalBalance: { low: 0.7, mid: 0.2, high: 0.1 } }),
    });
    expect(r.status).toBe('warn');
  });
  it('warns when low < 0.15 (thin)', () => {
    const r = evaluate('spectral-bass', {
      measured: makeMeasured(),
      analysis: makeAnalysis({ tonalBalance: { low: 0.1, mid: 0.6, high: 0.3 } }),
    });
    expect(r.status).toBe('warn');
  });
});

describe('A8 — Spectral balance — treble', () => {
  it('passes with balanced high band', () => {
    const r = evaluate('spectral-treble', {
      measured: makeMeasured(),
      analysis: makeAnalysis({ tonalBalance: { low: 0.3, mid: 0.55, high: 0.15 } }),
    });
    expect(r.status).toBe('pass');
  });
  it('warns when high > 0.25 (harsh)', () => {
    const r = evaluate('spectral-treble', {
      measured: makeMeasured(),
      analysis: makeAnalysis({ tonalBalance: { low: 0.25, mid: 0.45, high: 0.3 } }),
    });
    expect(r.status).toBe('warn');
  });
  it('warns when high < 0.03 (dull)', () => {
    const r = evaluate('spectral-treble', {
      measured: makeMeasured(),
      analysis: makeAnalysis({ tonalBalance: { low: 0.4, mid: 0.58, high: 0.02 } }),
    });
    expect(r.status).toBe('warn');
  });
});

describe('A9 — Leading/trailing silence', () => {
  it('passes when lead/tail silence is short', () => {
    const r = evaluate('silence-trim', {
      measured: makeMeasured(),
      analysis: makeAnalysis({
        frameLoudnessDbfs: [-20, -15, -14, -16, -15, -18, -22, -30],
        frameDurationSeconds: 0.25,
      }),
    });
    expect(r.status).toBe('pass');
  });
  it('warns when leading silence exceeds 1 s', () => {
    // 5 frames × 0.25s = 1.25s of silence at the start.
    const r = evaluate('silence-trim', {
      measured: makeMeasured(),
      analysis: makeAnalysis({
        frameLoudnessDbfs: [-80, -80, -80, -80, -80, -15, -15, -15],
        frameDurationSeconds: 0.25,
      }),
    });
    expect(r.status).toBe('warn');
  });
  it('warns when trailing silence exceeds 3 s', () => {
    // 13 frames × 0.25s = 3.25s of silence at the end.
    const trailingSilence = Array(13).fill(-80);
    const r = evaluate('silence-trim', {
      measured: makeMeasured(),
      analysis: makeAnalysis({
        frameLoudnessDbfs: [-15, -15, -15, -15, ...trailingSilence],
        frameDurationSeconds: 0.25,
      }),
    });
    expect(r.status).toBe('warn');
  });
});

describe('A10 — Sample rate conformance', () => {
  it('passes at 44.1 kHz', () => {
    const r = evaluate('sample-rate', { measured: makeMeasured({ sampleRateHz: 44100 }), analysis: makeAnalysis() });
    expect(r.status).toBe('pass');
  });
  it('passes at 96 kHz', () => {
    const r = evaluate('sample-rate', { measured: makeMeasured({ sampleRateHz: 96000 }), analysis: makeAnalysis() });
    expect(r.status).toBe('pass');
  });
  it('warns at 22050 Hz', () => {
    const r = evaluate('sample-rate', { measured: makeMeasured({ sampleRateHz: 22050 }), analysis: makeAnalysis() });
    expect(r.status).toBe('warn');
  });
});

describe('A15 — Noise floor', () => {
  it('passes when the quietest 1% of frames is below -60 dBFS', () => {
    // 200 frames → 1% index = floor(200 * 0.01) = 2 (third-smallest).
    // Put 3 quiet frames at -80 so the 3rd smallest is still below -60.
    const frames = Array(200).fill(-20);
    frames[0] = -80;
    frames[1] = -80;
    frames[2] = -80;
    const r = evaluate('noise-floor', {
      measured: makeMeasured(),
      analysis: makeAnalysis({ frameLoudnessDbfs: frames }),
    });
    expect(r.status).toBe('pass');
  });
  it('warns when the quietest 1% of frames is above -60 dBFS', () => {
    const frames = Array(200).fill(-20);
    frames[0] = -40;
    frames[1] = -40;
    const r = evaluate('noise-floor', {
      measured: makeMeasured(),
      analysis: makeAnalysis({ frameLoudnessDbfs: frames }),
    });
    expect(r.status).toBe('warn');
  });
});

describe('A16 — Over-limiting duration', () => {
  it('passes when very few frames are near max', () => {
    const frames = [-10, -20, -25, -30, -35, -40, -20, -25, -30, -35];
    const r = evaluate('over-limiting', {
      measured: makeMeasured(),
      analysis: makeAnalysis({ frameLoudnessDbfs: frames }),
    });
    expect(r.status).toBe('pass');
  });
  it('warns when >50% of frames are within 1 dB of max', () => {
    const frames = [-10, -10, -10, -10, -10, -10, -20, -25, -30, -35];
    const r = evaluate('over-limiting', {
      measured: makeMeasured(),
      analysis: makeAnalysis({ frameLoudnessDbfs: frames }),
    });
    expect(r.status).toBe('warn');
  });
  it('fails when >75% of frames ride the ceiling', () => {
    const frames = [-10, -10, -10, -10, -10, -10, -10, -10, -10, -25];
    const r = evaluate('over-limiting', {
      measured: makeMeasured(),
      analysis: makeAnalysis({ frameLoudnessDbfs: frames }),
    });
    expect(r.status).toBe('fail');
  });
});

describe('A18 — Truncated tail', () => {
  it('passes when tail decays smoothly', () => {
    const r = evaluate('truncated-tail', {
      measured: makeMeasured(),
      analysis: makeAnalysis({
        frameLoudnessDbfs: [-10, -15, -25, -40, -60, -80],
        frameDurationSeconds: 0.25,
      }),
    });
    expect(r.status).toBe('pass');
  });
  it('warns when last 100 ms is loud and flat', () => {
    // All final-window frames at -10 dBFS — loud and not decaying.
    const r = evaluate('truncated-tail', {
      measured: makeMeasured(),
      analysis: makeAnalysis({
        frameLoudnessDbfs: [-20, -15, -10, -10, -10],
        frameDurationSeconds: 0.05, // 5 frames covering last 250 ms; last ~100 ms = 2 frames
      }),
    });
    expect(r.status).toBe('warn');
  });
});
