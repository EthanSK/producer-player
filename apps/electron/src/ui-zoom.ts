import type { UiZoomState } from '@producer-player/contracts';

export const UI_ZOOM_FACTOR_OPTIONS = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15] as const;
export const DEFAULT_UI_ZOOM_FACTOR = 1;

const UI_ZOOM_FACTOR_SET = new Set<number>(UI_ZOOM_FACTOR_OPTIONS);
const MIN_UI_ZOOM_FACTOR = UI_ZOOM_FACTOR_OPTIONS[0];
const MAX_UI_ZOOM_FACTOR = UI_ZOOM_FACTOR_OPTIONS[UI_ZOOM_FACTOR_OPTIONS.length - 1];

export interface UiZoomMetrics {
  platform: NodeJS.Platform | string;
  workArea: {
    width: number;
    height: number;
  };
  windowBounds?: {
    width: number;
    height: number;
  };
  scaleFactor?: number;
}

function roundZoomFactor(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sanitizeUiZoomPreference(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  const rounded = roundZoomFactor(value);
  if (UI_ZOOM_FACTOR_SET.has(rounded)) return rounded;

  if (rounded < MIN_UI_ZOOM_FACTOR || rounded > MAX_UI_ZOOM_FACTOR) return null;

  return UI_ZOOM_FACTOR_OPTIONS.reduce((nearest, option) => (
    Math.abs(option - rounded) < Math.abs(nearest - rounded) ? option : nearest
  ), DEFAULT_UI_ZOOM_FACTOR);
}

export function getNextUiZoomPreference(
  currentPreference: number | null,
  currentEffectiveFactor: number,
  direction: 1 | -1,
): number {
  const current = sanitizeUiZoomPreference(currentPreference ?? currentEffectiveFactor) ?? DEFAULT_UI_ZOOM_FACTOR;
  const currentIndex = UI_ZOOM_FACTOR_OPTIONS.findIndex((option) => option === current);
  const fallbackIndex = UI_ZOOM_FACTOR_OPTIONS.findIndex((option) => option === DEFAULT_UI_ZOOM_FACTOR);
  const startIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
  const nextIndex = Math.min(
    UI_ZOOM_FACTOR_OPTIONS.length - 1,
    Math.max(0, startIndex + direction),
  );
  return UI_ZOOM_FACTOR_OPTIONS[nextIndex];
}

export function resolveAutomaticUiZoomFactor(metrics: UiZoomMetrics): {
  factor: number;
  reason: string;
} {
  if (metrics.platform !== 'win32') {
    return { factor: DEFAULT_UI_ZOOM_FACTOR, reason: 'default-non-windows' };
  }

  // Electron's display work area is already reported in DIP/CSS pixels after
  // OS display scaling, so it is the signal we care about for the automatic
  // first-run default. Do not key off the restored window bounds here: a normal
  // default-size window on a large monitor is not the same as a genuinely cramped
  // 14-inch/high-DPI Windows screen, and users can pick an explicit zoom if they
  // prefer a smaller manually-resized window.
  const effectiveWidth = metrics.workArea.width;
  const effectiveHeight = metrics.workArea.height;

  if (effectiveWidth <= 1366 || effectiveHeight <= 820) {
    return { factor: 0.9, reason: 'windows-small-work-area' };
  }

  if (effectiveWidth <= 1440 || effectiveHeight <= 900) {
    return { factor: 0.95, reason: 'windows-compact-work-area' };
  }

  return { factor: DEFAULT_UI_ZOOM_FACTOR, reason: 'windows-large-work-area' };
}

export function buildUiZoomState(
  preference: unknown,
  metrics: UiZoomMetrics,
): UiZoomState {
  const sanitizedPreference = sanitizeUiZoomPreference(preference);
  if (sanitizedPreference !== null) {
    return {
      factor: sanitizedPreference,
      preference: sanitizedPreference,
      source: 'user',
      reason: 'user-preference',
      options: [...UI_ZOOM_FACTOR_OPTIONS],
    };
  }

  const automatic = resolveAutomaticUiZoomFactor(metrics);
  return {
    factor: automatic.factor,
    preference: null,
    source: 'auto',
    reason: automatic.reason,
    options: [...UI_ZOOM_FACTOR_OPTIONS],
  };
}
