import { useEffect, useMemo, useRef, useCallback } from 'react';

interface LoudnessHistogramProps {
  frameLoudnessDbfs: readonly number[];
  width: number;
  height: number;
  /**
   * When true, the histogram is showing the reference track's data. The
   * semantic per-bar colors (green sweet spot, red too-loud, etc.) are
   * preserved because they carry meaning — instead we frame the canvas
   * with an amber outline.
   */
  isReference?: boolean;
}

const PADDING_LEFT = 44;
const PADDING_RIGHT = 12;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 30;

// LUFS-like bins from -60 to 0 in 1 dB increments
const BIN_MIN = -60;
const BIN_MAX = 0;
const BIN_SIZE = 1;
const BIN_COUNT = (BIN_MAX - BIN_MIN) / BIN_SIZE;

export interface LoudnessHistogramData {
  bins: number[];
  totalSamples: number;
}

export function buildLoudnessHistogramData(
  frameLoudnessDbfs: readonly number[]
): LoudnessHistogramData {
  const bins = new Array(BIN_COUNT).fill(0);
  let totalSamples = 0;

  for (const frameLoudness of frameLoudnessDbfs) {
    if (!Number.isFinite(frameLoudness)) {
      continue;
    }

    const clamped = Math.max(BIN_MIN, Math.min(BIN_MAX, frameLoudness));
    const rawBinIndex = Math.floor((clamped - BIN_MIN) / BIN_SIZE);
    const binIndex = Math.max(0, Math.min(BIN_COUNT - 1, rawBinIndex));

    bins[binIndex] += 1;
    totalSamples += 1;
  }

  return { bins, totalSamples };
}

export function LoudnessHistogram({
  frameLoudnessDbfs,
  width,
  height,
  isReference = false,
}: LoudnessHistogramProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const histogramData = useMemo(
    () => buildLoudnessHistogramData(frameLoudnessDbfs),
    [frameLoudnessDbfs]
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const plotLeft = PADDING_LEFT;
    const plotRight = width - PADDING_RIGHT;
    const plotTop = PADDING_TOP;
    const plotBottom = height - PADDING_BOTTOM;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;

    // Background
    ctx.fillStyle = '#0a1018';
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';

    // X-axis: loudness values
    const lufsGridLines = [-50, -40, -30, -20, -10];
    ctx.textAlign = 'center';
    for (const lufs of lufsGridLines) {
      const x = plotLeft + ((lufs - BIN_MIN) / (BIN_MAX - BIN_MIN)) * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
      ctx.fillStyle = '#6b8199';
      ctx.fillText(`${lufs}`, x, plotBottom + 14);
    }

    const { bins, totalSamples } = histogramData;
    const maxCount = Math.max(1, ...bins);
    const barWidth = plotWidth / BIN_COUNT;

    for (let i = 0; i < BIN_COUNT; i++) {
      if (bins[i] === 0) continue;

      const percentage = totalSamples > 0 ? bins[i] / totalSamples : 0;
      const barHeight = (bins[i] / maxCount) * plotHeight;
      const x = plotLeft + (i / BIN_COUNT) * plotWidth;
      const y = plotBottom - barHeight;

      // Color based on loudness value
      const lufsValue = BIN_MIN + i * BIN_SIZE;
      let color: string;
      if (lufsValue >= -16 && lufsValue <= -6) {
        color = 'rgba(74, 222, 128, 0.7)'; // green — streaming sweet spot
      } else if (lufsValue >= -20 && lufsValue < -16) {
        color = 'rgba(92, 167, 255, 0.7)'; // blue — quiet but fine
      } else if (lufsValue > -6) {
        color = 'rgba(248, 113, 113, 0.7)'; // red — very loud
      } else {
        color = 'rgba(156, 175, 196, 0.4)'; // grey — very quiet
      }

      ctx.fillStyle = color;
      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);

      // Percentage label for tall bars
      if (percentage > 0.05 && barHeight > 16) {
        ctx.fillStyle = '#e0eaf5';
        ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${(percentage * 100).toFixed(0)}%`, x + barWidth / 2, y - 4);
      }
    }

    // Streaming range indicator
    const rangeLeft = plotLeft + ((-16 - BIN_MIN) / (BIN_MAX - BIN_MIN)) * plotWidth;
    const rangeRight = plotLeft + ((-6 - BIN_MIN) / (BIN_MAX - BIN_MIN)) * plotWidth;
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(rangeLeft, plotTop);
    ctx.lineTo(rangeLeft, plotBottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rangeRight, plotTop);
    ctx.lineTo(rangeRight, plotBottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // Range label
    ctx.fillStyle = 'rgba(74, 222, 128, 0.5)';
    ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Streaming range', (rangeLeft + rangeRight) / 2, plotTop + 12);

    // Y-axis label
    ctx.save();
    ctx.translate(10, (plotTop + plotBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#6b8199';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Frequency', 0, 0);
    ctx.restore();

    // X-axis label
    ctx.fillStyle = '#6b8199';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LUFS (dB)', (plotLeft + plotRight) / 2, height - 4);

    // Sample count
    ctx.fillStyle = '#6b8199';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${totalSamples} frames`, plotRight, plotTop + 12);
  }, [height, histogramData, width]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        borderRadius: 8,
        boxShadow: isReference
          ? '0 0 0 1px rgba(255, 180, 84, 0.55), inset 0 0 0 1px rgba(255, 180, 84, 0.15)'
          : undefined,
      }}
      data-testid="loudness-histogram"
    />
  );
}
