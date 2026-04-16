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

Cross-track / album comparisons:
- analysis-context.masteringCache.tracks already contains every song in the current album (songTitle, fileName, filePath, cacheStatus, staticAnalysis, platformNormalization). Use those values directly for "compare to the other songs", "how does this fit the album?", "is my loudness consistent?", and similar questions.
- DO NOT use Read, Bash, or any file-system tool to open the audio files at masteringCache.tracks[*].filePath. You cannot decode audio from the CLI, the numbers you would extract that way are already in staticAnalysis, and reading those file paths can trigger macOS permission prompts (network/removable/iCloud volumes) that interrupt the user.
- If a track's cacheStatus is "missing", "stale", "pending", or "error" instead of "fresh", say so and ask the user to open that song in the app so it gets analyzed — do not try to analyze it yourself.
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
