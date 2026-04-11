import { useEffect, useRef, useCallback } from 'react';
import { getTimeDomainData } from './audioEngine';

interface CrestFactorGraphProps {
  analyserNode: AnalyserNode | null;
  width: number;
  height: number;
  isPlaying: boolean;
  /**
   * When true, the user is monitoring the reference track. The traffic-light
   * color semantics (red/yellow/green for crushed/moderate/healthy) are kept
   * because they carry meaning, but a warm amber outline is drawn around
   * the canvas frame to signal "this is the reference".
   */
  isReference?: boolean;
}

const PADDING_LEFT = 44;
const PADDING_RIGHT = 12;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 24;
const MAX_HISTORY_SECONDS = 30;
const SAMPLE_INTERVAL_MS = 100;
const DB_MIN = 0;
const DB_MAX = 20;

interface CrestSample {
  crestDb: number;
  timestamp: number;
}

export function CrestFactorGraph({
  analyserNode,
  width,
  height,
  isPlaying,
  isReference = false,
}: CrestFactorGraphProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const redrawAfterScrollRafRef = useRef<number | null>(null);
  const historyRef = useRef<CrestSample[]>([]);
  const lastSampleTimeRef = useRef<number>(0);

  const getColor = useCallback((crestDb: number): string => {
    if (crestDb >= 8) return '#4ade80'; // green — healthy
    if (crestDb >= 6) return '#fbbf24'; // yellow — moderate
    return '#f87171'; // red — crushed
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Sample crest factor
    const now = performance.now();
    if (analyserNode && isPlaying && now - lastSampleTimeRef.current >= SAMPLE_INTERVAL_MS) {
      lastSampleTimeRef.current = now;
      const timeDomain = getTimeDomainData(analyserNode);

      let peak = 0;
      let sumSquares = 0;
      for (let i = 0; i < timeDomain.length; i++) {
        const sample = timeDomain[i];
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / timeDomain.length);
      const peakDb = peak > 0 ? 20 * Math.log10(peak) : -96;
      const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -96;
      const crestDb = Math.max(0, peakDb - rmsDb);

      historyRef.current.push({ crestDb, timestamp: now });

      // Trim old samples
      const cutoff = now - MAX_HISTORY_SECONDS * 1000;
      while (historyRef.current.length > 0 && historyRef.current[0].timestamp < cutoff) {
        historyRef.current.shift();
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

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'right';

    const dbGridLines = [2, 4, 6, 8, 10, 12, 14, 16, 18];
    for (const db of dbGridLines) {
      const y = plotBottom - ((db - DB_MIN) / (DB_MAX - DB_MIN)) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
      ctx.fillStyle = '#6b8199';
      ctx.fillText(`${db}`, plotLeft - 6, y + 3);
    }

    // Threshold zones
    // Red zone: < 6 dB
    const y6 = plotBottom - ((6 - DB_MIN) / (DB_MAX - DB_MIN)) * plotHeight;
    const y8 = plotBottom - ((8 - DB_MIN) / (DB_MAX - DB_MIN)) * plotHeight;
    ctx.fillStyle = 'rgba(248, 113, 113, 0.06)';
    ctx.fillRect(plotLeft, y6, plotWidth, plotBottom - y6);
    // Yellow zone: 6-8 dB
    ctx.fillStyle = 'rgba(251, 191, 36, 0.06)';
    ctx.fillRect(plotLeft, y8, plotWidth, y6 - y8);
    // Green zone: > 8 dB
    ctx.fillStyle = 'rgba(74, 222, 128, 0.04)';
    ctx.fillRect(plotLeft, plotTop, plotWidth, y8 - plotTop);

    // Threshold lines
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.4)';
    ctx.beginPath();
    ctx.moveTo(plotLeft, y6);
    ctx.lineTo(plotRight, y6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)';
    ctx.beginPath();
    ctx.moveTo(plotLeft, y8);
    ctx.lineTo(plotRight, y8);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw line graph
    const history = historyRef.current;
    if (history.length > 1) {
      const latestTime = history[history.length - 1].timestamp;
      const startTime = latestTime - MAX_HISTORY_SECONDS * 1000;

      ctx.beginPath();
      let started = false;

      for (let i = 0; i < history.length; i++) {
        const sample = history[i];
        const x = plotLeft + ((sample.timestamp - startTime) / (MAX_HISTORY_SECONDS * 1000)) * plotWidth;
        const y = plotBottom - ((Math.min(DB_MAX, Math.max(DB_MIN, sample.crestDb)) - DB_MIN) / (DB_MAX - DB_MIN)) * plotHeight;

        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }

      // Gradient stroke
      const gradient = ctx.createLinearGradient(0, plotBottom, 0, plotTop);
      gradient.addColorStop(0, '#f87171');
      gradient.addColorStop(0.3, '#fbbf24');
      gradient.addColorStop(0.5, '#4ade80');
      gradient.addColorStop(1, '#4ade80');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Fill under the curve
      if (history.length > 1) {
        const lastSample = history[history.length - 1];
        const lastX = plotLeft + ((lastSample.timestamp - startTime) / (MAX_HISTORY_SECONDS * 1000)) * plotWidth;
        ctx.lineTo(lastX, plotBottom);
        const firstSample = history[0];
        const firstX = plotLeft + ((firstSample.timestamp - startTime) / (MAX_HISTORY_SECONDS * 1000)) * plotWidth;
        ctx.lineTo(firstX, plotBottom);
        ctx.closePath();
        const fillGradient = ctx.createLinearGradient(0, plotBottom, 0, plotTop);
        fillGradient.addColorStop(0, 'rgba(248, 113, 113, 0.08)');
        fillGradient.addColorStop(0.3, 'rgba(251, 191, 36, 0.08)');
        fillGradient.addColorStop(0.5, 'rgba(74, 222, 128, 0.06)');
        fillGradient.addColorStop(1, 'rgba(74, 222, 128, 0.04)');
        ctx.fillStyle = fillGradient;
        ctx.fill();
      }

      // Current value indicator
      if (history.length > 0) {
        const current = history[history.length - 1];
        const cx = plotLeft + ((current.timestamp - startTime) / (MAX_HISTORY_SECONDS * 1000)) * plotWidth;
        const cy = plotBottom - ((Math.min(DB_MAX, Math.max(DB_MIN, current.crestDb)) - DB_MIN) / (DB_MAX - DB_MIN)) * plotHeight;
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = getColor(current.crestDb);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Value label
        ctx.fillStyle = getColor(current.crestDb);
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${current.crestDb.toFixed(1)} dB`, cx + 8, cy + 4);
      }
    }

    // X-axis label
    ctx.fillStyle = '#6b8199';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Time (last 30s)', (plotLeft + plotRight) / 2, height - 4);

    // Y-axis label
    ctx.save();
    ctx.translate(10, (plotTop + plotBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#6b8199';
    ctx.textAlign = 'center';
    ctx.fillText('Crest (dB)', 0, 0);
    ctx.restore();

    if (isPlaying) {
      animFrameRef.current = requestAnimationFrame(draw);
    }
  }, [analyserNode, width, height, isPlaying, getColor]);

  useEffect(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }

    if (isPlaying) {
      animFrameRef.current = requestAnimationFrame(draw);
    } else {
      // Keep a rendered frame when paused so the graph doesn't blank after scroll reflow.
      draw();
    }

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
    };
  }, [draw, isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      return;
    }

    const scheduleRedraw = () => {
      if (redrawAfterScrollRafRef.current !== null) {
        return;
      }

      redrawAfterScrollRafRef.current = requestAnimationFrame(() => {
        redrawAfterScrollRafRef.current = null;
        draw();
      });
    };

    window.addEventListener('scroll', scheduleRedraw, true);
    window.addEventListener('resize', scheduleRedraw);

    return () => {
      window.removeEventListener('scroll', scheduleRedraw, true);
      window.removeEventListener('resize', scheduleRedraw);
      if (redrawAfterScrollRafRef.current !== null) {
        cancelAnimationFrame(redrawAfterScrollRafRef.current);
        redrawAfterScrollRafRef.current = null;
      }
    };
  }, [draw, isPlaying]);

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
      data-testid="crest-factor-graph"
    />
  );
}
