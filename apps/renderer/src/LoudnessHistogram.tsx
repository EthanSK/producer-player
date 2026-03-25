import { useEffect, useRef, useCallback } from 'react';
import { getRmsLevel } from './audioEngine';

interface LoudnessHistogramProps {
  analyserNode: AnalyserNode | null;
  width: number;
  height: number;
  isPlaying: boolean;
  isVisible: boolean;
}

const PADDING_LEFT = 44;
const PADDING_RIGHT = 12;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 30;

// LUFS bins from -60 to 0 in 1 dB increments
const BIN_MIN = -60;
const BIN_MAX = 0;
const BIN_SIZE = 1;
const BIN_COUNT = (BIN_MAX - BIN_MIN) / BIN_SIZE;

const SAMPLE_INTERVAL_MS = 250; // sample every 250ms (short-term LUFS approximation)

export function LoudnessHistogram({
  analyserNode,
  width,
  height,
  isPlaying,
  isVisible,
}: LoudnessHistogramProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const binsRef = useRef<number[]>(new Array(BIN_COUNT).fill(0));
  const totalSamplesRef = useRef<number>(0);
  const lastSampleTimeRef = useRef<number>(0);

  // Reset histogram when analyser changes (new track)
  useEffect(() => {
    binsRef.current = new Array(BIN_COUNT).fill(0);
    totalSamplesRef.current = 0;
  }, [analyserNode]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Sample loudness
    const now = performance.now();
    if (analyserNode && isPlaying && now - lastSampleTimeRef.current >= SAMPLE_INTERVAL_MS) {
      lastSampleTimeRef.current = now;
      const rmsDb = getRmsLevel(analyserNode);
      // Approximate LUFS offset (RMS to LUFS is roughly -0.691 for K-weighted, but we use raw RMS as approximation)
      const lufs = rmsDb;
      const binIndex = Math.floor((lufs - BIN_MIN) / BIN_SIZE);
      if (binIndex >= 0 && binIndex < BIN_COUNT) {
        binsRef.current[binIndex]++;
        totalSamplesRef.current++;
      }
    }

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

    // X-axis: LUFS values
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

    // Draw bars
    const bins = binsRef.current;
    const total = totalSamplesRef.current;
    const maxCount = Math.max(1, ...bins);
    const barWidth = plotWidth / BIN_COUNT;

    for (let i = 0; i < BIN_COUNT; i++) {
      if (bins[i] === 0) continue;

      const percentage = total > 0 ? bins[i] / total : 0;
      const barHeight = (bins[i] / maxCount) * plotHeight;
      const x = plotLeft + (i / BIN_COUNT) * plotWidth;
      const y = plotBottom - barHeight;

      // Color based on LUFS value
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
        ctx.fillText(
          `${(percentage * 100).toFixed(0)}%`,
          x + barWidth / 2,
          y - 4
        );
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
    ctx.fillText(`${total} samples`, plotRight, plotTop + 12);

    if (isPlaying && isVisible) {
      animFrameRef.current = requestAnimationFrame(draw);
    }
  }, [analyserNode, width, height, isPlaying, isVisible]);

  useEffect(() => {
    if (isPlaying && isVisible) {
      animFrameRef.current = requestAnimationFrame(draw);
    } else if (!isPlaying && isVisible) {
      // Draw once even when paused to show accumulated data
      draw();
    }
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [draw, isPlaying, isVisible]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, borderRadius: 8 }}
      data-testid="loudness-histogram"
    />
  );
}
