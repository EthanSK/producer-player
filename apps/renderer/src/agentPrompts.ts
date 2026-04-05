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
- Unless the user is clearly asking for product/debugging work, stay grounded in mastering and Producer Player tasks.`;

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
  referenceFileName?: string;
  referenceTonalBalance?: { low: number; mid: number; high: number };
}

/**
 * Build a structured prompt that asks the AI agent for EQ recommendations
 * in a parseable JSON format, using the supplied mastering stats as context.
 */
export function buildAiEqRecommendationPrompt(stats: AiEqPromptStats): string {
  const parts: string[] = [
    'Analyze this track and recommend a mastering EQ curve.',
    'Consider the current LUFS, true peak, tonal balance, crest factor, dynamic range, and any reference track comparison.',
  ];

  if (stats.tonalBalance) {
    parts.push(
      `Current tonal balance: low=${(stats.tonalBalance.low * 100).toFixed(1)}%, mid=${(stats.tonalBalance.mid * 100).toFixed(1)}%, high=${(stats.tonalBalance.high * 100).toFixed(1)}%.`
    );
  }
  if (stats.crestFactorDb != null && stats.rmsDbfs != null) {
    parts.push(`Crest factor: ${stats.crestFactorDb.toFixed(1)} dB, RMS: ${stats.rmsDbfs.toFixed(1)} dBFS.`);
  }
  if (stats.integratedLufs != null) {
    parts.push(
      `Integrated LUFS: ${stats.integratedLufs.toFixed(1)}, True Peak: ${stats.truePeakDbfs?.toFixed(1) ?? 'N/A'} dBTP, LRA: ${stats.loudnessRangeLufs?.toFixed(1) ?? 'N/A'} LU.`
    );
  }
  if (stats.referenceFileName && stats.referenceTonalBalance) {
    const rt = stats.referenceTonalBalance;
    parts.push(
      `Reference track "${stats.referenceFileName}" tonal balance: low=${(rt.low * 100).toFixed(1)}%, mid=${(rt.mid * 100).toFixed(1)}%, high=${(rt.high * 100).toFixed(1)}%.`
    );
  }

  parts.push(
    '',
    'Respond with your analysis and a JSON block in this exact format:',
    '```json',
    '{"eq_recommendation": {"bands": [{"name": "Sub", "gain": 0}, {"name": "Low", "gain": 0}, {"name": "Low-Mid", "gain": 0}, {"name": "Mid", "gain": 0}, {"name": "High-Mid", "gain": 0}, {"name": "High", "gain": 0}], "reasoning": "Brief explanation"}}',
    '```',
    'Each gain is in dB (range -12 to +12). The 6 bands are: Sub (20-120 Hz), Low (120-500 Hz), Low-Mid (500-2000 Hz), Mid (2000-6000 Hz), High-Mid (6000-12000 Hz), High (12000-20000 Hz).',
    'Be specific and practical. Base recommendations on the analysis data provided.',
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
