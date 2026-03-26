import { useEffect, useRef, useCallback } from 'react';

interface SpectrogramProps {
  analyserNode: AnalyserNode | null;
  width: number;
  height: number;
  isPlaying: boolean;
}

const PADDING_LEFT = 44;
const PADDING_RIGHT = 12;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 30;

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DB_MIN = -90;
const DB_MAX = -10;

const FREQ_GRID_LINES = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

function formatFrequency(freq: number): string {
  if (freq >= 1000) {
    return `${(freq / 1000).toFixed(freq >= 10000 ? 0 : freq % 1000 === 0 ? 0 : 1)}k`;
  }
  return `${freq}`;
}

// Map dB value to color (dark blue → green → yellow → red)
function dbToColor(db: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN)));

  if (t < 0.25) {
    // Dark blue to blue
    const s = t / 0.25;
    return [0, 0, Math.round(40 + s * 160)];
  } else if (t < 0.5) {
    // Blue to green
    const s = (t - 0.25) / 0.25;
    return [0, Math.round(s * 200), Math.round(200 * (1 - s))];
  } else if (t < 0.75) {
    // Green to yellow
    const s = (t - 0.5) / 0.25;
    return [Math.round(s * 255), 200, Math.round(200 * (1 - s) * 0)];
  } else {
    // Yellow to red
    const s = (t - 0.75) / 0.25;
    return [255, Math.round(200 * (1 - s)), 0];
  }
}

export function Spectrogram({
  analyserNode,
  width,
  height,
  isPlaying,
}: SpectrogramProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const spectrogramCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const columnIndexRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const prevAnalyserRef = useRef<AnalyserNode | null>(null);

  // Number of frequency rows we render (vertical resolution)
  const FREQ_ROWS = 256;
  const FRAME_INTERVAL_MS = 50; // ~20fps for spectrogram columns

  // Reset spectrogram when analyser changes (new track)
  useEffect(() => {
    if (analyserNode !== prevAnalyserRef.current) {
      prevAnalyserRef.current = analyserNode;
      columnIndexRef.current = 0;
      if (spectrogramCanvasRef.current) {
        const sCtx = spectrogramCanvasRef.current.getContext('2d');
        if (sCtx) {
          sCtx.clearRect(0, 0, spectrogramCanvasRef.current.width, spectrogramCanvasRef.current.height);
        }
      }
    }
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

    const plotLeft = PADDING_LEFT;
    const plotRight = width - PADDING_RIGHT;
    const plotTop = PADDING_TOP;
    const plotBottom = height - PADDING_BOTTOM;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;

    // Spectrogram buffer canvas (stores the scrolling image data)
    const spectroWidth = Math.floor(plotWidth);
    if (!spectrogramCanvasRef.current) {
      spectrogramCanvasRef.current = document.createElement('canvas');
      spectrogramCanvasRef.current.width = spectroWidth;
      spectrogramCanvasRef.current.height = FREQ_ROWS;
    }
    const sCanvas = spectrogramCanvasRef.current;
    if (sCanvas.width !== spectroWidth) {
      // Resize: reset
      sCanvas.width = spectroWidth;
      sCanvas.height = FREQ_ROWS;
      columnIndexRef.current = 0;
    }
    const sCtx = sCanvas.getContext('2d');

    // Add new column if playing
    const now = performance.now();
    if (analyserNode && isPlaying && sCtx && now - lastFrameTimeRef.current >= FRAME_INTERVAL_MS) {
      lastFrameTimeRef.current = now;

      const binCount = analyserNode.frequencyBinCount;
      const freqData = new Float32Array(binCount);
      analyserNode.getFloatFrequencyData(freqData);

      const sampleRate = analyserNode.context.sampleRate;
      const fftSize = analyserNode.fftSize;

      // Scroll: shift everything left by 1 pixel
      const imageData = sCtx.getImageData(1, 0, spectroWidth - 1, FREQ_ROWS);
      sCtx.putImageData(imageData, 0, 0);

      // Draw new column on the right edge
      const col = spectroWidth - 1;
      for (let row = 0; row < FREQ_ROWS; row++) {
        // Map row to frequency (logarithmic)
        const ratio = row / (FREQ_ROWS - 1);
        const logMin = Math.log10(MIN_FREQ);
        const logMax = Math.log10(MAX_FREQ);
        // Bottom = low freq, top = high freq
        const freq = Math.pow(10, logMin + (1 - ratio) * (logMax - logMin));

        // Get dB at this frequency via interpolation
        const binFloat = (freq * fftSize) / sampleRate;
        const binLow = Math.floor(binFloat);
        const binHigh = Math.ceil(binFloat);
        const frac = binFloat - binLow;
        let db: number;
        if (binLow < 0 || binHigh >= freqData.length) {
          db = DB_MIN;
        } else if (binLow === binHigh) {
          db = freqData[binLow];
        } else {
          db = freqData[binLow] * (1 - frac) + freqData[binHigh] * frac;
        }

        const [r, g, b] = dbToColor(db);
        sCtx.fillStyle = `rgb(${r},${g},${b})`;
        sCtx.fillRect(col, row, 1, 1);
      }

      columnIndexRef.current++;
    }

    // Background
    ctx.fillStyle = '#0a1018';
    ctx.fillRect(0, 0, width, height);

    // Draw the spectrogram buffer onto the main canvas
    if (sCanvas.width > 0 && sCanvas.height > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sCanvas, plotLeft, plotTop, plotWidth, plotHeight);
    }

    // Frequency grid labels (Y axis, logarithmic)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'right';
    const logMin = Math.log10(MIN_FREQ);
    const logMax = Math.log10(MAX_FREQ);

    for (const freq of FREQ_GRID_LINES) {
      const logRatio = (Math.log10(freq) - logMin) / (logMax - logMin);
      const y = plotBottom - logRatio * plotHeight;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
      ctx.fillStyle = '#6b8199';
      ctx.fillText(formatFrequency(freq), plotLeft - 6, y + 3);
    }

    // X-axis label
    ctx.fillStyle = '#6b8199';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Time (scrolling)', (plotLeft + plotRight) / 2, height - 4);

    // Color legend
    const legendWidth = 100;
    const legendHeight = 8;
    const legendX = plotRight - legendWidth - 4;
    const legendY = plotTop + 6;
    const legendGrad = ctx.createLinearGradient(legendX, 0, legendX + legendWidth, 0);
    legendGrad.addColorStop(0, 'rgb(0, 0, 40)');
    legendGrad.addColorStop(0.25, 'rgb(0, 0, 200)');
    legendGrad.addColorStop(0.5, 'rgb(0, 200, 0)');
    legendGrad.addColorStop(0.75, 'rgb(255, 200, 0)');
    legendGrad.addColorStop(1, 'rgb(255, 0, 0)');
    ctx.fillStyle = legendGrad;
    ctx.fillRect(legendX, legendY, legendWidth, legendHeight);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);

    ctx.fillStyle = '#6b8199';
    ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Quiet', legendX, legendY + legendHeight + 10);
    ctx.textAlign = 'right';
    ctx.fillText('Loud', legendX + legendWidth, legendY + legendHeight + 10);

    if (isPlaying) {
      animFrameRef.current = requestAnimationFrame(draw);
    }
  }, [analyserNode, width, height, isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      animFrameRef.current = requestAnimationFrame(draw);
    } else {
      // Draw once when paused to show current state
      draw();
    }
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [draw, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, borderRadius: 8 }}
      data-testid="spectrogram"
    />
  );
}
