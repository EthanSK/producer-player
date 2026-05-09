export const IDEAL_CURVE_POINT_COUNT = 256;
export const IDEAL_CURVE_MIN_FREQ = 20;
export const IDEAL_CURVE_MAX_FREQ = 20000;

export interface IdealCurvePoint {
  freq: number;
  gainDb: number;
}

export interface IdealCurveAnchor {
  freq: number;
  gainDb: number;
}

export const IDEAL_STEM_IDS = ['vocals', 'drums', 'bass', 'other'] as const;
export type IdealStemId = (typeof IDEAL_STEM_IDS)[number];

export interface IdealStemGuide {
  id: IdealStemId;
  label: string;
  shortLabel: string;
  accentColor: string;
  role: string;
  summary: string;
  explanation: string;
  listeningNotes: readonly string[];
  productionNote: string;
  anchors: readonly IdealCurveAnchor[];
}

const IDEAL_STEM_GUIDE_LIST: readonly IdealStemGuide[] = [
  {
    id: 'vocals',
    label: 'Vocals',
    shortLabel: 'Vox',
    accentColor: '#ff7ab6',
    role: 'Lead clarity and lyric intelligibility',
    summary: 'Controlled lows, steady mid presence, and a clear 2–6 kHz articulation lift.',
    explanation:
      'A helpful vocal reference curve usually removes rumble before the fundamental range, keeps body through the low mids, and rises gently through presence so words stay intelligible without brittle air.',
    listeningNotes: [
      'High-pass below the useful body so plosives and room rumble do not fight the bass.',
      'Keep 200–600 Hz even; too much creates mud, too little makes the vocal feel hollow.',
      'Use the 2–6 kHz lift as a clue for intelligibility, not a command to over-brighten every singer.',
    ],
    productionNote:
      'Treat this as a translation baseline, not a published scientific target. The right vocal curve still depends on singer tone, mic choice, arrangement density, genre, and how the vocal sits against the reference track.',
    anchors: [
      { freq: 20, gainDb: -18 },
      { freq: 60, gainDb: -10 },
      { freq: 120, gainDb: -4 },
      { freq: 240, gainDb: -1.5 },
      { freq: 500, gainDb: 0 },
      { freq: 1000, gainDb: 0.8 },
      { freq: 3000, gainDb: 3.2 },
      { freq: 6500, gainDb: 2.2 },
      { freq: 12000, gainDb: 1 },
      { freq: 20000, gainDb: -1.5 },
    ],
  },
  {
    id: 'drums',
    label: 'Drums',
    shortLabel: 'Drums',
    accentColor: '#ffd166',
    role: 'Punch, transient snap, and controlled cymbal energy',
    summary: 'Kick weight in the lows, less boxy low-mid build-up, and crisp transient presence.',
    explanation:
      'A useful drum-stem target keeps kick/sub energy strong, dips the cardboard zone around the low mids, and gives snares/cymbals enough upper-mid and high presence to cut without sandpaper harshness.',
    listeningNotes: [
      'Watch the 50–100 Hz area for kick authority, especially if the bass stem also occupies it.',
      'A restrained 250–600 Hz area leaves room for vocals and bass harmonics.',
      'Presence above 3 kHz should feel like snap and air; if it feels splashy, compare against the reference layer later.',
    ],
    productionNote:
      'Use this to judge punch versus clutter in context. Real drum balances vary heavily with acoustic kits, programmed drums, sample choice, room tone, parallel compression, and the kick/bass relationship.',
    anchors: [
      { freq: 20, gainDb: -7 },
      { freq: 50, gainDb: 2.8 },
      { freq: 90, gainDb: 2.2 },
      { freq: 180, gainDb: 0.2 },
      { freq: 360, gainDb: -2.6 },
      { freq: 800, gainDb: -1.2 },
      { freq: 2200, gainDb: 0.8 },
      { freq: 5000, gainDb: 2.8 },
      { freq: 10000, gainDb: 1.5 },
      { freq: 20000, gainDb: -1.5 },
    ],
  },
  {
    id: 'bass',
    label: 'Bass',
    shortLabel: 'Bass',
    accentColor: '#5eead4',
    role: 'Low-end weight and stable translation',
    summary: 'Strong fundamentals, controlled low mids, and a deliberate roll-off above harmonic detail.',
    explanation:
      'A bass-stem target should show where the song’s foundation lives while leaving headroom for kick and vocal. The exact peak depends on the part, but the curve should usually become less dominant as it moves into the midrange.',
    listeningNotes: [
      'The 40–120 Hz plateau is the foundation; judge it with the kick, not in isolation.',
      'Too much 180–400 Hz can mask warmth as mud once the full mix returns.',
      'Some basses need 700 Hz–2 kHz definition, but the curve treats that as harmonic detail rather than the main energy center.',
    ],
    productionNote:
      'Check this against the kick and the full master before changing EQ. Bass curves are especially room- and genre-dependent, so the goal is stable translation rather than matching the line exactly.',
    anchors: [
      { freq: 20, gainDb: -7.5 },
      { freq: 38, gainDb: 1.2 },
      { freq: 70, gainDb: 4.2 },
      { freq: 115, gainDb: 3.2 },
      { freq: 220, gainDb: 0.4 },
      { freq: 450, gainDb: -2.5 },
      { freq: 900, gainDb: -4.5 },
      { freq: 2200, gainDb: -5.6 },
      { freq: 8000, gainDb: -8 },
      { freq: 20000, gainDb: -12 },
    ],
  },
  {
    id: 'other',
    label: 'Other / Music',
    shortLabel: 'Other',
    accentColor: '#b46eff',
    role: 'Harmonic bed, instruments, FX, and arrangement glue',
    summary: 'Broadly balanced, slightly mid-forward, with lows trimmed to leave room for bass and kick.',
    explanation:
      'The “other” stem is intentionally broad: keys, guitars, pads, samples, FX, and everything not separated as vocal/drum/bass. The curve is a teaching baseline for balance, not a rigid target.',
    listeningNotes: [
      'Leave sub-bass space for bass and drums unless the arrangement depends on wide synth lows.',
      'Use the midrange to check musical identity: chords, hooks, and texture should remain readable.',
      'Highs should support depth and excitement without competing with vocal consonants or cymbals.',
    ],
    productionNote:
      'Because this bucket combines instruments and FX, expect more variation than the focused stems. Use it to spot masking and missing midrange identity, then confirm the decision in the full mix.',
    anchors: [
      { freq: 20, gainDb: -12 },
      { freq: 70, gainDb: -5 },
      { freq: 140, gainDb: -2.5 },
      { freq: 300, gainDb: -1 },
      { freq: 700, gainDb: 0.4 },
      { freq: 1600, gainDb: 1.1 },
      { freq: 4000, gainDb: 0.9 },
      { freq: 9000, gainDb: 0.2 },
      { freq: 14000, gainDb: -1.2 },
      { freq: 20000, gainDb: -3.5 },
    ],
  },
];

export const IDEAL_STEM_GUIDES: Record<IdealStemId, IdealStemGuide> =
  IDEAL_STEM_GUIDE_LIST.reduce((guides, guide) => {
    guides[guide.id] = guide;
    return guides;
  }, {} as Record<IdealStemId, IdealStemGuide>);

function interpolateLogFrequencyGain(
  freq: number,
  anchors: readonly IdealCurveAnchor[],
): number {
  if (anchors.length === 0) return 0;
  if (freq <= anchors[0].freq) return anchors[0].gainDb;

  const lastAnchor = anchors[anchors.length - 1];
  if (freq >= lastAnchor.freq) return lastAnchor.gainDb;

  const logFreq = Math.log10(freq);
  for (let i = 1; i < anchors.length; i++) {
    const previous = anchors[i - 1];
    const next = anchors[i];
    if (freq <= next.freq) {
      const logPrevious = Math.log10(previous.freq);
      const logNext = Math.log10(next.freq);
      const t = (logFreq - logPrevious) / (logNext - logPrevious);
      return previous.gainDb + (next.gainDb - previous.gainDb) * t;
    }
  }

  return lastAnchor.gainDb;
}

export function buildIdealStemCurve(
  stemId: IdealStemId,
  numPoints = IDEAL_CURVE_POINT_COUNT,
  minFreq = IDEAL_CURVE_MIN_FREQ,
  maxFreq = IDEAL_CURVE_MAX_FREQ,
): IdealCurvePoint[] {
  const guide = IDEAL_STEM_GUIDES[stemId];
  const points: IdealCurvePoint[] = [];
  const safePointCount = Math.max(1, Math.floor(numPoints));
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);

  for (let i = 0; i < safePointCount; i++) {
    const t = safePointCount === 1 ? 0 : i / (safePointCount - 1);
    const freq = Math.pow(10, logMin + t * (logMax - logMin));
    points.push({
      freq,
      gainDb: interpolateLogFrequencyGain(freq, guide.anchors),
    });
  }

  return points;
}

export function buildAllIdealStemCurves(
  numPoints = IDEAL_CURVE_POINT_COUNT,
): Record<IdealStemId, IdealCurvePoint[]> {
  return IDEAL_STEM_IDS.reduce((curves, stemId) => {
    curves[stemId] = buildIdealStemCurve(stemId, numPoints);
    return curves;
  }, {} as Record<IdealStemId, IdealCurvePoint[]>);
}
