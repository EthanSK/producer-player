import type { AgentUiContext } from '@producer-player/contracts';

export const AGENT_SYSTEM_PROMPT_STORAGE_KEY = 'producer-player.agent-system-prompt';

const AGENT_DOM_SNAPSHOT_MAX_CHARS = 75_000;

export const DEFAULT_AGENT_SYSTEM_PROMPT = `You are Producer Player's full-access mastering agent.

Core role:
- You are an expert mastering engineer for modern recorded music.
- Give direct, technically grounded advice about loudness, dynamics, tonal balance, stereo image, clipping, translation, and platform readiness.
- Respect artistic intent, but be blunt about technical problems.

Environment + permissions:
- Treat this session as full-permission by default.
- You may inspect the local Producer Player source tree and related project files when the underlying CLI supports it.
- A live UI context payload may be provided on each turn, including the current app URL, document title, and a DOM snapshot of the current window.
- You may propose and write JavaScript that would inspect or mutate app state arbitrarily when that helps accomplish the task.
- If a requested DOM or state mutation is not directly executable through the current host wiring, say that plainly and provide the exact JavaScript or source-code change you would apply.

Public tutorial context (source-first):
- Use Producer Player's public repo/docs as a tutorial source when users ask "how do I use X?" or ask for walkthroughs.
- Source anchors:
  - https://github.com/EthanSK/producer-player
  - https://github.com/EthanSK/producer-player/blob/main/README.md
  - https://ethansk.github.io/producer-player/
- Combine those public docs with the live UI context and local source tree before answering.
- Prefer step-by-step, in-app tutorials with concrete controls, labels, and expected outcomes.

Behavior:
- Use the supplied analysis context and UI context before guessing.
- If analysis-context.masteringCache is present and you rely on it, explicitly say that you are using cached mastering data and name the track(s).
- When discussing UI or implementation issues, reason from the DOM snapshot and the available source code.
- Prefer concrete fixes, patches, selectors, state updates, and parameter ranges over vague advice.
- Unless the user is clearly asking for product/debugging work, stay grounded in mastering and Producer Player tasks.

Cross-track / album / version comparisons:
- analysis-context.masteringCache.tracks contains EVERY VERSION of EVERY SONG in the current album — one entry per version (songId, songTitle, versionId, fileName, filePath, cacheStatus, analyzedAt, staticAnalysis, platformNormalization, isActiveVersion). Group entries by songId to reason about "song X" as a whole, and within a group compare versionId/fileName ordering to reason about V5-vs-V7-style version drift. \`isActiveVersion: true\` marks the version that is currently selected in the UI for that song.
- Use those values directly for "compare to the other songs", "compare V5 to V7 of song X", "how does this fit the album?", "is my loudness consistent across versions?", and similar questions. You can answer ANY question that depends on enumerating songs OR versions from this array alone — no UI clicks needed.
- DO NOT use Read, Bash, or any file-system tool to open the audio files at masteringCache.tracks[*].filePath. You cannot decode audio from the CLI, the numbers you would extract that way are already in staticAnalysis, and reading those file paths can trigger macOS permission prompts (network/removable/iCloud volumes) that interrupt the user.
- If a track's cacheStatus is "missing", "stale", "pending", or "error" instead of "fresh", say so and ask the user to open that song/version in the app so it gets analyzed — do not try to analyze it yourself.
- File-system tools (Read/Bash/etc.) are still fair game for the Producer Player source tree when the user asks app/debugging questions; just keep them off the user's audio files.`;

export function readStoredAgentSystemPrompt(): string {
  const stored = localStorage.getItem(AGENT_SYSTEM_PROMPT_STORAGE_KEY)?.trim();
  return stored && stored.length > 0 ? stored : DEFAULT_AGENT_SYSTEM_PROMPT;
}

export interface AiEqPromptStats {
  tonalBalance?: { low: number; mid: number; high: number };
  crestFactorDb?: number;
  rmsDbfs?: number;
  integratedLufs?: number | null;
  truePeakDbfs?: number | null;
  loudnessRangeLufs?: number | null;
  peakDbfs?: number;
  dcOffset?: number;
  clipCount?: number;
  meanVolumeDbfs?: number | null;
  maxMomentaryLufs?: number | null;
  maxShortTermLufs?: number | null;
  samplePeakDbfs?: number | null;
  sampleRateHz?: number | null;
  referenceFileName?: string;
  referenceTonalBalance?: { low: number; mid: number; high: number };
  referenceIntegratedLufs?: number | null;
  referenceTruePeakDbfs?: number | null;
  referenceLoudnessRangeLufs?: number | null;
  referenceCrestFactorDb?: number;
  referenceRmsDbfs?: number;
  /** Other tracks' tonal balance for album consistency context. */
  otherTracksTonalBalance?: ReadonlyArray<{ name: string; low: number; mid: number; high: number }>;
  /** Current EQ slider positions so the AI knows what has already been adjusted. */
  currentEqGains?: readonly number[];
  eqEnabled?: boolean;
  /** Mid/side listening mode. */
  midSideMode?: 'stereo' | 'mid' | 'side';
}

/**
 * Build a structured prompt that asks the AI agent for EQ recommendations
 * in a parseable JSON format, using the supplied mastering stats as context.
 */
export function buildAiEqRecommendationPrompt(stats: AiEqPromptStats): string {
  const parts: string[] = [
    'Analyze this track and recommend a mastering EQ curve.',
    'Consider ALL of the following analysis data when making your recommendation.',
  ];

  // Tonal balance
  if (stats.tonalBalance) {
    parts.push(
      `Current tonal balance: low=${(stats.tonalBalance.low * 100).toFixed(1)}%, mid=${(stats.tonalBalance.mid * 100).toFixed(1)}%, high=${(stats.tonalBalance.high * 100).toFixed(1)}%.`
    );
  }

  // Dynamics and levels
  if (stats.crestFactorDb != null && stats.rmsDbfs != null) {
    parts.push(`Crest factor: ${stats.crestFactorDb.toFixed(1)} dB, RMS: ${stats.rmsDbfs.toFixed(1)} dBFS.`);
  }

  // Full loudness stats
  if (stats.integratedLufs != null) {
    parts.push(
      `Integrated LUFS: ${stats.integratedLufs.toFixed(1)}, True Peak: ${stats.truePeakDbfs?.toFixed(1) ?? 'N/A'} dBTP, LRA: ${stats.loudnessRangeLufs?.toFixed(1) ?? 'N/A'} LU.`
    );
  }
  if (stats.meanVolumeDbfs != null) {
    parts.push(`Mean volume: ${stats.meanVolumeDbfs.toFixed(1)} dBFS.`);
  }
  if (stats.maxMomentaryLufs != null) {
    parts.push(`Max momentary LUFS: ${stats.maxMomentaryLufs.toFixed(1)}.`);
  }
  if (stats.maxShortTermLufs != null) {
    parts.push(`Max short-term LUFS: ${stats.maxShortTermLufs.toFixed(1)}.`);
  }
  if (stats.samplePeakDbfs != null) {
    parts.push(`Sample peak: ${stats.samplePeakDbfs.toFixed(1)} dBFS.`);
  }
  if (stats.peakDbfs != null) {
    parts.push(`Web Audio peak: ${stats.peakDbfs.toFixed(1)} dBFS.`);
  }

  // Clip and DC offset info
  if (stats.clipCount != null && stats.clipCount > 0) {
    parts.push(`Clip count: ${stats.clipCount} clipped samples detected.`);
  }
  if (stats.dcOffset != null && Math.abs(stats.dcOffset) > 0.0001) {
    parts.push(`DC offset: ${stats.dcOffset.toFixed(4)} (non-zero DC offset present).`);
  }

  // Sample rate
  if (stats.sampleRateHz != null) {
    parts.push(`Sample rate: ${stats.sampleRateHz} Hz.`);
  }

  // Reference track analysis (full)
  if (stats.referenceFileName) {
    const refParts: string[] = [`Reference track: "${stats.referenceFileName}".`];
    if (stats.referenceTonalBalance) {
      const rt = stats.referenceTonalBalance;
      refParts.push(
        `Reference tonal balance: low=${(rt.low * 100).toFixed(1)}%, mid=${(rt.mid * 100).toFixed(1)}%, high=${(rt.high * 100).toFixed(1)}%.`
      );
    }
    if (stats.referenceIntegratedLufs != null) {
      refParts.push(`Reference integrated LUFS: ${stats.referenceIntegratedLufs.toFixed(1)}.`);
    }
    if (stats.referenceTruePeakDbfs != null) {
      refParts.push(`Reference true peak: ${stats.referenceTruePeakDbfs.toFixed(1)} dBTP.`);
    }
    if (stats.referenceLoudnessRangeLufs != null) {
      refParts.push(`Reference LRA: ${stats.referenceLoudnessRangeLufs.toFixed(1)} LU.`);
    }
    if (stats.referenceCrestFactorDb != null && stats.referenceRmsDbfs != null) {
      refParts.push(`Reference crest factor: ${stats.referenceCrestFactorDb.toFixed(1)} dB, RMS: ${stats.referenceRmsDbfs.toFixed(1)} dBFS.`);
    }
    parts.push(refParts.join(' '));
  }

  // Other tracks for album consistency
  if (stats.otherTracksTonalBalance && stats.otherTracksTonalBalance.length > 0) {
    parts.push('Other tracks in the album (for consistency context):');
    for (const t of stats.otherTracksTonalBalance) {
      parts.push(
        `  - "${t.name}": low=${(t.low * 100).toFixed(1)}%, mid=${(t.mid * 100).toFixed(1)}%, high=${(t.high * 100).toFixed(1)}%`
      );
    }
  }

  // Current EQ state
  if (stats.currentEqGains && stats.currentEqGains.length >= 6) {
    const bandNames = ['Sub', 'Low', 'Low-Mid', 'Mid', 'High-Mid', 'High'];
    const eqDesc = bandNames
      .map((name, i) => `${name}: ${stats.currentEqGains![i] > 0 ? '+' : ''}${stats.currentEqGains![i].toFixed(1)} dB`)
      .join(', ');
    parts.push(
      `Current EQ settings (${stats.eqEnabled ? 'enabled' : 'bypassed'}): ${eqDesc}.`
    );
  }

  // Mid/side mode
  if (stats.midSideMode && stats.midSideMode !== 'stereo') {
    parts.push(`Currently monitoring in ${stats.midSideMode} mode.`);
  }

  parts.push(
    '',
    'Respond with your analysis and a JSON block in this exact format:',
    '```json',
    '{"eq_recommendation": {"bands": [{"name": "Sub", "gain": 0}, {"name": "Low", "gain": 0}, {"name": "Low-Mid", "gain": 0}, {"name": "Mid", "gain": 0}, {"name": "High-Mid", "gain": 0}, {"name": "High", "gain": 0}], "reasoning": "Brief explanation"}}',
    '```',
    'Each gain is in dB (range -12 to +12). The 6 bands are: Sub (20-120 Hz), Low (120-500 Hz), Low-Mid (500-2000 Hz), Mid (2000-6000 Hz), High-Mid (6000-12000 Hz), High (12000-20000 Hz).',
    'Be specific and practical. Base recommendations on ALL the analysis data provided. If a reference track is loaded, prioritize matching its tonal character. If other album tracks are provided, consider album consistency.',
  );

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// v3.33 Phase 4 — Mastering recommendations (agent-driven) prompt + parser.
// ---------------------------------------------------------------------------

/**
 * Per-rule mastering-checklist finding rendered into the prompt so the agent
 * can reference the pass/warn/fail verdicts while reasoning about targets.
 */
export interface MasteringRecommendationChecklistFinding {
  id: string;
  label: string;
  status: string;
  value: string;
  message: string;
}

/**
 * Inputs to `buildMasteringRecommendationsPrompt`.
 *
 * All fields are optional because real-world tracks sometimes have
 * incomplete analysis (e.g. a bad file or a decode error on a single field).
 * The prompt builder silently skips missing rows so the agent never sees
 * placeholder "N/A" lines that could be hallucinated as real values.
 */
export interface MasteringRecommendationsPromptInput {
  trackName?: string;
  analysis?: {
    integratedLufs?: number | null;
    truePeakDbfs?: number | null;
    samplePeakDbfs?: number | null;
    loudnessRangeLufs?: number | null;
    crestFactorDb?: number | null;
    dcOffset?: number | null;
    clipCount?: number | null;
    maxShortTermLufs?: number | null;
    maxMomentaryLufs?: number | null;
    meanVolumeDbfs?: number | null;
    peakDbfs?: number | null;
    tonalBalance?: { low: number; mid: number; high: number } | null;
    sampleRateHz?: number | null;
  };
  checklistFindings?: ReadonlyArray<MasteringRecommendationChecklistFinding>;
  /** Metric IDs that the agent should return recommendations for. */
  metricIds: ReadonlyArray<string>;
  /** Optional list of spectrum EQ band metric IDs (e.g. spectrum_eq_band_0). */
  spectrumBandMetricIds?: ReadonlyArray<string>;
}

/**
 * Build the prompt we send to the agent for the "generate per-metric
 * mastering recommendations" request. The agent MUST respond with a JSON
 * block matching `MASTERING_RECOMMENDATIONS_RESPONSE_SCHEMA` so
 * `parseMasteringRecommendationsResponse` can parse it deterministically.
 *
 * Design intent: one prompt → one response → many per-metric `setAiRecommendation`
 * calls. This keeps the agent cost linear (single turn) and avoids N×
 * round-trips per track open.
 */
export function buildMasteringRecommendationsPrompt(
  input: MasteringRecommendationsPromptInput,
): string {
  const parts: string[] = [
    'You are helping a music producer master this track for modern streaming distribution.',
    'For each listed metric, recommend a TARGET value that would improve the master.',
    'Keep recommendations realistic: achievable by the producer adjusting their existing mix.',
    '',
  ];

  if (input.trackName) {
    parts.push(`Track: "${input.trackName}".`);
  }

  const a = input.analysis ?? {};
  const analysisLines: string[] = [];
  if (typeof a.integratedLufs === 'number') {
    analysisLines.push(`- Integrated LUFS: ${a.integratedLufs.toFixed(2)}`);
  }
  if (typeof a.truePeakDbfs === 'number') {
    analysisLines.push(`- True Peak: ${a.truePeakDbfs.toFixed(2)} dBTP`);
  }
  if (typeof a.samplePeakDbfs === 'number') {
    analysisLines.push(`- Sample Peak: ${a.samplePeakDbfs.toFixed(2)} dBFS`);
  }
  if (typeof a.loudnessRangeLufs === 'number') {
    analysisLines.push(`- Loudness Range (LRA): ${a.loudnessRangeLufs.toFixed(2)} LU`);
  }
  if (typeof a.crestFactorDb === 'number') {
    analysisLines.push(`- Crest Factor: ${a.crestFactorDb.toFixed(2)} dB`);
  }
  if (typeof a.dcOffset === 'number') {
    analysisLines.push(`- DC Offset: ${a.dcOffset.toFixed(4)}`);
  }
  if (typeof a.clipCount === 'number') {
    analysisLines.push(`- Clip Count: ${a.clipCount} samples`);
  }
  if (typeof a.maxShortTermLufs === 'number') {
    analysisLines.push(`- Max Short-Term LUFS: ${a.maxShortTermLufs.toFixed(2)}`);
  }
  if (typeof a.maxMomentaryLufs === 'number') {
    analysisLines.push(`- Max Momentary LUFS: ${a.maxMomentaryLufs.toFixed(2)}`);
  }
  if (typeof a.meanVolumeDbfs === 'number') {
    analysisLines.push(`- Mean Volume: ${a.meanVolumeDbfs.toFixed(2)} dBFS`);
  }
  if (typeof a.peakDbfs === 'number') {
    analysisLines.push(`- Web Audio Peak: ${a.peakDbfs.toFixed(2)} dBFS`);
  }
  if (a.tonalBalance) {
    analysisLines.push(
      `- Spectral Balance: low=${(a.tonalBalance.low * 100).toFixed(1)}%, mid=${(a.tonalBalance.mid * 100).toFixed(1)}%, high=${(a.tonalBalance.high * 100).toFixed(1)}%`,
    );
  }
  if (typeof a.sampleRateHz === 'number') {
    analysisLines.push(`- Sample Rate: ${a.sampleRateHz} Hz`);
  }

  if (analysisLines.length > 0) {
    parts.push('Current analysis:', ...analysisLines, '');
  }

  if (input.checklistFindings && input.checklistFindings.length > 0) {
    parts.push('Mastering Checklist findings:');
    for (const f of input.checklistFindings) {
      parts.push(`- ${f.label} (${f.id}): ${f.status} at "${f.value}" — ${f.message}`);
    }
    parts.push('');
  }

  parts.push(
    'Return your answer as a JSON block inside ```json ... ``` fences matching this exact schema:',
    '```json',
    '{',
    '  "recommendations": {',
    '    "<metricId>": {',
    '      "recommendedValue": "string, formatted for display (include units)",',
    '      "recommendedRawValue": 0,',
    '      "reason": "1-2 sentence justification"',
    '    }',
    '  }',
    '}',
    '```',
    '- `recommendedValue` is the formatted string the UI will show (e.g. "-14.0 LUFS", "-1.0 dBTP", "reduce 1.5 dB on sub").',
    '- `recommendedRawValue` is OPTIONAL but strongly preferred when the metric is a single number. Use the same numeric unit as the analysis line above.',
    '- `reason` is 1-2 plain-english sentences, shown in the hover tooltip. No markdown.',
    '',
    `Include an entry for EVERY metric ID in this list: ${input.metricIds.join(', ')}.`,
  );

  if (input.spectrumBandMetricIds && input.spectrumBandMetricIds.length > 0) {
    parts.push(
      `Also include entries for these spectrum EQ band metric IDs (each a gain in dB, range -12 to +12): ${input.spectrumBandMetricIds.join(', ')}.`,
    );
  }

  parts.push(
    'Do not wrap the JSON in prose that would break the fence. Do not invent metric IDs not in the list above.',
  );

  return parts.join('\n');
}

/**
 * Parsed shape of one metric's entry in the agent response.
 */
export interface ParsedMasteringRecommendation {
  recommendedValue: string;
  recommendedRawValue?: number;
  reason: string;
}

function firstStringField(
  input: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function firstNumberField(
  input: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function normalizeRecommendationEntries(
  parsed: unknown,
): Array<[string, Record<string, unknown>]> {
  if (!parsed || typeof parsed !== 'object') return [];
  const parsedRecord = parsed as Record<string, unknown>;
  const rawRecs =
    parsedRecord.recommendations ??
    parsedRecord.masteringRecommendations ??
    parsedRecord.mastering_recommendations ??
    parsedRecord.results;

  if (rawRecs && typeof rawRecs === 'object' && !Array.isArray(rawRecs)) {
    return Object.entries(rawRecs as Record<string, unknown>).flatMap(
      ([metricId, entry]) =>
        metricId && entry && typeof entry === 'object' && !Array.isArray(entry)
          ? [[metricId, entry as Record<string, unknown>]]
          : [],
    );
  }

  if (Array.isArray(rawRecs)) {
    return rawRecs.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const entryRecord = entry as Record<string, unknown>;
      const metricId = firstStringField(entryRecord, [
        'metricId',
        'metric_id',
        'metric',
        'id',
        'key',
      ]);
      return metricId ? [[metricId, entryRecord]] : [];
    });
  }

  // Some models ignore the wrapper and return a top-level metric map:
  // { "integrated_lufs": { "recommended_value": "-14 LUFS", ... } }.
  return Object.entries(parsedRecord).flatMap(([metricId, entry]) =>
    metricId && entry && typeof entry === 'object' && !Array.isArray(entry)
      ? [[metricId, entry as Record<string, unknown>]]
      : [],
  );
}

/**
 * Extract the `{ "recommendations": { ... } }` JSON block from the agent's
 * accumulated text delta stream. Returns `null` if no valid JSON block was
 * found or the parsed shape is wrong.
 *
 * Tolerates:
 * - Prose before/after the fence.
 * - Missing code-fence language tag (```json vs bare ```).
 * - Bare JSON with no fence (agent ignores the instruction).
 */
export function parseMasteringRecommendationsResponse(
  text: string,
): Record<string, ParsedMasteringRecommendation> | null {
  if (!text || text.length === 0) return null;

  const candidates: string[] = [];

  // 1. ```json ... ``` fenced block.
  const fencedMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fencedMatch?.[1]) candidates.push(fencedMatch[1]);

  // 2. Bare {"recommendations": ...} JSON object at top level. A lazy
  //    regex like `\{[\s\S]*?\}\s*\}` only captures up to the first nested
  //    `}}` pair and truncates responses with multiple metric entries —
  //    Codex review P2, 2026-04-18. Use a tiny brace-balance scanner
  //    starting at the `"recommendations"` key's enclosing `{` so the
  //    candidate string covers the full object, string escapes and all.
  const recsStart = text.indexOf('"recommendations"');
  if (recsStart !== -1) {
    // Walk backward to the nearest `{` — that is the outer object.
    let openIdx = -1;
    for (let i = recsStart; i >= 0; i -= 1) {
      if (text[i] === '{') {
        openIdx = i;
        break;
      }
    }
    if (openIdx !== -1) {
      let depth = 0;
      let inString = false;
      let escapeNext = false;
      let closeIdx = -1;
      for (let i = openIdx; i < text.length; i += 1) {
        const ch = text[i];
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (inString) {
          if (ch === '\\') {
            escapeNext = true;
            continue;
          }
          if (ch === '"') {
            inString = false;
          }
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            closeIdx = i;
            break;
          }
        }
      }
      if (closeIdx !== -1) {
        candidates.push(text.slice(openIdx, closeIdx + 1));
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const out: Record<string, ParsedMasteringRecommendation> = {};
      for (const [metricId, e] of normalizeRecommendationEntries(parsed)) {
        const recommendedValue = firstStringField(e, [
          'recommendedValue',
          'recommended_value',
          'targetValue',
          'target_value',
          'suggestedValue',
          'suggested_value',
          'value',
          'recommendation',
        ]);
        const reason =
          firstStringField(e, ['reason', 'rationale', 'explanation', 'justification']) ?? '';
        if (!recommendedValue) continue;
        const parsedEntry: ParsedMasteringRecommendation = {
          recommendedValue,
          reason,
        };
        const recommendedRawValue = firstNumberField(e, [
          'recommendedRawValue',
          'recommended_raw_value',
          'rawValue',
          'raw_value',
          'targetRawValue',
          'target_raw_value',
          'numericValue',
          'numeric_value',
        ]);
        if (recommendedRawValue !== undefined) {
          parsedEntry.recommendedRawValue = recommendedRawValue;
        }
        out[metricId] = parsedEntry;
      }
      if (Object.keys(out).length > 0) return out;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

/**
 * Compute a short, deterministic fingerprint of the mastering analysis inputs
 * that back a recommendation run. Stored as `analysisVersion` on each rec;
 * when the fingerprint diverges the UI + `markAiRecommendationsStale` can
 * flip existing recs to `'stale'` so the user knows they no longer reflect
 * the current measurement.
 *
 * Lightweight string join — avoids pulling in a hash lib and makes diffs
 * trivially debuggable when recs mysteriously stale out.
 */
export function computeMasteringAnalysisVersion(input: {
  integratedLufs?: number | null;
  truePeakDbfs?: number | null;
  loudnessRangeLufs?: number | null;
  crestFactorDb?: number | null;
  peakDbfs?: number | null;
  tonalBalance?: { low: number; mid: number; high: number } | null;
  sampleRateHz?: number | null;
}): string {
  const rounded = (value: number | null | undefined, digits = 2): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
    return value.toFixed(digits);
  };
  const tb = input.tonalBalance;
  return [
    rounded(input.integratedLufs),
    rounded(input.truePeakDbfs),
    rounded(input.loudnessRangeLufs),
    rounded(input.crestFactorDb),
    rounded(input.peakDbfs),
    tb ? `${rounded(tb.low, 3)}|${rounded(tb.mid, 3)}|${rounded(tb.high, 3)}` : 'n/a',
    rounded(input.sampleRateHz, 0),
  ].join('::');
}

export function captureAgentUiContext(): AgentUiContext {
  const rawDomSnapshot = document.documentElement?.outerHTML ?? '';
  const domSnapshot =
    rawDomSnapshot.length > AGENT_DOM_SNAPSHOT_MAX_CHARS
      ? `${rawDomSnapshot.slice(0, AGENT_DOM_SNAPSHOT_MAX_CHARS)}\n<!-- DOM snapshot truncated after ${AGENT_DOM_SNAPSHOT_MAX_CHARS} characters -->`
      : rawDomSnapshot;

  return {
    documentTitle: document.title || null,
    locationHref: window.location.href || null,
    domSnapshot: domSnapshot || null,
  };
}
