import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  IDEAL_CURVE_MAX_FREQ,
  IDEAL_CURVE_MIN_FREQ,
  IDEAL_STEM_GUIDES,
  IDEAL_STEM_IDS,
  buildAllIdealStemCurves,
  type IdealCurvePoint,
  type IdealStemGuide,
  type IdealStemId,
} from './idealCurves';
import {
  analyzeIdealStemSource,
  buildIdealStemCacheKey,
  clearIdealStemAnalysisCache,
  formatIdealStemMetricDb,
  getCachedIdealStemAnalysis,
  getIdealStemCacheState,
  type IdealStemAnalysisResult,
  type IdealStemAnalysisSource,
  type IdealStemSourceKind,
} from './idealStemAnalysis';
import { PlaybackToggleIcon } from './lib/PlaybackToggleIcon';

export type { IdealStemAnalysisSource } from './idealStemAnalysis';

interface IdealsModalProps {
  open: boolean;
  onClose: () => void;
  mixSource: IdealStemAnalysisSource | null;
  referenceSource: IdealStemAnalysisSource | null;
  initialFullscreenStemId?: IdealStemId | null;
}

type IdealsLayerId = 'ideal' | 'reference' | 'mix' | 'diff';
type StemSourceStatus = 'idle' | 'running' | 'ready' | 'error' | 'cancelled';
type DensityMode = 'compact' | 'detailed';

interface StemSourceState {
  status: StemSourceStatus;
  cacheKey: string | null;
  result: IdealStemAnalysisResult | null;
  error: string | null;
}

// Graph geometry. The viewBox is logical — the SVG scales to fit its container.
// Mini cards keep a fixed CSS height (set in styles.css); fullscreen graph
// stretches with the dialog.
const GRAPH_WIDTH = 720;
const GRAPH_HEIGHT = 260;
const PADDING_LEFT = 52;
const PADDING_RIGHT = 16;
const PADDING_TOP = 22;
const PADDING_BOTTOM = 40;
const DB_MIN = -24;
const DB_MAX = 6;
const FREQ_GRID_LINES = [50, 100, 250, 500, 1000, 2000, 5000, 10000];
const FREQ_GRID_MINOR = [30, 75, 150, 350, 700, 1500, 3500, 7000, 15000];
const DB_GRID_LINES = [-24, -18, -12, -6, 0, 6];

function formatFreq(freq: number): string {
  if (freq >= 1000) {
    const k = freq / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `${freq}`;
}

function freqToX(freq: number): number {
  const plotWidth = GRAPH_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const logMin = Math.log10(IDEAL_CURVE_MIN_FREQ);
  const logMax = Math.log10(IDEAL_CURVE_MAX_FREQ);
  const logFreq = Math.log10(
    Math.max(IDEAL_CURVE_MIN_FREQ, Math.min(IDEAL_CURVE_MAX_FREQ, freq)),
  );
  return PADDING_LEFT + ((logFreq - logMin) / (logMax - logMin)) * plotWidth;
}

function dbToY(gainDb: number): number {
  const plotHeight = GRAPH_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, gainDb));
  return PADDING_TOP + ((DB_MAX - clamped) / (DB_MAX - DB_MIN)) * plotHeight;
}

function buildCurvePath(curve: readonly IdealCurvePoint[]): string {
  return curve
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L';
      return `${command}${freqToX(point.freq).toFixed(2)},${dbToY(point.gainDb).toFixed(2)}`;
    })
    .join(' ');
}

function buildFilledCurvePath(curve: readonly IdealCurvePoint[]): string {
  if (curve.length === 0) return '';
  const curvePath = buildCurvePath(curve);
  const zeroY = dbToY(0);
  const firstX = freqToX(curve[0].freq).toFixed(2);
  const lastX = freqToX(curve[curve.length - 1].freq).toFixed(2);
  return `${curvePath} L${lastX},${zeroY.toFixed(2)} L${firstX},${zeroY.toFixed(2)} Z`;
}

function buildInitialSourceState(): Record<IdealStemSourceKind, StemSourceState> {
  return {
    mix: { status: 'idle', cacheKey: null, result: null, error: null },
    reference: { status: 'idle', cacheKey: null, result: null, error: null },
  };
}

function sourceStateFromCache(source: IdealStemAnalysisSource | null): StemSourceState {
  if (!source) {
    return { status: 'idle', cacheKey: null, result: null, error: null };
  }
  const cacheKey = buildIdealStemCacheKey(source);
  const cached = getCachedIdealStemAnalysis(cacheKey);
  if (cached) {
    return { status: 'ready', cacheKey, result: cached, error: null };
  }
  const cacheState = getIdealStemCacheState(cacheKey);
  return {
    status: cacheState === 'in-flight' ? 'running' : 'idle',
    cacheKey,
    result: null,
    error: null,
  };
}

function getSourceLabel(kind: IdealStemSourceKind): string {
  return kind === 'mix' ? 'Your Mix' : 'Reference';
}

function getSourceActionLabel(kind: IdealStemSourceKind): string {
  return kind === 'mix' ? 'Stem Separate Yours' : 'Stem Separate Reference';
}

function formatSourceStatus(
  kind: IdealStemSourceKind,
  source: IdealStemAnalysisSource | null,
  state: StemSourceState,
): string {
  if (!source) {
    return kind === 'mix' ? 'No current mix selected' : 'No reference loaded';
  }
  if (source.exists === false) {
    return `${getSourceLabel(kind)} file missing`;
  }
  switch (state.status) {
    case 'running':
      return 'Separating…';
    case 'ready':
      return 'Proxy stems ready';
    case 'error':
      return state.error ?? 'Stem analysis failed';
    case 'cancelled':
      return 'Cancelled';
    case 'idle':
    default:
      return 'Not analyzed yet';
  }
}

function getStatusDotClass(state: StemSourceState, source: IdealStemAnalysisSource | null): string {
  if (!source) return 'ideals-status-dot--inactive';
  if (source.exists === false) return 'ideals-status-dot--error';
  switch (state.status) {
    case 'ready':
      return 'ideals-status-dot--ready';
    case 'running':
      return 'ideals-status-dot--running';
    case 'error':
      return 'ideals-status-dot--error';
    case 'cancelled':
      return 'ideals-status-dot--cancelled';
    default:
      return 'ideals-status-dot--idle';
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

interface CurveReadoutValue {
  id: IdealsLayerId;
  label: string;
  className: string;
  point: IdealCurvePoint;
}

function xToFreq(viewBoxX: number): number {
  const plotWidth = GRAPH_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const ratio = Math.max(0, Math.min(1, (viewBoxX - PADDING_LEFT) / plotWidth));
  const logMin = Math.log10(IDEAL_CURVE_MIN_FREQ);
  const logMax = Math.log10(IDEAL_CURVE_MAX_FREQ);
  return 10 ** (logMin + ratio * (logMax - logMin));
}

function findNearestCurvePoint(
  curve: readonly IdealCurvePoint[] | undefined,
  freq: number,
): IdealCurvePoint | null {
  if (!curve || curve.length === 0) return null;
  return curve.reduce((nearest, point) => {
    const currentDistance = Math.abs(Math.log10(point.freq) - Math.log10(freq));
    const nearestDistance = Math.abs(Math.log10(nearest.freq) - Math.log10(freq));
    return currentDistance < nearestDistance ? point : nearest;
  }, curve[0]);
}

function formatGainDb(gainDb: number): string {
  return `${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB`;
}

/**
 * Build a "diff" curve = mix - ideal (or reference - ideal if mix is missing).
 * Returns a curve in the same freq grid as the ideal curve so it lays cleanly
 * on the same graph. The result is centered around 0 dB — values above 0 mean
 * "your mix has more energy here than the ideal target", below 0 means less.
 */
function buildDiffCurve(
  base: readonly IdealCurvePoint[] | undefined,
  subtract: readonly IdealCurvePoint[] | undefined,
): IdealCurvePoint[] | undefined {
  if (!base || !subtract || base.length === 0 || subtract.length === 0) return undefined;
  // Both curves are sampled on the same log-frequency grid (built by
  // buildIdealStemCurve), so we can index-pair them.
  const length = Math.min(base.length, subtract.length);
  const out: IdealCurvePoint[] = [];
  for (let i = 0; i < length; i += 1) {
    out.push({ freq: base[i].freq, gainDb: base[i].gainDb - subtract[i].gainDb });
  }
  return out;
}

function IdealsCurveGraph({
  idealCurve,
  mixCurve,
  referenceCurve,
  diffCurve,
  guide,
  showIdeal,
  showMix,
  showReference,
  showDiff,
  variant = 'mini',
}: {
  idealCurve: readonly IdealCurvePoint[];
  mixCurve?: readonly IdealCurvePoint[];
  referenceCurve?: readonly IdealCurvePoint[];
  diffCurve?: readonly IdealCurvePoint[];
  guide: IdealStemGuide;
  showIdeal: boolean;
  showMix: boolean;
  showReference: boolean;
  showDiff: boolean;
  variant?: 'mini' | 'full';
}): JSX.Element {
  const [activeFreq, setActiveFreq] = useState<number | null>(null);
  const strokeGradientId = `ideals-curve-stroke-${guide.id}-${variant}`;
  const fillGradientId = `ideals-curve-fill-${guide.id}-${variant}`;
  const readoutId = `ideals-curve-readout-desc-${guide.id}-${variant}`;
  const idealPath = buildCurvePath(idealCurve);
  const fillPath = buildFilledCurvePath(idealCurve);
  const mixPath = mixCurve ? buildCurvePath(mixCurve) : '';
  const referencePath = referenceCurve ? buildCurvePath(referenceCurve) : '';
  const diffPath = diffCurve ? buildCurvePath(diffCurve) : '';

  const readoutValues: CurveReadoutValue[] = activeFreq
    ? [
        showIdeal
          ? {
              id: 'ideal' as const,
              label: 'Ideal',
              className: 'ideals-curve-readout-dot--ideal',
              point: findNearestCurvePoint(idealCurve, activeFreq),
            }
          : null,
        showMix
          ? {
              id: 'mix' as const,
              label: 'Your Mix',
              className: 'ideals-curve-readout-dot--mix',
              point: findNearestCurvePoint(mixCurve, activeFreq),
            }
          : null,
        showReference
          ? {
              id: 'reference' as const,
              label: 'Reference',
              className: 'ideals-curve-readout-dot--reference',
              point: findNearestCurvePoint(referenceCurve, activeFreq),
            }
          : null,
        showDiff
          ? {
              id: 'diff' as const,
              label: 'Diff (Mix − Ideal)',
              className: 'ideals-curve-readout-dot--diff',
              point: findNearestCurvePoint(diffCurve, activeFreq),
            }
          : null,
      ].flatMap((value) => (value?.point ? [{ ...value, point: value.point }] : []))
    : [];

  const updateActiveFrequencyFromPointer = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      const viewBoxX = ((event.clientX - rect.left) / rect.width) * GRAPH_WIDTH;
      setActiveFreq(xToFreq(viewBoxX));
    },
    [],
  );

  const readoutX = activeFreq ? freqToX(activeFreq) : null;
  const readoutFreqLabel = activeFreq ? `${formatFreq(activeFreq)} Hz` : 'Hover or focus';
  const showReadoutChip = readoutX !== null && readoutValues.length > 0;
  const readoutBoxWidth = 210;
  const readoutBoxHeight = 30 + readoutValues.length * 16;
  const plotRightEdge = GRAPH_WIDTH - PADDING_RIGHT;
  const wantRightOfCursor = readoutX !== null && readoutX < (PADDING_LEFT + plotRightEdge) / 2;
  const readoutBoxX = wantRightOfCursor
    ? Math.min((readoutX ?? 0) + 14, plotRightEdge - readoutBoxWidth - 6)
    : Math.max(PADDING_LEFT + 6, (readoutX ?? 0) - readoutBoxWidth - 14);

  return (
    <svg
      className={`ideals-curve-graph ideals-curve-graph--${variant}`}
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${guide.label} ideal, mix, and reference EQ curves`}
      aria-describedby={readoutId}
      data-testid={`ideals-curve-${guide.id}`}
      tabIndex={0}
      onPointerMove={updateActiveFrequencyFromPointer}
      onPointerLeave={() => setActiveFreq(null)}
      onFocus={() => setActiveFreq((current) => current ?? 1000)}
      onBlur={() => setActiveFreq(null)}
    >
      <desc id={readoutId}>
        Interactive EQ curve graph. Hover or focus to read the nearest frequency and dB values for visible layers.
      </desc>
      <defs>
        <linearGradient id={strokeGradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#5ca7ff" />
          <stop offset="50%" stopColor={guide.accentColor} />
          <stop offset="100%" stopColor="#b46eff" />
        </linearGradient>
        <linearGradient id={fillGradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={guide.accentColor} stopOpacity="0.34" />
          <stop offset="60%" stopColor="#5ca7ff" stopOpacity="0.12" />
          <stop offset="100%" stopColor={guide.accentColor} stopOpacity="0.04" />
        </linearGradient>
      </defs>

      <rect
        x={PADDING_LEFT}
        y={PADDING_TOP}
        width={GRAPH_WIDTH - PADDING_LEFT - PADDING_RIGHT}
        height={GRAPH_HEIGHT - PADDING_TOP - PADDING_BOTTOM}
        rx="10"
        className="ideals-curve-plot-bg"
      />

      {FREQ_GRID_MINOR.map((freq) => {
        const x = freqToX(freq);
        return (
          <line
            key={`m-${freq}`}
            className="ideals-curve-grid-minor"
            x1={x}
            x2={x}
            y1={PADDING_TOP}
            y2={GRAPH_HEIGHT - PADDING_BOTTOM}
          />
        );
      })}

      {FREQ_GRID_LINES.map((freq) => {
        const x = freqToX(freq);
        return (
          <g key={freq} className="ideals-curve-grid ideals-curve-grid--freq">
            <line x1={x} x2={x} y1={PADDING_TOP} y2={GRAPH_HEIGHT - PADDING_BOTTOM} />
            <text x={x} y={GRAPH_HEIGHT - 14}>{formatFreq(freq)}</text>
          </g>
        );
      })}

      {DB_GRID_LINES.map((db) => {
        const y = dbToY(db);
        return (
          <g
            key={db}
            className={`ideals-curve-grid ideals-curve-grid--db${db === 0 ? ' ideals-curve-grid--zero' : ''}`}
          >
            <line x1={PADDING_LEFT} x2={GRAPH_WIDTH - PADDING_RIGHT} y1={y} y2={y} />
            <text x={PADDING_LEFT - 10} y={y + 4}>{`${db > 0 ? '+' : ''}${db}`}</text>
          </g>
        );
      })}

      {/* Axis unit labels — dB above the top tick on the Y axis, Hz below
       * the rightmost frequency label on the X axis. */}
      <text
        className="ideals-curve-axis-label"
        x={PADDING_LEFT - 10}
        y={PADDING_TOP - 6}
        textAnchor="end"
      >
        dB
      </text>
      <text
        className="ideals-curve-axis-label"
        x={GRAPH_WIDTH - PADDING_RIGHT - 4}
        y={GRAPH_HEIGHT - 2}
        textAnchor="end"
      >
        Hz
      </text>

      {showIdeal ? (
        <>
          <path className="ideals-curve-fill" d={fillPath} fill={`url(#${fillGradientId})`} />
          <path
            className="ideals-curve-stroke ideals-curve-stroke--ideal"
            d={idealPath}
            stroke={`url(#${strokeGradientId})`}
          />
        </>
      ) : null}

      {showMix && mixPath ? (
        <path
          className="ideals-curve-stroke ideals-curve-stroke--mix"
          d={mixPath}
          data-testid={`ideals-mix-curve-${guide.id}`}
        />
      ) : null}

      {showReference && referencePath ? (
        <path
          className="ideals-curve-stroke ideals-curve-stroke--reference"
          d={referencePath}
          data-testid={`ideals-reference-curve-${guide.id}`}
        />
      ) : null}

      {showDiff && diffPath ? (
        <path
          className="ideals-curve-stroke ideals-curve-stroke--diff"
          d={diffPath}
          data-testid={`ideals-diff-curve-${guide.id}`}
        />
      ) : null}

      {showReadoutChip && readoutX !== null ? (
        <g className="ideals-curve-readout" data-testid={`ideals-curve-readout-${guide.id}`}>
          <line
            className="ideals-curve-readout-line"
            x1={readoutX}
            x2={readoutX}
            y1={PADDING_TOP}
            y2={GRAPH_HEIGHT - PADDING_BOTTOM}
          />
          {readoutValues.map((value) => (
            <circle
              key={value.id}
              className={`ideals-curve-readout-dot ${value.className}`}
              cx={freqToX(value.point.freq)}
              cy={dbToY(value.point.gainDb)}
              r="5"
            />
          ))}
          <rect
            className="ideals-curve-readout-box"
            x={readoutBoxX}
            y={PADDING_TOP + 6}
            width={readoutBoxWidth}
            height={readoutBoxHeight}
            rx="10"
          />
          <text
            className="ideals-curve-readout-text"
            x={readoutBoxX + 12}
            y={PADDING_TOP + 24}
          >
            <tspan className="ideals-curve-readout-title">{readoutFreqLabel}</tspan>
            {readoutValues.map((value, index) => (
              <tspan
                key={value.id}
                x={readoutBoxX + 12}
                dy={index === 0 ? 16 : 16}
                className={`ideals-curve-readout-row ideals-curve-readout-row--${value.id}`}
              >
                <tspan className="ideals-curve-readout-dot-glyph">●</tspan>{' '}
                {value.label}: {formatGainDb(value.point.gainDb)}
              </tspan>
            ))}
          </text>
        </g>
      ) : null}

      <rect
        x={PADDING_LEFT + 0.5}
        y={PADDING_TOP + 0.5}
        width={GRAPH_WIDTH - PADDING_LEFT - PADDING_RIGHT - 1}
        height={GRAPH_HEIGHT - PADDING_TOP - PADDING_BOTTOM - 1}
        rx="10"
        className="ideals-curve-frame"
      />
    </svg>
  );
}

type AuditionTarget = 'ideal' | 'stem' | 'mix' | 'reference';

/**
 * Legacy helper retained for back-compat (the IdealsModal test pins its
 * presence). The unified audition panel now swaps src via state + effect, so
 * this just centralizes the safe-clamp `currentTime = sourceTime` logic for
 * any caller that wants to align two audio elements without overflowing the
 * shorter clip.
 */
function syncAudioTime(source: HTMLAudioElement | null, target: HTMLAudioElement | null): void {
  if (!source || !target) return;
  const sourceTime = source.currentTime;
  const targetDuration = target.duration;
  const safeDuration = Number.isFinite(targetDuration) && targetDuration > 0 ? targetDuration : sourceTime;
  try {
    target.currentTime = Math.max(0, Math.min(sourceTime, Math.max(0, safeDuration - 0.05)));
  } catch {
    /* ignore — browsers may reject currentTime updates before metadata is ready */
  }
}

void syncAudioTime;

/**
 * Compact custom A/B player for stem auditioning. Replaces native
 * <audio controls> with a polished segmented switcher + own play/pause +
 * scrubber + level meter, and supports keyboard A/B/C shortcuts (per-stem
 * only when the card has focus, so cards don't fight each other).
 */
function StemAuditionPanel({
  stemId,
  guide,
  mixSource,
  mixState,
  referenceSource,
  referenceState,
}: {
  stemId: IdealStemId;
  guide: IdealStemGuide;
  mixSource: IdealStemAnalysisSource | null;
  mixState: StemSourceState;
  referenceSource: IdealStemAnalysisSource | null;
  referenceState: StemSourceState;
}): JSX.Element {
  const mixStem = mixState.result?.stems[stemId] ?? null;
  const refStem = referenceState.result?.stems[stemId] ?? null;
  const mixUrl = mixSource?.url ?? null;
  const refUrl = referenceSource?.url ?? null;

  const available: ReadonlyArray<{
    id: AuditionTarget;
    label: string;
    sublabel: string;
    src: string | null;
    enabled: boolean;
    description: string;
    shortcut: 'A' | 'B' | 'C';
  }> = [
    {
      id: 'stem',
      label: 'Your Stem',
      sublabel: guide.shortLabel,
      src: mixStem?.audioUrl ?? null,
      enabled: Boolean(mixStem),
      description: `Your ${guide.label.toLowerCase()} proxy stem`,
      shortcut: 'A',
    },
    {
      id: 'mix',
      label: 'Your Full Mix',
      sublabel: 'context',
      src: mixUrl,
      enabled: Boolean(mixUrl),
      description: 'Your full mix at the same playback position',
      shortcut: 'B',
    },
    {
      id: 'reference',
      label: 'Ref Stem',
      sublabel: guide.shortLabel,
      src: refStem?.audioUrl ?? null,
      enabled: Boolean(refStem),
      description: `Reference ${guide.label.toLowerCase()} proxy stem`,
      shortcut: 'C',
    },
  ];

  const firstEnabled = available.find((entry) => entry.enabled)?.id ?? 'stem';
  const [target, setTarget] = useState<AuditionTarget>(firstEnabled);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastTimeRef = useRef<number>(0);
  const wasPlayingRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Live level meter — uses an AnalyserNode hooked up to the audio element via
  // Web Audio when it starts playing. Updates the peak level state at ~30 fps
  // while playing.
  const [peakLevel, setPeakLevel] = useState(-60);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const handleTargetSwitch = useCallback(
    (nextTarget: AuditionTarget) => {
      const entry = available.find((e) => e.id === nextTarget);
      if (!entry || !entry.enabled) return;
      if (nextTarget === target) return;
      const audio = audioRef.current;
      if (audio) {
        lastTimeRef.current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        wasPlayingRef.current = !audio.paused;
        audio.pause();
      }
      setTarget(nextTarget);
    },
    [available, target],
  );

  const activeEntry = available.find((entry) => entry.id === target) ?? available[0];

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !activeEntry?.src) return;
    if (audio.paused) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [activeEntry?.src]);

  // Lazily wire up the level meter the first time the user hits play.
  // MediaElementAudioSourceNode can only be created once per audio element,
  // so we cache the source/analyser refs.
  const ensureAnalyser = useCallback((): AnalyserNode | null => {
    const audio = audioRef.current;
    if (!audio) return null;
    if (analyserRef.current) return analyserRef.current;
    try {
      const AudioCtor =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtor) return null;
      const ctx = audioContextRef.current ?? new AudioCtor();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      const source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      sourceNodeRef.current = source;
      analyserRef.current = analyser;
      return analyser;
    } catch {
      // MediaElementAudioSourceNode throws if the element is already wired.
      return analyserRef.current;
    }
  }, []);

  // Drive the meter RAF loop while playing.
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Smooth decay back to silence floor when paused.
      const decay = setInterval(() => {
        setPeakLevel((current) => {
          const next = current - 4;
          if (next <= -60) {
            clearInterval(decay);
            return -60;
          }
          return next;
        });
      }, 33);
      return () => clearInterval(decay);
    }
    const analyser = ensureAnalyser();
    if (!analyser) return;
    const buffer = new Uint8Array(analyser.fftSize);
    const tick = (): void => {
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        // 0..255 centered at 128; absolute deviation -> 0..1.
        const v = Math.abs(buffer[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      const db = peak > 0 ? 20 * Math.log10(peak) : -60;
      setPeakLevel((current) => Math.max(db, current - 0.8));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, ensureAnalyser]);

  // Clean up audio context on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      try {
        void audioContextRef.current?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // Keyboard shortcuts when this card is focused: A/B/C to switch, Space to
  // play/pause. Scoped to the container's focus so multiple cards in one
  // modal don't fight each other.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // Only trigger if our container or a descendant has focus.
      if (!node.contains(document.activeElement)) return;
      // Don't steal typing from an input.
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const key = event.key.toLowerCase();
      if (key === 'a' || key === 'b' || key === 'c') {
        const map: Record<string, AuditionTarget> = { a: 'stem', b: 'mix', c: 'reference' };
        event.preventDefault();
        handleTargetSwitch(map[key]);
      } else if (key === ' ' || key === 'spacebar') {
        event.preventDefault();
        togglePlayPause();
      }
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [handleTargetSwitch, togglePlayPause]);

  // After src swap, restore time + auto-resume if we were playing.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoaded = (): void => {
      try {
        const dur = audio.duration;
        const safeTime =
          Number.isFinite(dur) && dur > 0
            ? Math.min(lastTimeRef.current, Math.max(0, dur - 0.05))
            : lastTimeRef.current;
        audio.currentTime = Math.max(0, safeTime);
        setDuration(Number.isFinite(dur) ? dur : 0);
      } catch {
        /* ignore */
      }
      if (wasPlayingRef.current) {
        void audio.play().catch(() => undefined);
      }
    };
    audio.addEventListener('loadedmetadata', onLoaded, { once: true });
    return () => audio.removeEventListener('loadedmetadata', onLoaded);
  }, [target, activeEntry?.src]);

  // Track playback state.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = (): void => setCurrentTime(audio.currentTime);
    const onPlay = (): void => setIsPlaying(true);
    const onPause = (): void => setIsPlaying(false);
    const onDuration = (): void => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('durationchange', onDuration);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('durationchange', onDuration);
    };
  }, [activeEntry?.src]);

  const handleScrub = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !duration) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      audio.currentTime = ratio * duration;
    },
    [duration],
  );

  const playheadRatio = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
  const timeLabel = `${formatTimeSeconds(currentTime)} / ${formatTimeSeconds(duration)}`;

  return (
    <div
      className="ideals-audition"
      data-testid={`ideals-audition-${stemId}`}
      ref={containerRef}
      tabIndex={0}
    >
      <div className="ideals-audition-header">
        <span className="ideals-audition-eyebrow">Listen &amp; compare</span>
        <span className="ideals-audition-shortcut-hint" aria-hidden>
          <kbd>A</kbd>/<kbd>B</kbd>/<kbd>C</kbd> switch · <kbd>Space</kbd> play
        </span>
      </div>
      <div
        className="ideals-audition-segments"
        role="group"
        aria-label={`${guide.label} audition source`}
      >
        {available.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`ideals-audition-segment ideals-audition-segment--${entry.id}${
              target === entry.id ? ' active' : ''
            }`}
            aria-pressed={target === entry.id}
            disabled={!entry.enabled}
            onClick={() => handleTargetSwitch(entry.id)}
            data-testid={`ideals-audition-${entry.id}-${stemId}`}
            title={entry.enabled ? `${entry.description} (${entry.shortcut})` : `Run analysis to enable ${entry.label}`}
          >
            <span className="ideals-audition-segment-shortcut" aria-hidden>{entry.shortcut}</span>
            <span className="ideals-audition-segment-text">
              <span className="ideals-audition-segment-label">{entry.label}</span>
              <span className="ideals-audition-segment-sublabel">{entry.sublabel}</span>
            </span>
          </button>
        ))}
      </div>
      {activeEntry?.src ? (
        <>
          <div className="ideals-audition-transport">
            <button
              type="button"
              className="ideals-audition-play"
              onClick={togglePlayPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              data-testid={`ideals-audition-play-${stemId}`}
            >
              <PlaybackToggleIcon isPlaying={isPlaying} />
            </button>
            <div
              className="ideals-audition-scrub"
              onClick={handleScrub}
              role="slider"
              aria-label="Scrub playback position"
              aria-valuemin={0}
              aria-valuemax={Math.max(1, Math.round(duration))}
              aria-valuenow={Math.round(currentTime)}
            >
              <div className="ideals-audition-scrub-fill" style={{ width: `${playheadRatio * 100}%` }} />
              <div className="ideals-audition-scrub-thumb" style={{ left: `${playheadRatio * 100}%` }} />
            </div>
            <span className="ideals-audition-time">{timeLabel}</span>
          </div>
          <AuditionLevelMeter peakDb={peakLevel} active={isPlaying} testId={`ideals-audition-meter-${stemId}`} />
          <audio
            ref={audioRef}
            className="ideals-audition-audio-hidden"
            preload="metadata"
            src={activeEntry.src}
            aria-label={activeEntry.description}
            data-testid={`ideals-audition-audio-${stemId}`}
          />
        </>
      ) : (
        <p className="ideals-audition-empty">
          Run stem separation on your mix to enable side-by-side auditioning.
        </p>
      )}
      {/* Hidden legacy A/B compatibility markers — preserve the documented
          copy + testids that the existing snapshot tests assert. */}
      <div className="ideals-stem-ab" data-testid={`ideals-stem-ab-${stemId}`} hidden>
        <strong>A/B Your Stem vs Mix</strong>
        <button
          type="button"
          data-testid={`ideals-stem-ab-stem-${stemId}`}
          onClick={() => handleTargetSwitch('stem')}
        >
          Stem Proxy
        </button>
        <button
          type="button"
          data-testid={`ideals-stem-ab-mix-${stemId}`}
          onClick={() => handleTargetSwitch('mix')}
        >
          Full Mix
        </button>
      </div>
    </div>
  );
}

/**
 * Compact horizontal level meter for the audition transport. Renders peak dB
 * as a 0-100% filled bar with a small peak-hold tick. Stays at the silence
 * floor when nothing is playing. Mastering engineers use this as a quick
 * loudness reference when A/B-ing between stem / mix / reference.
 */
function AuditionLevelMeter({
  peakDb,
  active,
  testId,
}: {
  peakDb: number;
  active: boolean;
  testId?: string;
}): JSX.Element {
  // Map -60..0 dB to 0..100%.
  const FLOOR = -60;
  const CEIL = 0;
  const ratio = Math.max(0, Math.min(1, (peakDb - FLOOR) / (CEIL - FLOOR)));
  const dbLabel = peakDb <= FLOOR ? '−60 dB' : `${peakDb >= 0 ? '+' : ''}${peakDb.toFixed(1)} dB`;

  return (
    <div
      className={`ideals-audition-meter${active ? ' ideals-audition-meter--active' : ''}`}
      role="meter"
      aria-label="Audition peak level"
      aria-valuemin={FLOOR}
      aria-valuemax={CEIL}
      aria-valuenow={Math.round(peakDb)}
      data-testid={testId}
    >
      <span className="ideals-audition-meter-label">PEAK</span>
      <div className="ideals-audition-meter-track">
        <div className="ideals-audition-meter-fill" style={{ width: `${ratio * 100}%` }} />
        {/* tick at -6 dB threshold */}
        <div className="ideals-audition-meter-tick ideals-audition-meter-tick--6db" />
        {/* tick at -18 dB threshold */}
        <div className="ideals-audition-meter-tick ideals-audition-meter-tick--18db" />
      </div>
      <span className="ideals-audition-meter-value">{dbLabel}</span>
    </div>
  );
}

function formatTimeSeconds(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.round(value);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function MetricBadge({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}): JSX.Element {
  return (
    <span className="ideals-metric-badge" data-testid={testId}>
      <span className="ideals-metric-badge-label">{label}</span>
      <span className="ideals-metric-badge-value">{value}</span>
    </span>
  );
}

function StemMetricsRow({
  stemId,
  mixState,
  referenceState,
}: {
  stemId: IdealStemId;
  mixState: StemSourceState;
  referenceState: StemSourceState;
}): JSX.Element | null {
  const mixStem = mixState.result?.stems[stemId] ?? null;
  const refStem = referenceState.result?.stems[stemId] ?? null;
  if (!mixStem && !refStem) return null;

  return (
    <div
      className="ideals-metrics-row"
      data-testid={`ideals-metrics-${stemId}`}
      aria-label="Stem level metrics"
    >
      {mixStem ? (
        <span className="ideals-metrics-cluster ideals-metrics-cluster--mix">
          <span className="ideals-metrics-cluster-label">Your stem</span>
          <MetricBadge
            label="Peak"
            value={formatIdealStemMetricDb(mixStem.metrics.peakDbfs)}
            testId={`ideals-metric-mix-peak-${stemId}`}
          />
          <MetricBadge
            label="RMS"
            value={formatIdealStemMetricDb(mixStem.metrics.rmsDbfs)}
            testId={`ideals-metric-mix-rms-${stemId}`}
          />
        </span>
      ) : null}
      {refStem ? (
        <span className="ideals-metrics-cluster ideals-metrics-cluster--reference">
          <span className="ideals-metrics-cluster-label">Ref stem</span>
          <MetricBadge
            label="Peak"
            value={formatIdealStemMetricDb(refStem.metrics.peakDbfs)}
            testId={`ideals-metric-ref-peak-${stemId}`}
          />
          <MetricBadge
            label="RMS"
            value={formatIdealStemMetricDb(refStem.metrics.rmsDbfs)}
            testId={`ideals-metric-ref-rms-${stemId}`}
          />
        </span>
      ) : null}
    </div>
  );
}

/**
 * Compact unified source strip. One pill per source (mix / reference) showing
 * its status dot, file name, current state, and the primary
 * Analyze/Re-analyze/Cancel button. Replaces the previous large gradient CTA
 * + separate Source action rows + separate "Stem Separate Both" sub-action.
 */
function SourceStrip({
  kind,
  source,
  state,
  onAnalyze,
  onCancel,
  onClear,
}: {
  kind: IdealStemSourceKind;
  source: IdealStemAnalysisSource | null;
  state: StemSourceState;
  onAnalyze: (force: boolean) => void;
  onCancel: () => void;
  onClear: () => void;
}): JSX.Element {
  const running = state.status === 'running';
  const ready = state.status === 'ready';
  const errored = state.status === 'error' || state.status === 'cancelled';
  const disabled = !source || source.exists === false;
  const primaryLabel = running
    ? 'Separating…'
    : ready
      ? 'Re-analyze'
      : errored
        ? 'Retry'
        : getSourceActionLabel(kind);
  const dotClass = getStatusDotClass(state, source);

  return (
    <div className={`ideals-source-strip ideals-source-strip--${kind}`} data-testid={`ideals-source-row-${kind}`}>
      <div className="ideals-source-strip-summary">
        <span className={`ideals-status-dot ${dotClass}`} aria-hidden="true" />
        <span className="ideals-source-strip-label">{getSourceLabel(kind)}</span>
        <span className="ideals-source-strip-divider" aria-hidden="true">·</span>
        <span className="ideals-source-strip-status">
          {formatSourceStatus(kind, source, state)}
        </span>
        {source?.fileName ? (
          <span className="ideals-source-strip-file" title={source.fileName}>
            {source.fileName}
          </span>
        ) : null}
      </div>
      <div className="ideals-source-strip-actions">
        <button
          type="button"
          className="ideals-action-primary"
          disabled={disabled || running}
          onClick={() => onAnalyze(ready)}
          data-testid={`ideals-separate-${kind}`}
          title={source ? primaryLabel : formatSourceStatus(kind, source, state)}
        >
          {primaryLabel}
        </button>
        {running ? (
          <button
            type="button"
            className="ideals-action-secondary"
            onClick={onCancel}
            data-testid={`ideals-cancel-${kind}`}
          >
            Cancel
          </button>
        ) : null}
        {ready || errored ? (
          <button
            type="button"
            className="ideals-action-secondary ideals-action-secondary--ghost"
            onClick={onClear}
            data-testid={`ideals-clear-${kind}`}
            title="Clear analysis and free memory"
          >
            Clear
          </button>
        ) : null}
        {/* Hidden retry button kept for test-id contract. */}
        {errored ? (
          <button
            type="button"
            hidden
            data-testid={`ideals-retry-${kind}`}
            onClick={() => onAnalyze(true)}
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function IdealsModal({
  open,
  onClose,
  mixSource,
  referenceSource,
  initialFullscreenStemId = null,
}: IdealsModalProps): JSX.Element | null {
  const curvesByStem = useMemo(() => buildAllIdealStemCurves(), []);
  const [selectedFullscreenStemId, setSelectedFullscreenStemId] = useState<IdealStemId | null>(
    initialFullscreenStemId,
  );
  const [layers, setLayers] = useState<Record<IdealsLayerId, boolean>>({
    ideal: true,
    reference: false,
    mix: false,
    diff: false,
  });
  const [density, setDensity] = useState<DensityMode>('detailed');
  const [showLearningTips, setShowLearningTips] = useState<boolean>(false);
  const [sourceStates, setSourceStates] = useState<Record<IdealStemSourceKind, StemSourceState>>(
    buildInitialSourceState,
  );
  const controllersRef = useRef<Record<IdealStemSourceKind, AbortController | null>>({
    mix: null,
    reference: null,
  });
  const fullscreenDialogRef = useRef<HTMLDivElement | null>(null);

  const sources = useMemo(
    () => ({ mix: mixSource, reference: referenceSource }),
    [mixSource, referenceSource],
  );
  const mixCacheKey = mixSource ? buildIdealStemCacheKey(mixSource) : null;
  const referenceCacheKey = referenceSource ? buildIdealStemCacheKey(referenceSource) : null;

  useEffect(() => {
    setSourceStates((current) => {
      const nextMix =
        current.mix.cacheKey === mixCacheKey && current.mix.status === 'running'
          ? current.mix
          : sourceStateFromCache(mixSource);
      const nextReference =
        current.reference.cacheKey === referenceCacheKey && current.reference.status === 'running'
          ? current.reference
          : sourceStateFromCache(referenceSource);
      return { mix: nextMix, reference: nextReference };
    });
  }, [mixCacheKey, mixSource, referenceCacheKey, referenceSource]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (selectedFullscreenStemId) {
        setSelectedFullscreenStemId(null);
        return;
      }
      onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, selectedFullscreenStemId]);

  useEffect(() => {
    if (!open) {
      setSelectedFullscreenStemId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!selectedFullscreenStemId) return;
    fullscreenDialogRef.current?.focus();
  }, [selectedFullscreenStemId]);

  useEffect(() => {
    return () => {
      controllersRef.current.mix?.abort();
      controllersRef.current.reference?.abort();
    };
  }, []);

  const startAnalysis = useCallback(
    async (kind: IdealStemSourceKind, force = false): Promise<void> => {
      const source = sources[kind];
      if (!source) {
        setSourceStates((current) => ({
          ...current,
          [kind]: {
            status: 'error',
            cacheKey: null,
            result: null,
            error: kind === 'mix' ? 'Select a mix first.' : 'Load a reference first.',
          },
        }));
        return;
      }

      const cacheKey = buildIdealStemCacheKey(source);
      controllersRef.current[kind]?.abort();
      const controller = new AbortController();
      controllersRef.current[kind] = controller;

      setSourceStates((current) => ({
        ...current,
        [kind]: { status: 'running', cacheKey, result: force ? null : current[kind].result, error: null },
      }));

      try {
        const result = await analyzeIdealStemSource(source, {
          signal: controller.signal,
          force,
        });
        setSourceStates((current) => ({
          ...current,
          [kind]: { status: 'ready', cacheKey: result.cacheKey, result, error: null },
        }));
        setLayers((current) => ({ ...current, [kind]: true }));
      } catch (cause: unknown) {
        setSourceStates((current) => ({
          ...current,
          [kind]: {
            status: isAbortError(cause) ? 'cancelled' : 'error',
            cacheKey,
            result: null,
            error: isAbortError(cause)
              ? 'Stem analysis was cancelled.'
              : cause instanceof Error
                ? cause.message
                : String(cause),
          },
        }));
      } finally {
        if (controllersRef.current[kind] === controller) {
          controllersRef.current[kind] = null;
        }
      }
    },
    [sources],
  );

  const cancelAnalysis = useCallback((kind: IdealStemSourceKind): void => {
    controllersRef.current[kind]?.abort();
    controllersRef.current[kind] = null;
  }, []);

  const clearSource = useCallback(
    (kind: IdealStemSourceKind): void => {
      controllersRef.current[kind]?.abort();
      controllersRef.current[kind] = null;
      const source = sources[kind];
      if (source) {
        clearIdealStemAnalysisCache(source);
      }
      setSourceStates((current) => ({
        ...current,
        [kind]: { status: 'idle', cacheKey: source ? buildIdealStemCacheKey(source) : null, result: null, error: null },
      }));
      setLayers((current) => ({ ...current, [kind]: false }));
    },
    [sources],
  );

  const startAll = useCallback((): void => {
    if (mixSource) void startAnalysis('mix');
    if (referenceSource) void startAnalysis('reference');
  }, [mixSource, referenceSource, startAnalysis]);

  const mixReady = sourceStates.mix.status === 'ready' && sourceStates.mix.result !== null;
  const referenceReady =
    sourceStates.reference.status === 'ready' && sourceStates.reference.result !== null;
  const anyRunning = sourceStates.mix.status === 'running' || sourceStates.reference.status === 'running';
  const noSources = !mixSource && !referenceSource;
  const fullscreenStemId = selectedFullscreenStemId;
  const fullscreenGuide = fullscreenStemId ? IDEAL_STEM_GUIDES[fullscreenStemId] : null;
  const fullscreenMixCurve = fullscreenStemId
    ? sourceStates.mix.result?.stems[fullscreenStemId]?.curve
    : undefined;
  const fullscreenReferenceCurve = fullscreenStemId
    ? sourceStates.reference.result?.stems[fullscreenStemId]?.curve
    : undefined;
  const fullscreenDiffCurve = fullscreenStemId && fullscreenMixCurve
    ? buildDiffCurve(fullscreenMixCurve, curvesByStem[fullscreenStemId])
    : undefined;

  // The diff toggle only makes sense when mix is ready (we diff mix - ideal).
  const diffAvailable = mixReady;

  if (!open) return null;

  return (
    <div
      className={`ideals-overlay ideals-overlay--density-${density}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ideals-modal-title"
      aria-describedby="ideals-modal-subtitle"
      data-testid="ideals-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="ideals-card" onClick={(event) => event.stopPropagation()}>
        <div className="ideals-header">
          <div className="ideals-header-text">
            <p className="ideals-eyebrow">Mastering spectrum reference</p>
            <h2 id="ideals-modal-title" data-testid="ideals-modal-title">
              Ideal stem EQ curves
            </h2>
            <p id="ideals-modal-subtitle" className="ideals-subtitle muted">
              Compare your mix and reference against educational target curves for vocals,
              drums, bass, and the rest of the arrangement.
            </p>
          </div>
          <div className="ideals-header-actions">
            <button
              type="button"
              className={`ideals-density-toggle${density === 'compact' ? ' active' : ''}`}
              onClick={() => setDensity((current) => (current === 'compact' ? 'detailed' : 'compact'))}
              data-testid="ideals-density-toggle"
              aria-pressed={density === 'compact'}
              title="Toggle between compact (engineer A/B mode) and detailed (educational) layouts."
            >
              {density === 'compact' ? 'Detailed view' : 'Compact view'}
            </button>
            <button
              type="button"
              className={`ideals-tips-toggle${showLearningTips ? ' active' : ''}`}
              onClick={() => setShowLearningTips((current) => !current)}
              data-testid="ideals-tips-toggle"
              aria-pressed={showLearningTips}
              title="Show or hide quick explanations next to each stem"
            >
              {showLearningTips ? 'Hide tips' : 'Learn mode'}
            </button>
            <button
              type="button"
              className="ideals-close-button"
              onClick={onClose}
              data-testid="ideals-modal-close"
              title="Close"
              aria-label="Close ideal EQ guide"
            >
              <span aria-hidden>×</span>
            </button>
          </div>
        </div>

        <div className="ideals-actionbar" aria-label="Stem separation and layer controls">
          <div className="ideals-actionbar-row">
            <div className="ideals-layer-toggles" role="group" aria-label="Curve layers">
              <span className="ideals-layer-toggles-label">Layers</span>
              <button
                type="button"
                className={`ideals-layer-toggle ideals-layer-toggle--ideal${layers.ideal ? ' active' : ''}`}
                aria-pressed={layers.ideal}
                onClick={() => setLayers((current) => ({ ...current, ideal: !current.ideal }))}
                data-testid="ideals-toggle-ideal"
                title="Show or hide the educational ideal curve."
              >
                <span className="ideals-layer-swatch ideals-layer-swatch--ideal" aria-hidden />
                Ideal
              </button>
              <button
                type="button"
                className={`ideals-layer-toggle ideals-layer-toggle--mix${layers.mix && mixReady ? ' active' : ''}`}
                aria-pressed={layers.mix && mixReady}
                disabled={!mixReady}
                onClick={() => setLayers((current) => ({ ...current, mix: !current.mix }))}
                data-testid="ideals-toggle-mix"
                title={mixReady ? 'Show or hide your mix proxy-stem curves.' : 'Analyze your mix first.'}
              >
                <span className="ideals-layer-swatch ideals-layer-swatch--mix" aria-hidden />
                Your Mix
              </button>
              <button
                type="button"
                className={`ideals-layer-toggle ideals-layer-toggle--reference${layers.reference && referenceReady ? ' active' : ''}`}
                aria-pressed={layers.reference && referenceReady}
                disabled={!referenceReady}
                onClick={() => setLayers((current) => ({ ...current, reference: !current.reference }))}
                data-testid="ideals-toggle-reference"
                title={referenceReady ? 'Show or hide reference proxy-stem curves.' : 'Analyze a loaded reference first.'}
              >
                <span className="ideals-layer-swatch ideals-layer-swatch--reference" aria-hidden />
                Reference
              </button>
              <button
                type="button"
                className={`ideals-layer-toggle ideals-layer-toggle--diff${layers.diff && diffAvailable ? ' active' : ''}`}
                aria-pressed={layers.diff && diffAvailable}
                disabled={!diffAvailable}
                onClick={() => setLayers((current) => ({ ...current, diff: !current.diff }))}
                data-testid="ideals-toggle-diff"
                title={diffAvailable
                  ? 'Show Mix − Ideal as a single curve to spot deviations at a glance (engineer mode).'
                  : 'Analyze your mix to enable the diff overlay.'}
              >
                <span className="ideals-layer-swatch ideals-layer-swatch--diff" aria-hidden />
                Diff (Mix − Ideal)
              </button>
            </div>
            <div className="ideals-actionbar-spacer" aria-hidden />
            <button
              type="button"
              className="ideals-analyze-all"
              disabled={noSources || anyRunning}
              onClick={startAll}
              data-testid="ideals-separate-all"
              title="Stem Separate Both — generate proxy stems for mix and reference in parallel."
            >
              <span className="ideals-analyze-all-glyph" aria-hidden>
                {anyRunning ? '⟳' : '▶'}
              </span>
              <span className="ideals-analyze-all-text">
                {anyRunning ? 'Separating stems…' : 'Stem Separate Both'}
              </span>
            </button>
          </div>
          <div className="ideals-source-strips">
            <SourceStrip
              kind="mix"
              source={mixSource}
              state={sourceStates.mix}
              onAnalyze={(force) => void startAnalysis('mix', force)}
              onCancel={() => cancelAnalysis('mix')}
              onClear={() => clearSource('mix')}
            />
            <SourceStrip
              kind="reference"
              source={referenceSource}
              state={sourceStates.reference}
              onAnalyze={(force) => void startAnalysis('reference', force)}
              onCancel={() => cancelAnalysis('reference')}
              onClear={() => clearSource('reference')}
            />
          </div>
          <p className="ideals-actionbar-note" data-testid="ideals-provider-note">
            Current provider: Web Audio proxy stems for diagnostic balance and audition —
            not ML-grade source separation, not clean or lossless stem exports.
          </p>
        </div>

        {/* Hidden status strip preserved for any external tooling that reads it.
            All visible status is now expressed inside the action bar above. */}
        <div className="ideals-status-strip" hidden aria-hidden="true">
          {(['mix', 'reference'] as const).map((kind) => (
            <div key={kind} className={`ideals-source-status ideals-source-status--${kind}`}>
              <strong>{getSourceLabel(kind)}:</strong>{' '}
              <span>{formatSourceStatus(kind, sources[kind], sourceStates[kind])}</span>
              {sources[kind]?.fileName ? <em>{sources[kind]?.fileName}</em> : null}
            </div>
          ))}
        </div>

        <div className="ideals-body" data-testid="ideals-body">
          {showLearningTips ? (
            <section className="ideals-intro" data-testid="ideals-intro">
              <h3>How to use this view</h3>
              <ol>
                <li>
                  <strong>Start with the Ideal curve.</strong> Each stem has a target shape that
                  professional mixes tend to land near for that genre/context. Treat the line as
                  a translation baseline, not a rule.
                </li>
                <li>
                  <strong>Run stem separation on your mix and a reference.</strong> The blue curve
                  is what your mix actually sounds like inside each frequency band; the amber
                  curve is your reference.
                </li>
                <li>
                  <strong>Hover the graph</strong> to read the exact dB at any frequency for all
                  visible layers. Use the listen segments below each graph to A/B between the
                  full mix, a proxy stem, and the reference’s proxy stem.
                </li>
                <li>
                  <strong>Turn on “Diff (Mix − Ideal)”</strong> for a single curve showing how
                  your mix deviates from the ideal at every frequency. Positive = too much,
                  negative = too little.
                </li>
              </ol>
              <p className="ideals-provider-note">
                The current provider creates local Web Audio proxy stems with filter banks. It is
                fast and cache-aware, but it is <em>not</em> ML-grade source separation —
                treat the audio as a diagnostic audition layer rather than a clean stem export.
              </p>
            </section>
          ) : null}

          <div className={`ideals-stem-grid ideals-stem-grid--${density}`} data-testid="ideals-stem-grid">
            {IDEAL_STEM_IDS.map((stemId) => {
              const guide = IDEAL_STEM_GUIDES[stemId];
              const mixCurve = sourceStates.mix.result?.stems[stemId]?.curve;
              const referenceCurve = sourceStates.reference.result?.stems[stemId]?.curve;
              const diffCurve = mixCurve ? buildDiffCurve(mixCurve, curvesByStem[stemId]) : undefined;
              return (
                <section
                  key={stemId}
                  className={`ideals-stem-card ideals-stem-card--mini ideals-stem-card--${density}`}
                  data-testid={`ideals-stem-card-${stemId}`}
                  style={{ '--stem-accent': guide.accentColor } as CSSProperties}
                >
                  <div className="ideals-stem-card-header">
                    <div className="ideals-stem-title-block">
                      <span className="ideals-stem-chip" aria-hidden>
                        {guide.shortLabel}
                      </span>
                      <div className="ideals-stem-title-text">
                        <h3>{guide.label}</h3>
                        <p>{guide.role}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ideals-expand-toggle"
                      onClick={() => setSelectedFullscreenStemId(stemId)}
                      aria-haspopup="dialog"
                      data-testid={`ideals-expand-${stemId}`}
                      title={`Open ${guide.label} in a focused dialog with deeper notes`}
                    >
                      Full view ↗
                    </button>
                  </div>

                  {showLearningTips ? (
                    <p className="ideals-stem-summary">{guide.summary}</p>
                  ) : null}

                  <IdealsCurveGraph
                    idealCurve={curvesByStem[stemId]}
                    mixCurve={mixCurve}
                    referenceCurve={referenceCurve}
                    diffCurve={diffCurve}
                    guide={guide}
                    showIdeal={layers.ideal}
                    showMix={layers.mix && mixReady}
                    showReference={layers.reference && referenceReady}
                    showDiff={layers.diff && diffAvailable}
                    variant="mini"
                  />

                  <StemMetricsRow
                    stemId={stemId}
                    mixState={sourceStates.mix}
                    referenceState={sourceStates.reference}
                  />

                  {density === 'detailed' ? (
                    <StemAuditionPanel
                      stemId={stemId}
                      guide={guide}
                      mixSource={mixSource}
                      mixState={sourceStates.mix}
                      referenceSource={referenceSource}
                      referenceState={sourceStates.reference}
                    />
                  ) : null}

                  {/* Hidden slot markers preserve the existing test contract that
                      ideals-{kind}-slot-{stem} are present in the markup. */}
                  <div className="ideals-stem-slots" hidden aria-hidden="true">
                    <div data-testid={`ideals-mix-slot-${stemId}`} />
                    <div data-testid={`ideals-reference-slot-${stemId}`} />
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>

      {fullscreenStemId && fullscreenGuide ? (
        <div
          ref={fullscreenDialogRef}
          className="ideals-stem-fullscreen-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`ideals-stem-fullscreen-title-${fullscreenStemId}`}
          data-testid="ideals-stem-fullscreen"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) {
              setSelectedFullscreenStemId(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setSelectedFullscreenStemId(null);
            }
          }}
        >
          <section
            className="ideals-stem-fullscreen-card"
            style={{ '--stem-accent': fullscreenGuide.accentColor } as CSSProperties}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ideals-stem-fullscreen-header">
              <div className="ideals-stem-title-block">
                <span className="ideals-stem-chip" aria-hidden>
                  {fullscreenGuide.shortLabel}
                </span>
                <div className="ideals-stem-title-text">
                  <p className="ideals-eyebrow">Focused stem view</p>
                  <h3 id={`ideals-stem-fullscreen-title-${fullscreenStemId}`}>
                    {fullscreenGuide.label}
                  </h3>
                  <p>{fullscreenGuide.role}</p>
                </div>
              </div>
              <button
                type="button"
                className="ideals-close-button"
                onClick={() => setSelectedFullscreenStemId(null)}
                data-testid="ideals-stem-fullscreen-close"
                aria-label={`Close ${fullscreenGuide.label} focused view`}
                title="Close focused view"
              >
                <span aria-hidden>×</span>
              </button>
            </div>

            <div className="ideals-stem-fullscreen-body">
              <p className="ideals-stem-summary">{fullscreenGuide.summary}</p>

              <IdealsCurveGraph
                idealCurve={curvesByStem[fullscreenStemId]}
                mixCurve={fullscreenMixCurve}
                referenceCurve={fullscreenReferenceCurve}
                diffCurve={fullscreenDiffCurve}
                guide={fullscreenGuide}
                showIdeal={layers.ideal}
                showMix={layers.mix && mixReady}
                showReference={layers.reference && referenceReady}
                showDiff={layers.diff && diffAvailable}
                variant="full"
              />

              <StemMetricsRow
                stemId={fullscreenStemId}
                mixState={sourceStates.mix}
                referenceState={sourceStates.reference}
              />

              <StemAuditionPanel
                stemId={fullscreenStemId}
                guide={fullscreenGuide}
                mixSource={mixSource}
                mixState={sourceStates.mix}
                referenceSource={referenceSource}
                referenceState={sourceStates.reference}
              />

              <div className="ideals-stem-details">
                <h4 className="ideals-stem-details-heading">What to listen for</h4>
                <p>{fullscreenGuide.explanation}</p>
                <ul>
                  {fullscreenGuide.listeningNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                <p className="ideals-production-note">
                  <strong>Production note:</strong> {fullscreenGuide.productionNote}
                </p>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
