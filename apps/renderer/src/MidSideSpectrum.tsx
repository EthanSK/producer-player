import { useEffect, useRef, useCallback } from 'react';
import { frequencyToX } from './audioEngine';

interface MidSideSpectrumProps {
  analyserNodeL: AnalyserNode | null;
  analyserNodeR: AnalyserNode | null;
  width: number;
  height: number;
  isPlaying: boolean;
  isVisible: boolean;
}

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DB_MIN = -90;
const DB_MAX = -10;
const PADDING_LEFT = 44;
const PADDING_RIGHT = 12;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 30;

const FREQ_GRID_LINES = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const DB_GRID_LINES = [-80, -60, -40, -20];

function formatFrequency(freq: number): string {
  if (freq >= 1000) {
    return `${(freq / 1000).toFixed(freq >= 10000 ? 0 : freq % 1000 === 0 ? 0 : 1)}k`;
  }
  return `${freq}`;
}

export function MidSideSpectrum({
  analyserNodeL,
  analyserNodeR,
  width,
  height,
  isPlaying,
  isVisible,
}: MidSideSpectrumProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const smoothedMidRef = useRef<Float32Array | null>(null);
  const smoothedSideRef = useRef<Float32Array | null>(null);

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

    // Frequency grid
    ctx.textAlign = 'center';
    for (const freq of FREQ_GRID_LINES) {
      const x = plotLeft + frequencyToX(freq, plotWidth, MIN_FREQ, MAX_FREQ);
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
      ctx.fillStyle = '#6b8199';
      ctx.fillText(formatFrequency(freq), x, plotBottom + 14);
    }

    // dB grid
    ctx.textAlign = 'right';
    for (const db of DB_GRID_LINES) {
      const y = plotTop + ((DB_MAX - db) / (DB_MAX - DB_MIN)) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
      ctx.fillStyle = '#6b8199';
      ctx.fillText(`${db}`, plotLeft - 6, y + 3);
    }

    if (analyserNodeL && analyserNodeR) {
      const binCount = analyserNodeL.frequencyBinCount;
      const dataL = new Float32Array(binCount);
      const dataR = new Float32Array(binCount);
      analyserNodeL.getFloatFrequencyData(dataL);
      analyserNodeR.getFloatFrequencyData(dataR);

      // Compute Mid and Side from L/R frequency data
      // Mid = (L+R)/2, Side = (L-R)/2
      // In dB domain we need to convert to linear, combine, convert back
      const sampleRate = analyserNodeL.context.sampleRate;
      const fftSize = analyserNodeL.fftSize;
      const smoothing = 0.8;

      if (!smoothedMidRef.current || smoothedMidRef.current.length !== binCount) {
        smoothedMidRef.current = new Float32Array(binCount).fill(DB_MIN);
        smoothedSideRef.current = new Float32Array(binCount).fill(DB_MIN);
      }

      const midData = smoothedMidRef.current;
      const sideData = smoothedSideRef.current!;

      for (let i = 0; i < binCount; i++) {
        // Convert dB to linear amplitude
        const ampL = Math.pow(10, dataL[i] / 20);
        const ampR = Math.pow(10, dataR[i] / 20);

        const midAmp = (ampL + ampR) / 2;
        const sideAmp = (ampL - ampR) / 2;

        const midDb = midAmp > 0 ? 20 * Math.log10(Math.abs(midAmp)) : DB_MIN;
        const sideDb = Math.abs(sideAmp) > 0 ? 20 * Math.log10(Math.abs(sideAmp)) : DB_MIN;

        midData[i] = midData[i] * smoothing + midDb * (1 - smoothing);
        sideData[i] = sideData[i] * smoothing + sideDb * (1 - smoothing);
      }

      // Number of points to draw
      const pointCount = Math.min(512, plotWidth);

      // Draw Side first (behind Mid)
      const drawSpectrum = (data: Float32Array, color: string, fillColor: string) => {
        ctx.beginPath();
        let started = false;
        for (let p = 0; p < pointCount; p++) {
          const ratio = p / (pointCount - 1);
          const logMin = Math.log10(MIN_FREQ);
          const logMax = Math.log10(MAX_FREQ);
          const freq = Math.pow(10, logMin + ratio * (logMax - logMin));
          const binFloat = (freq * fftSize) / sampleRate;
          const binLow = Math.floor(binFloat);
          const binHigh = Math.ceil(binFloat);
          const frac = binFloat - binLow;

          let db: number;
          if (binLow < 0 || binHigh >= data.length) {
            db = DB_MIN;
          } else if (binLow === binHigh) {
            db = data[binLow];
          } else {
            db = data[binLow] * (1 - frac) + data[binHigh] * frac;
          }

          const x = plotLeft + ratio * plotWidth;
          const clampedDb = Math.max(DB_MIN, Math.min(DB_MAX, db));
          const y = plotTop + ((DB_MAX - clampedDb) / (DB_MAX - DB_MIN)) * plotHeight;

          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Fill under curve
        ctx.lineTo(plotRight, plotBottom);
        ctx.lineTo(plotLeft, plotBottom);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
      };

      drawSpectrum(sideData, '#f97316', 'rgba(249, 115, 22, 0.08)');
      drawSpectrum(midData, '#5ca7ff', 'rgba(92, 167, 255, 0.1)');
    }

    // Legend
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    const legendY = plotTop + 14;
    ctx.fillStyle = '#5ca7ff';
    ctx.fillRect(plotRight - 120, legendY - 8, 10, 3);
    ctx.fillStyle = '#c6d5e8';
    ctx.textAlign = 'left';
    ctx.fillText('Mid', plotRight - 106, legendY - 3);

    ctx.fillStyle = '#f97316';
    ctx.fillRect(plotRight - 60, legendY - 8, 10, 3);
    ctx.fillStyle = '#c6d5e8';
    ctx.fillText('Side', plotRight - 46, legendY - 3);

    if (isPlaying && isVisible) {
      animFrameRef.current = requestAnimationFrame(draw);
    }
  }, [analyserNodeL, analyserNodeR, width, height, isPlaying, isVisible]);

  useEffect(() => {
    if (isPlaying && isVisible) {
      animFrameRef.current = requestAnimationFrame(draw);
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
      data-testid="mid-side-spectrum"
    />
  );
}
