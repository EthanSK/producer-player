/**
 * idealsHarness.tsx — isolated harness for screenshot-driven UX iteration on
 * the IdealsModal. Run via `vite --config apps/renderer/vite.config.ts` and
 * visit /ideals-harness.html, or use scripts/iterate-ideals-ux.mjs to drive it
 * headlessly with Playwright.
 *
 * The harness mocks out the heavy analysis pipeline so the modal renders
 * instantly with realistic curve data in every state (idle / running / ready /
 * error), via URL params.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IdealsModal, type IdealStemAnalysisSource } from './IdealsModal';
import { IDEAL_STEM_IDS, type IdealStemId, buildAllIdealStemCurves } from './idealCurves';
import './styles.css';

type HarnessState = 'idle' | 'running' | 'ready' | 'fullscreen' | 'error';

interface HarnessConfig {
  state: HarnessState;
  hasMix: boolean;
  hasReference: boolean;
  fullscreenStem: IdealStemId | null;
  layers: ReadonlyArray<'ideal' | 'mix' | 'reference' | 'diff'>;
  density: 'compact' | 'detailed' | null;
  tips: boolean;
}

function parseConfig(): HarnessConfig {
  const params = new URLSearchParams(window.location.search);
  const stateParam = params.get('state') as HarnessState | null;
  const layersParam = params.get('layers');
  const allowed: ReadonlyArray<'ideal' | 'mix' | 'reference' | 'diff'> = ['ideal', 'mix', 'reference', 'diff'];
  const layers: ReadonlyArray<'ideal' | 'mix' | 'reference' | 'diff'> = layersParam
    ? layersParam
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is 'ideal' | 'mix' | 'reference' | 'diff' =>
          allowed.includes(s as 'ideal' | 'mix' | 'reference' | 'diff'),
        )
    : ['ideal'];
  const densityParam = params.get('density');
  const density = densityParam === 'compact' || densityParam === 'detailed' ? densityParam : null;
  return {
    state: stateParam ?? 'idle',
    hasMix: params.get('mix') !== 'false',
    hasReference: params.get('ref') === 'true',
    fullscreenStem: (params.get('full') as IdealStemId | null) ?? null,
    layers,
    density,
    tips: params.get('tips') === 'true',
  };
}

// Tiny silent 1-frame WAV as a placeholder for audio URL. The harness isn't
// going to actually play audio — the audio element just needs *something* so
// the audition transport renders enabled.
function makeSilentAudioUrl(): string {
  const bytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d,
    0x74, 0x20, 0x10, 0, 0, 0, 1, 0, 1, 0, 0x44, 0xac, 0, 0, 0x88, 0x58, 0x1,
    0, 2, 0, 0x10, 0, 0x64, 0x61, 0x74, 0x61, 0, 0, 0, 0,
  ]);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

const mockMix: IdealStemAnalysisSource = {
  kind: 'mix',
  label: 'Your Mix',
  fileName: 'thedrums v6.wav',
  filePath: '/Users/me/Music/thedrums v6.wav',
  url: makeSilentAudioUrl(),
  sizeBytes: 4_800_000,
  modifiedAt: '2026-03-16T21:04:53.000Z',
  versionId: 'thedrums-v6',
  sourceStrategy: 'direct-file',
  exists: true,
};

const mockReference: IdealStemAnalysisSource = {
  kind: 'reference',
  label: 'Reference',
  fileName: 'Daft Punk — Get Lucky.flac',
  filePath: '/Users/me/Music/References/get-lucky.flac',
  url: makeSilentAudioUrl(),
  sizeBytes: 28_000_000,
  modifiedAt: '2025-12-01T10:00:00.000Z',
  referenceIdentity: 'daft-punk-get-lucky',
  sourceStrategy: 'reference-track',
  exists: true,
};

// Generate fake "analyzed" curves that look realistic. We bend the ideal
// curves by a per-stem offset so the mix/reference lines visibly differ from
// the target on the graph.
function perturbCurves(offsetDb: number, slopeBias: number) {
  const ideals = buildAllIdealStemCurves();
  const result: Record<IdealStemId, { curve: { freq: number; gainDb: number }[] }> = {} as never;
  for (const stemId of IDEAL_STEM_IDS) {
    const ideal = ideals[stemId];
    result[stemId] = {
      curve: ideal.map((point, idx) => {
        const t = idx / Math.max(1, ideal.length - 1);
        const slope = (t - 0.5) * slopeBias;
        const noise = Math.sin(idx * 1.3 + offsetDb) * 1.2;
        return {
          freq: point.freq,
          gainDb: Math.max(-24, Math.min(6, point.gainDb + offsetDb + slope + noise)),
        };
      }),
    };
  }
  return result;
}

function buildFakeStems(perturbed: ReturnType<typeof perturbCurves>) {
  // Build a tiny silent wav as a placeholder for audio URL (the harness isn't
  // going to actually play audio — the audio element just needs *something* for
  // visual layout). 1-frame WAV.
  const wavBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d,
    0x74, 0x20, 0x10, 0, 0, 0, 1, 0, 1, 0, 0x44, 0xac, 0, 0, 0x88, 0x58, 0x1,
    0, 2, 0, 0x10, 0, 0x64, 0x61, 0x74, 0x61, 0, 0, 0, 0,
  ]);
  const blob = new Blob([wavBytes], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const stems: Record<IdealStemId, unknown> = {} as never;
  for (const stemId of IDEAL_STEM_IDS) {
    stems[stemId] = {
      stemId,
      curve: perturbed[stemId].curve,
      audioUrl: url,
      metrics: {
        peakDbfs: -3 - Math.random() * 5,
        rmsDbfs: -14 - Math.random() * 4,
        durationSeconds: 215,
        sampleRate: 44100,
      },
    };
  }
  return stems;
}

// Stub the in-module cache for the modal so it picks up the fake "ready" data
// on mount.
async function preloadCache(config: HarnessConfig): Promise<void> {
  if (config.state !== 'ready' && config.state !== 'fullscreen') return;
  // Dynamically import the module so we can mutate its internals.
  const mod = (await import('./idealStemAnalysis')) as unknown as {
    buildIdealStemCacheKey: (src: IdealStemAnalysisSource) => string;
  };
  // Access the internal cache via a back-door: re-export via Window for now.
  const cacheKey = mod.buildIdealStemCacheKey(mockMix);
  const refCacheKey = mod.buildIdealStemCacheKey(mockReference);

  const mixStems = buildFakeStems(perturbCurves(-2.5, -4));
  const refStems = buildFakeStems(perturbCurves(0.5, 2));

  // We need a way to inject into the module's resultCache. Easiest hack: patch
  // analyzeIdealStemSource to immediately return cached result. We do this by
  // assigning to the imported module's exports via a side-channel: the module
  // imports build a closure, so the cleanest path is to call the public
  // analyzeIdealStemSource which currently can't work without a URL. Instead
  // we patch the module's resultCache via a debug global the source can opt
  // into in dev. We do NOT want to change production code, so for the harness
  // we use a simpler trick: render the IdealsModal AFTER stuffing the
  // module-level cache through a dev-only export.
  // To avoid bloating production code, the harness instead patches the
  // exported `analyzeIdealStemSource` via Object.defineProperty:
  type AnalysisModule = typeof import('./idealStemAnalysis');
  const fullMod = mod as unknown as AnalysisModule & {
    __debugSetCache?: (key: string, result: unknown) => void;
  };
  if (fullMod.__debugSetCache) {
    fullMod.__debugSetCache(cacheKey, {
      cacheKey,
      source: mockMix,
      provider: {
        id: 'web-audio-proxy-v1',
        label: 'Web Audio proxy stems',
        disclosure: 'Local Web Audio fallback.',
        isApproximation: true,
      },
      stems: mixStems,
      createdAt: new Date().toISOString(),
    });
    fullMod.__debugSetCache(refCacheKey, {
      cacheKey: refCacheKey,
      source: mockReference,
      provider: {
        id: 'web-audio-proxy-v1',
        label: 'Web Audio proxy stems',
        disclosure: 'Local Web Audio fallback.',
        isApproximation: true,
      },
      stems: refStems,
      createdAt: new Date().toISOString(),
    });
  } else {
    // Fall back to attaching to window so the developer notices.
    (window as unknown as { __HARNESS_CACHE_FAILED: boolean }).__HARNESS_CACHE_FAILED = true;
    console.warn('[ideals-harness] __debugSetCache export missing on idealStemAnalysis; ready state will not preload.');
  }
}

function Harness({ config }: { config: HarnessConfig }): JSX.Element {
  const [open, setOpen] = useState(true);

  // Apply post-mount harness overrides: programmatically click the existing
  // controls to match the URL-requested layers/density/tips. Doing this via
  // existing DOM interactions (instead of new props) keeps the modal API
  // unchanged for production.
  useEffect(() => {
    if (!open) return;
    const apply = (): void => {
      const desiredLayers = new Set(config.layers);

      const clickLayer = (id: 'ideal' | 'mix' | 'reference' | 'diff', want: boolean): void => {
        const btn = document.querySelector<HTMLButtonElement>(`[data-testid="ideals-toggle-${id}"]`);
        if (!btn) return;
        const active = btn.getAttribute('aria-pressed') === 'true';
        if (active !== want && !btn.disabled) btn.click();
      };

      // Wait one frame so the toggles are mounted and reflect cache-derived
      // ready state.
      requestAnimationFrame(() => {
        clickLayer('ideal', desiredLayers.has('ideal'));
        clickLayer('mix', desiredLayers.has('mix'));
        clickLayer('reference', desiredLayers.has('reference'));
        clickLayer('diff', desiredLayers.has('diff'));

        if (config.density === 'compact') {
          const densityBtn = document.querySelector<HTMLButtonElement>('[data-testid="ideals-density-toggle"]');
          if (densityBtn && densityBtn.getAttribute('aria-pressed') !== 'true') densityBtn.click();
        }

        if (config.tips) {
          const tipsBtn = document.querySelector<HTMLButtonElement>('[data-testid="ideals-tips-toggle"]');
          if (tipsBtn && tipsBtn.getAttribute('aria-pressed') !== 'true') tipsBtn.click();
        }

        (window as unknown as { __HARNESS_OVERRIDES_APPLIED: boolean }).__HARNESS_OVERRIDES_APPLIED = true;
      });
    };
    apply();
  }, [open, config]);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f14' }}>
      <IdealsModal
        open={open}
        onClose={() => setOpen(false)}
        mixSource={config.hasMix ? mockMix : null}
        referenceSource={config.hasReference ? mockReference : null}
        initialFullscreenStemId={config.state === 'fullscreen' ? config.fullscreenStem ?? 'vocals' : null}
      />
    </div>
  );
}

async function bootstrap(): Promise<void> {
  const config = parseConfig();
  // Preload the analysis cache BEFORE mounting React so the modal sees the
  // cached "ready" state on its very first render.
  await preloadCache(config);
  const rootEl = document.getElementById('root')!;
  createRoot(rootEl).render(<Harness config={config} />);
  // Signal to Playwright that we're ready (lets the script wait on a flag).
  (window as unknown as { __HARNESS_READY: boolean }).__HARNESS_READY = true;
}

// Suppress the unused-import warning for useEffect.
void useEffect;

void bootstrap();
