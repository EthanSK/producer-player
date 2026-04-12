import {
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useState,
  type CSSProperties,
} from 'react';

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
// Extra headroom so the "12%" style labels drawn above the tallest bar
// never clip against the top edge of the canvas.
const PADDING_TOP = 26;
const PADDING_BOTTOM = 34;

// LUFS-like bins from -60 to 0 in 1 dB increments
const BIN_MIN = -60;
const BIN_MAX = 0;
const BIN_SIZE = 1;
const BIN_COUNT = (BIN_MAX - BIN_MIN) / BIN_SIZE;

// Tick every 5 LUFS from -40 to 0 (dense, easy to read).
const X_AXIS_TICKS: readonly number[] = [
  -60, -55, -50, -45, -40, -35, -30, -25, -20, -15, -10, -5, 0,
];

// Subtle percentage gridlines on the Y axis (0, 5, 10, 15, …%).
const Y_GRID_STEP_PERCENT = 5;

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

interface BarColor {
  fill: string;
  hoverFill: string;
  border: string;
}

function colorForLufs(lufsValue: number): BarColor {
  if (lufsValue >= -16 && lufsValue <= -6) {
    // green — streaming sweet spot
    return {
      fill: 'rgba(74, 222, 128, 0.7)',
      hoverFill: 'rgba(134, 239, 172, 0.95)',
      border: 'rgba(187, 247, 208, 1)',
    };
  }
  if (lufsValue >= -20 && lufsValue < -16) {
    // blue — quiet but fine
    return {
      fill: 'rgba(92, 167, 255, 0.7)',
      hoverFill: 'rgba(147, 197, 253, 0.95)',
      border: 'rgba(191, 219, 254, 1)',
    };
  }
  if (lufsValue > -6) {
    // red — very loud
    return {
      fill: 'rgba(248, 113, 113, 0.7)',
      hoverFill: 'rgba(252, 165, 165, 0.95)',
      border: 'rgba(254, 202, 202, 1)',
    };
  }
  // grey — very quiet
  return {
    fill: 'rgba(156, 175, 196, 0.4)',
    hoverFill: 'rgba(203, 213, 225, 0.85)',
    border: 'rgba(226, 232, 240, 0.95)',
  };
}

interface HoverState {
  binIndex: number;
  clientX: number;
  clientY: number;
}

export function LoudnessHistogram({
  frameLoudnessDbfs,
  width,
  height,
  isReference = false,
}: LoudnessHistogramProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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

    const { bins, totalSamples } = histogramData;
    const maxCount = Math.max(1, ...bins);
    // Peak share — used for Y axis % gridlines.
    const maxPercent = totalSamples > 0 ? (maxCount / totalSamples) * 100 : 0;

    // ----- Y axis percentage gridlines (faint, every 5%) -----
    if (maxPercent > 0) {
      // Round up max to the nearest 5% for a clean top reference.
      const topPercent =
        Math.max(Y_GRID_STEP_PERCENT, Math.ceil(maxPercent / Y_GRID_STEP_PERCENT) * Y_GRID_STEP_PERCENT);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(107, 129, 153, 0.75)';

      for (let p = 0; p <= topPercent; p += Y_GRID_STEP_PERCENT) {
        // Map percent → y using the same scale the bars use (maxCount → plotTop).
        const scaledMax = (topPercent / 100) * totalSamples;
        const countAtP = (p / 100) * totalSamples;
        const y = plotBottom - (countAtP / scaledMax) * plotHeight;

        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();

        if (p > 0) {
          ctx.fillText(`${p}%`, plotLeft - 6, y);
        }
      }
      ctx.textBaseline = 'alphabetic';
    }

    // ----- X axis vertical gridlines + LUFS labels every 5 LUFS -----
    ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    for (const lufs of X_AXIS_TICKS) {
      const x = plotLeft + ((lufs - BIN_MIN) / (BIN_MAX - BIN_MIN)) * plotWidth;
      ctx.strokeStyle = lufs % 10 === 0
        ? 'rgba(255, 255, 255, 0.08)'
        : 'rgba(255, 255, 255, 0.04)';
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
      ctx.fillStyle = lufs % 10 === 0 ? '#8ea7bf' : '#5a6f86';
      ctx.fillText(`${lufs}`, x, plotBottom + 13);
    }

    // Baseline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.moveTo(plotLeft, plotBottom);
    ctx.lineTo(plotRight, plotBottom);
    ctx.stroke();

    // ----- Bars -----
    // Use same rounded-up scale so bars and gridlines agree.
    const topPercent =
      maxPercent > 0
        ? Math.max(Y_GRID_STEP_PERCENT, Math.ceil(maxPercent / Y_GRID_STEP_PERCENT) * Y_GRID_STEP_PERCENT)
        : Y_GRID_STEP_PERCENT;
    const scaledMax = totalSamples > 0 ? (topPercent / 100) * totalSamples : maxCount;
    const barWidth = plotWidth / BIN_COUNT;

    for (let i = 0; i < BIN_COUNT; i++) {
      if (bins[i] === 0) continue;

      const percentage = totalSamples > 0 ? bins[i] / totalSamples : 0;
      const barHeight = (bins[i] / scaledMax) * plotHeight;
      const x = plotLeft + (i / BIN_COUNT) * plotWidth;
      const y = plotBottom - barHeight;

      const lufsValue = BIN_MIN + i * BIN_SIZE;
      const palette = colorForLufs(lufsValue);
      const isHovered = hover?.binIndex === i;

      ctx.fillStyle = isHovered ? palette.hoverFill : palette.fill;
      const drawW = Math.max(1, barWidth - 1);
      ctx.fillRect(x, y, drawW, barHeight);

      if (isHovered) {
        ctx.strokeStyle = palette.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, drawW - 1, Math.max(0, barHeight - 1));
      }

      // Percentage label: inside the bar if tall enough, otherwise above.
      // Top padding guarantees the above-case is never clipped.
      if (percentage >= 0.05) {
        ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        const label = `${(percentage * 100).toFixed(0)}%`;
        if (barHeight >= 22) {
          ctx.fillStyle = 'rgba(10, 16, 24, 0.9)';
          ctx.fillText(label, x + barWidth / 2, y + 11);
        } else {
          ctx.fillStyle = '#e0eaf5';
          ctx.fillText(label, x + barWidth / 2, y - 4);
        }
      }
    }

    // ----- Streaming range indicator -----
    const rangeLeft =
      plotLeft + ((-16 - BIN_MIN) / (BIN_MAX - BIN_MIN)) * plotWidth;
    const rangeRight =
      plotLeft + ((-6 - BIN_MIN) / (BIN_MAX - BIN_MIN)) * plotWidth;

    ctx.fillStyle = 'rgba(74, 222, 128, 0.06)';
    ctx.fillRect(rangeLeft, plotTop, rangeRight - rangeLeft, plotHeight);

    ctx.strokeStyle = 'rgba(74, 222, 128, 0.35)';
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

    // Range label — sits above the plot area in the new headroom.
    ctx.fillStyle = 'rgba(134, 239, 172, 0.75)';
    ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Streaming range', (rangeLeft + rangeRight) / 2, plotTop - 10);

    // ----- Y axis label -----
    ctx.save();
    ctx.translate(12, (plotTop + plotBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#6b8199';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Frequency', 0, 0);
    ctx.restore();

    // ----- X axis label -----
    ctx.fillStyle = '#6b8199';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LUFS (dB)', (plotLeft + plotRight) / 2, height - 4);

    // ----- Sample count -----
    ctx.fillStyle = '#6b8199';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${totalSamples} frames`, plotRight, plotTop - 10);
  }, [height, histogramData, hover, width]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      const plotLeft = PADDING_LEFT;
      const plotRight = width - PADDING_RIGHT;
      const plotTop = PADDING_TOP;
      const plotBottom = height - PADDING_BOTTOM;

      if (
        mouseX < plotLeft ||
        mouseX > plotRight ||
        mouseY < plotTop ||
        mouseY > plotBottom
      ) {
        if (hover !== null) setHover(null);
        return;
      }

      const plotWidth = plotRight - plotLeft;
      const relative = (mouseX - plotLeft) / plotWidth;
      const binIndex = Math.max(
        0,
        Math.min(BIN_COUNT - 1, Math.floor(relative * BIN_COUNT))
      );

      const containerRect = container.getBoundingClientRect();
      setHover({
        binIndex,
        clientX: event.clientX - containerRect.left,
        clientY: event.clientY - containerRect.top,
      });
    },
    [height, hover, width]
  );

  const handleMouseLeave = useCallback(() => {
    setHover(null);
  }, []);

  // Compute tooltip content.
  const tooltip = useMemo(() => {
    if (!hover) return null;
    const { bins, totalSamples } = histogramData;
    const i = hover.binIndex;
    const count = bins[i] ?? 0;
    const lowLufs = BIN_MIN + i * BIN_SIZE;
    const highLufs = lowLufs + BIN_SIZE;
    const percent = totalSamples > 0 ? (count / totalSamples) * 100 : 0;
    return {
      label: `${lowLufs} to ${highLufs} LUFS`,
      percent,
      count,
      hasData: count > 0,
    };
  }, [histogramData, hover]);

  const containerStyle: CSSProperties = {
    position: 'relative',
    width,
    height,
    display: 'inline-block',
  };

  const canvasStyle: CSSProperties = {
    width,
    height,
    borderRadius: 8,
    boxShadow: isReference
      ? '0 0 0 1px rgba(255, 180, 84, 0.55), inset 0 0 0 1px rgba(255, 180, 84, 0.15)'
      : undefined,
    cursor: hover ? 'crosshair' : 'default',
    display: 'block',
  };

  // Position the tooltip above-right of the cursor, but clamp so it never
  // leaves the canvas bounds.
  const TOOLTIP_WIDTH = 160;
  const TOOLTIP_HEIGHT = 54;
  const TOOLTIP_OFFSET = 14;
  let tooltipLeft = 0;
  let tooltipTop = 0;
  if (hover) {
    tooltipLeft = hover.clientX + TOOLTIP_OFFSET;
    tooltipTop = hover.clientY - TOOLTIP_HEIGHT - TOOLTIP_OFFSET;
    if (tooltipLeft + TOOLTIP_WIDTH > width) {
      tooltipLeft = hover.clientX - TOOLTIP_WIDTH - TOOLTIP_OFFSET;
    }
    if (tooltipLeft < 0) tooltipLeft = 4;
    if (tooltipTop < 0) tooltipTop = hover.clientY + TOOLTIP_OFFSET;
    if (tooltipTop + TOOLTIP_HEIGHT > height) {
      tooltipTop = Math.max(0, height - TOOLTIP_HEIGHT - 4);
    }
  }

  const tooltipStyle: CSSProperties = {
    position: 'absolute',
    left: tooltipLeft,
    top: tooltipTop,
    width: TOOLTIP_WIDTH,
    pointerEvents: 'none',
    background: 'rgba(10, 16, 24, 0.94)',
    border: '1px solid rgba(142, 167, 191, 0.35)',
    borderRadius: 6,
    padding: '6px 9px',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
    fontSize: 11,
    lineHeight: 1.35,
    color: '#e0eaf5',
    transition: 'opacity 80ms ease-out',
    opacity: 1,
    zIndex: 2,
  };

  return (
    <div ref={containerRef} style={containerStyle} data-testid="loudness-histogram-container">
      <canvas
        ref={canvasRef}
        style={canvasStyle}
        data-testid="loudness-histogram"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {hover && tooltip ? (
        <div style={tooltipStyle} role="tooltip" data-testid="loudness-histogram-tooltip">
          <div style={{ fontWeight: 600, color: '#f5f9ff' }}>{tooltip.label}</div>
          {tooltip.hasData ? (
            <div style={{ color: '#bccbdc' }}>
              {tooltip.percent.toFixed(1)}%{' '}
              <span style={{ color: '#6b8199' }}>
                ({tooltip.count} {tooltip.count === 1 ? 'frame' : 'frames'})
              </span>
            </div>
          ) : (
            <div style={{ color: '#6b8199' }}>no frames in this bin</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
