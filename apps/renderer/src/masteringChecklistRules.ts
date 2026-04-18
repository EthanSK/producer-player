/**
 * v3.28.0 — Mastering Checklist rule module (Phase 1 of the expansion plan).
 *
 * Extracts the per-row rule logic out of the giant inline JSX block in
 * App.tsx. One function per rule, one array of rule descriptors. The
 * renderer iterates the array, calls `evaluate(input)` for each rule, and
 * renders the returned `{ status, value, message, tooltip }` in a category
 * group.
 *
 * Inputs (`MasteringChecklistEvaluationInput`):
 *   - `measured` : `AudioFileAnalysis | null`    — ffmpeg ebur128 + volumedetect
 *                  produced in `apps/electron/src/main.ts` (`analyzeAudioFile`).
 *                  When `null` every rule sourced from ffmpeg returns
 *                  `status: 'unavailable'`.
 *   - `analysis` : `TrackAnalysisResult | null` — Web Audio decoded-float
 *                  result from `apps/renderer/src/audioAnalysis.ts`.
 *                  When `null` every rule sourced from the renderer returns
 *                  `status: 'unavailable'`.
 *
 * Rule IDs are stable, kebab-case strings. The four legacy row IDs
 * (`lufs`, `true-peak`, `dc-offset`, `clipping`) are preserved so the
 * existing Playwright specs (`mastering-to-checklist.spec.ts`) and
 * `buildMasteringChecklistItemText` continue to resolve. New rules land
 * alongside them under descriptive IDs.
 *
 * Reference: design doc `docs/MASTERING_CHECKLIST_PLAN.md` §2 + §4.
 */

import type { AudioFileAnalysis } from '@producer-player/contracts';
import type { TrackAnalysisResult } from './audioAnalysis';

export type MasteringChecklistStatus = 'pass' | 'warn' | 'fail' | 'unavailable';

/**
 * Categories for grouping rows in the rendered checklist. Order matters —
 * render code iterates in this order.
 */
export type MasteringChecklistCategory =
  | 'Loudness'
  | 'Peaks'
  | 'Dynamics'
  | 'Stereo'
  | 'Spectrum'
  | 'Housekeeping';

export const MASTERING_CHECKLIST_CATEGORY_ORDER: ReadonlyArray<MasteringChecklistCategory> = [
  'Loudness',
  'Peaks',
  'Dynamics',
  'Stereo',
  'Spectrum',
  'Housekeeping',
];

export interface MasteringChecklistEvaluationInput {
  measured: AudioFileAnalysis | null;
  analysis: TrackAnalysisResult | null;
}

export interface MasteringChecklistEvaluation {
  status: MasteringChecklistStatus;
  value: string;
  message: string;
  /** Optional per-row "why this matters" blurb for the HelpTooltip. */
  tooltip?: string;
}

export interface MasteringChecklistRule {
  id: string;
  label: string;
  category: MasteringChecklistCategory;
  evaluate(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation;
}

const UNAVAILABLE: MasteringChecklistEvaluation = {
  status: 'unavailable',
  value: '—',
  message: 'Not measured',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDb(value: number, precision = 1): string {
  return `${value.toFixed(precision)} dB`;
}

function formatLufs(value: number, precision = 1): string {
  return `${value.toFixed(precision)} LUFS`;
}

function formatLu(value: number, precision = 1): string {
  return `${value.toFixed(precision)} LU`;
}

// ---------------------------------------------------------------------------
// Legacy rules (preserved IDs)
// ---------------------------------------------------------------------------

/**
 * LUFS — Integrated loudness.
 *
 * v3.28 tightened the upper bound from -6 to -8 LUFS per the design doc:
 * anything louder than -7 LUFS is unambiguously crushed for streaming.
 *   pass  : -16 ≤ lufs ≤ -8
 *   warn  : -20 ≤ lufs < -16  OR  -8 < lufs ≤ -7
 *   fail  : lufs < -20  OR  lufs > -7
 */
function evaluateLufs(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const lufs = input.measured?.integratedLufs ?? null;
  if (lufs === null) return UNAVAILABLE;

  const value = formatLufs(lufs);

  if (lufs > -7) {
    return {
      status: 'fail',
      value,
      message: `Above -7 LUFS — unambiguously crushed, platforms will turn this DOWN and you lose transient headroom`,
    };
  }
  if (lufs > -8) {
    return {
      status: 'warn',
      value,
      message: `Between -8 and -7 LUFS — quite loud, expect significant normalization on Spotify/Apple`,
    };
  }
  if (lufs >= -16) {
    return {
      status: 'pass',
      value,
      message: `Within -16..-8 LUFS streaming range`,
    };
  }
  if (lufs >= -20) {
    return {
      status: 'warn',
      value,
      message: `Below -16 LUFS — on the quiet side; may get upgained or sound weaker than peers`,
    };
  }
  return {
    status: 'fail',
    value,
    message: `Below -20 LUFS — too quiet for commercial distribution`,
  };
}

/**
 * True Peak — peak level in dBTP after inter-sample reconstruction.
 *   pass  : truePeak < -1 dBTP
 *   warn  : -1 ≤ truePeak < 0
 *   fail  : truePeak ≥ 0
 */
function evaluateTruePeak(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const tp = input.measured?.truePeakDbfs ?? null;
  if (tp === null) return UNAVAILABLE;

  const value = `${tp.toFixed(1)} dBTP`;
  if (tp < -1) {
    return { status: 'pass', value, message: 'Below -1 dBTP ceiling — safe across streaming platforms' };
  }
  if (tp < 0) {
    return { status: 'warn', value, message: 'Between -1 and 0 dBTP — risk of inter-sample clipping after lossy encoding' };
  }
  return { status: 'fail', value, message: 'At or above 0 dBTP — will clip on playback' };
}

/**
 * DC Offset — mean sample value.
 *   pass  : |dcOffset| ≤ 0.001 (0.1% FS)
 *   warn  : anything higher
 */
function evaluateDcOffset(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const analysis = input.analysis;
  if (!analysis) return UNAVAILABLE;

  const abs = Math.abs(analysis.dcOffset);
  if (abs <= 0.001) {
    return { status: 'pass', value: 'None', message: 'No detectable DC offset' };
  }
  return {
    status: 'warn',
    value: `${(analysis.dcOffset * 100).toFixed(3)}%`,
    message: 'Wastes headroom and causes asymmetric clipping — high-pass at 10-20 Hz or use DC offset removal',
  };
}

/**
 * Clipping — count of samples at or past ±1.0.
 *
 * v3.28 graduated from binary pass/fail to a tiered rule per the design
 * doc: one or two clips can happen after legitimate resampling, so we
 * warn at 1-3 and only fail from 4 onwards. (Rule A11.)
 *   pass  : clipCount === 0
 *   warn  : 1 ≤ clipCount ≤ 3
 *   fail  : clipCount ≥ 4
 */
function evaluateClipping(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const analysis = input.analysis;
  if (!analysis) return UNAVAILABLE;

  const count = analysis.clipCount;
  if (count === 0) {
    return { status: 'pass', value: '0', message: 'No clipped samples detected' };
  }
  const plural = count === 1 ? '' : 's';
  if (count <= 3) {
    return {
      status: 'warn',
      value: `${count}`,
      message: `${count} clipped sample${plural} — likely post-resample artefact, consider lowering the limiter ceiling`,
    };
  }
  return {
    status: 'fail',
    value: `${count}`,
    message: `${count} clipped sample${plural} — reduce gain before the final limiter`,
  };
}

// ---------------------------------------------------------------------------
// New rules (Phase 1 additions)
// ---------------------------------------------------------------------------

/** A1 — Loudness Range (LRA). warn < 4 or > 15 LU; fail < 2 LU. */
function evaluateLoudnessRange(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const lra = input.measured?.loudnessRangeLufs ?? null;
  if (lra === null) return UNAVAILABLE;

  const value = formatLu(lra);
  if (lra < 2) {
    return { status: 'fail', value, message: 'Extremely over-compressed — almost no dynamic variation' };
  }
  if (lra < 4) {
    return { status: 'warn', value, message: 'Over-compressed — limited dynamic swing between verse and chorus' };
  }
  if (lra > 15) {
    return { status: 'warn', value, message: 'Very wide dynamics — streaming normalization may cause pumping' };
  }
  return { status: 'pass', value, message: 'Healthy dynamic range for streaming' };
}

/** A2 — Short-term vs integrated gap. warn > 6 LU; fail > 10 LU. */
function evaluateShortTermGap(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const measured = input.measured;
  if (!measured || measured.maxShortTermLufs === null || measured.integratedLufs === null) {
    return UNAVAILABLE;
  }
  const gap = measured.maxShortTermLufs - measured.integratedLufs;
  const value = formatLu(gap);
  if (gap > 10) {
    return {
      status: 'fail',
      value,
      message: 'Huge short-term spike vs integrated — limiter is pumping hard on the loudest section',
    };
  }
  if (gap > 6) {
    return {
      status: 'warn',
      value,
      message: 'Short-term peaks well above integrated — uneven loudness between sections',
    };
  }
  return { status: 'pass', value, message: 'Short-term loudness tracks the integrated level sensibly' };
}

/** A3 — Momentary peak loudness. warn > -5 LUFS; fail > -3 LUFS. */
function evaluateMomentaryPeak(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const m = input.measured?.maxMomentaryLufs ?? null;
  if (m === null) return UNAVAILABLE;

  const value = formatLufs(m);
  if (m > -3) {
    return {
      status: 'fail',
      value,
      message: 'Momentary peak above -3 LUFS — platform limiters will bite hard here',
    };
  }
  if (m > -5) {
    return {
      status: 'warn',
      value,
      message: 'Momentary peak above -5 LUFS — may trigger platform limiting',
    };
  }
  return { status: 'pass', value, message: 'Momentary peaks under safe threshold' };
}

/** A4 — Crest Factor / Peak-to-Loudness Ratio. warn < 8 dB; fail < 6 dB. */
function evaluateCrestFactor(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const analysis = input.analysis;
  if (!analysis) return UNAVAILABLE;

  const crest = analysis.crestFactorDb;
  const value = formatDb(crest);
  if (crest < 6) {
    return {
      status: 'fail',
      value,
      message: 'Under 6 dB — crushed, transients are gone',
    };
  }
  if (crest < 8) {
    return {
      status: 'warn',
      value,
      message: 'Under 8 dB — heavily limited, transients starting to disappear',
    };
  }
  return { status: 'pass', value, message: 'Healthy peak-to-average ratio' };
}

/**
 * A5 — Sample-peak vs true-peak delta (ISP risk).
 *   warn if delta > 0.5 dB AND truePeak > -1 dBTP
 *   else pass (not a problem at low levels, regardless of delta)
 */
function evaluateIspRisk(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const measured = input.measured;
  if (!measured || measured.truePeakDbfs === null || measured.samplePeakDbfs === null) {
    return UNAVAILABLE;
  }
  const delta = measured.truePeakDbfs - measured.samplePeakDbfs;
  const value = formatDb(delta);
  if (delta > 0.5 && measured.truePeakDbfs > -1) {
    return {
      status: 'warn',
      value,
      message: 'Inter-sample peaks overshoot by more than 0.5 dB above -1 dBTP — codec clipping risk',
    };
  }
  return { status: 'pass', value, message: 'Inter-sample overshoot is within safe margins' };
}

/**
 * A7 — Spectral balance — bass band.
 *   warn if low > 0.50 (muddy) or low < 0.15 (thin).
 *   Note: `tonalBalance.low` is a 0-1 energy ratio, so 0.5 means 50% of
 *   total spectral energy lives below 250 Hz.
 */
function evaluateSpectralBass(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const analysis = input.analysis;
  if (!analysis) return UNAVAILABLE;

  const low = analysis.tonalBalance.low;
  const value = `${(low * 100).toFixed(1)}%`;
  if (low > 0.5) {
    return { status: 'warn', value, message: 'Bass-heavy — may sound muddy or boomy' };
  }
  if (low < 0.15) {
    return { status: 'warn', value, message: 'Thin — lacking low-end weight' };
  }
  return { status: 'pass', value, message: 'Balanced bass energy' };
}

/**
 * A8 — Spectral balance — treble band.
 *   warn if high > 0.25 (harsh) or high < 0.03 (dull).
 */
function evaluateSpectralTreble(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const analysis = input.analysis;
  if (!analysis) return UNAVAILABLE;

  const high = analysis.tonalBalance.high;
  const value = `${(high * 100).toFixed(1)}%`;
  if (high > 0.25) {
    return { status: 'warn', value, message: 'Treble-heavy — may sound harsh or brittle' };
  }
  if (high < 0.03) {
    return { status: 'warn', value, message: 'Dull/dark — lacking air and detail' };
  }
  return { status: 'pass', value, message: 'Balanced treble energy' };
}

/**
 * A9 — Leading/trailing silence trim.
 *   warn if leading > 1 s (file start is silent) or trailing > 3 s (tail
 *   un-trimmed). Uses frame loudness threshold of -60 dBFS.
 *
 *   "Silence" threshold: frame loudness below -60 dBFS.
 */
const SILENCE_THRESHOLD_DBFS = -60;

function evaluateSilenceTrim(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const analysis = input.analysis;
  if (!analysis) return UNAVAILABLE;

  const frames = analysis.frameLoudnessDbfs;
  if (!frames || frames.length === 0) return UNAVAILABLE;

  const frameDuration = analysis.frameDurationSeconds || 0.25;

  let leadingFrames = 0;
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i] > SILENCE_THRESHOLD_DBFS) break;
    leadingFrames += 1;
  }

  let trailingFrames = 0;
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    if (frames[i] > SILENCE_THRESHOLD_DBFS) break;
    trailingFrames += 1;
  }

  const leadingSeconds = leadingFrames * frameDuration;
  const trailingSeconds = trailingFrames * frameDuration;
  const value = `lead ${leadingSeconds.toFixed(1)}s · tail ${trailingSeconds.toFixed(1)}s`;

  if (leadingSeconds > 1 || trailingSeconds > 3) {
    const issues: string[] = [];
    if (leadingSeconds > 1) issues.push(`${leadingSeconds.toFixed(1)}s of lead silence`);
    if (trailingSeconds > 3) issues.push(`${trailingSeconds.toFixed(1)}s of tail silence`);
    return {
      status: 'warn',
      value,
      message: `${issues.join(' and ')} — consider trimming to tighten the file`,
    };
  }
  return { status: 'pass', value, message: 'Lead and tail silence within typical bounds' };
}

/** A10 — Sample rate conformance. warn if not in {44100, 48000, 88200, 96000}. */
const STANDARD_SAMPLE_RATES = new Set([44100, 48000, 88200, 96000]);

function evaluateSampleRate(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const sr = input.measured?.sampleRateHz ?? null;
  if (sr === null) return UNAVAILABLE;

  const value = `${sr} Hz`;
  if (STANDARD_SAMPLE_RATES.has(sr)) {
    return { status: 'pass', value, message: 'Standard distribution sample rate' };
  }
  return {
    status: 'warn',
    value,
    message: 'Non-standard sample rate — most distribution targets expect 44.1 or 48 kHz',
  };
}

/**
 * A15 — Noise floor. warn if lowest 1% of frame loudness > -60 dBFS
 * (suggests persistent noise, tape hiss, bus noise, reverb bleed).
 */
function evaluateNoiseFloor(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const analysis = input.analysis;
  if (!analysis) return UNAVAILABLE;

  const frames = analysis.frameLoudnessDbfs;
  if (!frames || frames.length === 0) return UNAVAILABLE;

  // Take a percentile over a sorted copy to avoid mutating the source
  // array (it's shared with the renderer).
  const sorted = [...frames].sort((a, b) => a - b);
  const percentileIndex = Math.max(0, Math.floor(sorted.length * 0.01));
  const lowestPercentile = sorted[percentileIndex];
  const value = formatDb(lowestPercentile);

  if (lowestPercentile > SILENCE_THRESHOLD_DBFS) {
    return {
      status: 'warn',
      value,
      message: 'Noise floor above -60 dBFS — persistent background hiss or bus noise',
    };
  }
  return { status: 'pass', value, message: 'Noise floor below -60 dBFS' };
}

/**
 * A16 — Over-limiting duration. warn if >50% of short-term windows within
 * 1 LU (really, 1 dB on our dBFS frame values) of the maximum; fail at >75%.
 *
 * The frame-loudness series we have is RMS-based dBFS per 250 ms frame, so
 * "short-term windows" here map onto those frames directly — the practical
 * effect (limiter riding the ceiling) shows up the same way.
 */
function evaluateOverLimiting(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const analysis = input.analysis;
  if (!analysis) return UNAVAILABLE;

  const frames = analysis.frameLoudnessDbfs;
  if (!frames || frames.length === 0) return UNAVAILABLE;

  let max = -Infinity;
  for (const f of frames) {
    if (f > max) max = f;
  }
  if (!Number.isFinite(max)) return UNAVAILABLE;

  const threshold = max - 1;
  let nearMax = 0;
  for (const f of frames) {
    if (f >= threshold) nearMax += 1;
  }
  const fraction = nearMax / frames.length;
  const value = `${(fraction * 100).toFixed(0)}%`;

  if (fraction > 0.75) {
    return {
      status: 'fail',
      value,
      message: 'Over-limited — more than 75% of the track is riding the ceiling',
    };
  }
  if (fraction > 0.5) {
    return {
      status: 'warn',
      value,
      message: 'Heavy limiting — more than half the track is riding the ceiling',
    };
  }
  return { status: 'pass', value, message: 'Limiter activity within healthy bounds' };
}

/**
 * A18 — Truncated tail. warn if the last 100 ms has energy > -40 dBFS and
 * the tail is not smoothly decaying. Smooth-decay check: the last frame must
 * be meaningfully lower than the mean of the final window.
 */
function evaluateTruncatedTail(input: MasteringChecklistEvaluationInput): MasteringChecklistEvaluation {
  const analysis = input.analysis;
  if (!analysis) return UNAVAILABLE;

  const frames = analysis.frameLoudnessDbfs;
  if (!frames || frames.length === 0) return UNAVAILABLE;

  const frameDuration = analysis.frameDurationSeconds || 0.25;
  const framesInLast100ms = Math.max(1, Math.ceil(0.1 / frameDuration));
  const startIndex = Math.max(0, frames.length - framesInLast100ms);

  let sum = 0;
  let countedFrames = 0;
  for (let i = startIndex; i < frames.length; i += 1) {
    sum += frames[i];
    countedFrames += 1;
  }
  const meanTail = countedFrames > 0 ? sum / countedFrames : -Infinity;
  const finalFrame = frames[frames.length - 1];
  const value = formatDb(meanTail);

  const energetic = meanTail > -40;
  // "Smooth decay" = final frame is at least 3 dB lower than the window
  // mean. Otherwise the tail is essentially flat up to the cut.
  const notDecaying = finalFrame >= meanTail - 3;

  if (energetic && notDecaying) {
    return {
      status: 'warn',
      value,
      message: 'Last 100 ms is loud and not decaying — possible abrupt cut or truncated reverb',
    };
  }
  return { status: 'pass', value, message: 'Tail decays cleanly' };
}

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

/**
 * All rules, in render order. Within a category, rules appear in priority
 * order (must-have first).
 *
 * IDs beginning with the legacy strings (`lufs`, `true-peak`, `dc-offset`,
 * `clipping`) MUST stay stable — the v3.26 checklist-promotion flow and its
 * Playwright spec reach them by testid.
 */
export const MASTERING_CHECKLIST_RULES: ReadonlyArray<MasteringChecklistRule> = [
  // Loudness
  { id: 'lufs', label: 'LUFS', category: 'Loudness', evaluate: evaluateLufs },
  { id: 'loudness-range', label: 'Loudness Range', category: 'Loudness', evaluate: evaluateLoudnessRange },
  { id: 'short-term-gap', label: 'Short-term vs Integrated', category: 'Loudness', evaluate: evaluateShortTermGap },
  { id: 'momentary-peak', label: 'Momentary Peak', category: 'Loudness', evaluate: evaluateMomentaryPeak },

  // Peaks
  { id: 'true-peak', label: 'True Peak', category: 'Peaks', evaluate: evaluateTruePeak },
  { id: 'clipping', label: 'Clipping', category: 'Peaks', evaluate: evaluateClipping },
  { id: 'isp-risk', label: 'Inter-sample Risk', category: 'Peaks', evaluate: evaluateIspRisk },

  // Dynamics
  { id: 'crest-factor', label: 'Crest Factor / PLR', category: 'Dynamics', evaluate: evaluateCrestFactor },
  { id: 'over-limiting', label: 'Over-limiting Duration', category: 'Dynamics', evaluate: evaluateOverLimiting },

  // Spectrum
  { id: 'spectral-bass', label: 'Bass Balance', category: 'Spectrum', evaluate: evaluateSpectralBass },
  { id: 'spectral-treble', label: 'Treble Balance', category: 'Spectrum', evaluate: evaluateSpectralTreble },

  // Housekeeping
  { id: 'dc-offset', label: 'DC Offset', category: 'Housekeeping', evaluate: evaluateDcOffset },
  { id: 'silence-trim', label: 'Silence Trim', category: 'Housekeeping', evaluate: evaluateSilenceTrim },
  { id: 'sample-rate', label: 'Sample Rate', category: 'Housekeeping', evaluate: evaluateSampleRate },
  { id: 'noise-floor', label: 'Noise Floor', category: 'Housekeeping', evaluate: evaluateNoiseFloor },
  { id: 'truncated-tail', label: 'Truncated Tail', category: 'Housekeeping', evaluate: evaluateTruncatedTail },
];

/**
 * Group rules by category while preserving the original rule order within
 * each category. Returns an empty array for any category with no rules (so
 * callers can render an empty-group placeholder if they choose).
 */
export function groupMasteringChecklistRules(
  rules: ReadonlyArray<MasteringChecklistRule> = MASTERING_CHECKLIST_RULES,
): ReadonlyArray<{ category: MasteringChecklistCategory; rules: ReadonlyArray<MasteringChecklistRule> }> {
  return MASTERING_CHECKLIST_CATEGORY_ORDER.map((category) => ({
    category,
    rules: rules.filter((rule) => rule.category === category),
  }));
}

/**
 * Get a rule by id (returns `undefined` if not found). Used by the
 * promotion flow so the `+ Add to checklist` button can look up the row
 * that was clicked.
 */
export function getMasteringChecklistRuleById(
  id: string,
  rules: ReadonlyArray<MasteringChecklistRule> = MASTERING_CHECKLIST_RULES,
): MasteringChecklistRule | undefined {
  return rules.find((rule) => rule.id === id);
}

/**
 * Status glyph for a row. Exported so the renderer and the tests share the
 * same source of truth.
 *
 * v3.28 fix: the legacy code rendered the warning triangle for fail rows
 * too. We now use a distinct `✗` for fail and a neutral `–` for
 * unavailable, so a missing ffmpeg measurement no longer silently reads as
 * "pass" or "fail".
 */
export function masteringChecklistStatusIcon(status: MasteringChecklistStatus): string {
  switch (status) {
    case 'pass':
      return '\u2713'; // ✓
    case 'warn':
      return '\u26a0'; // ⚠
    case 'fail':
      return '\u2717'; // ✗
    case 'unavailable':
    default:
      return '\u2013'; // –
  }
}
