import { useCallback, useEffect, useRef } from 'react';
import {
  FREQUENCY_BANDS,
  frequencyToX,
  xToFrequency,
  getBandIndexForFrequency,
} from './audioEngine';
import { useCrosshairOverlay, drawCrosshair } from './useCrosshairOverlay';
import { sampleSpectrumDbAtFrequency } from './graphHoverSampling';

interface SpectrumAnalyzerProps {
  analyserNode: AnalyserNode | null;
  width: number;
  height: number;
  isFullScreen?: boolean;
  isPlaying?: boolean;
  activeBands?: ReadonlySet<number>;
  onBandToggle?: (bandIndex: number, shiftKey: boolean) => void;
}

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DB_MIN = -90;
const DB_MAX = -10;

const FREQ_GRID_LINES = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const DB_GRID_LINES = [-80, -60, -40, -20];

const MINI_SPECTRUM_POINT_COUNT = 128;
const FULLSCREEN_SPECTRUM_POINT_DENSITY = 1.0;
const FULLSCREEN_SPECTRUM_MIN_POINT_COUNT = 512;
const FULLSCREEN_SPECTRUM_MAX_POINT_COUNT = 1536;

function formatFrequency(freq: number): string {
  if (freq >= 1000) {
    return `${(freq / 1000).toFixed(freq >= 10000 ? 0 : freq % 1000 === 0 ? 0 : 1)}k`;
  }
  return `${freq}`;
}

export function SpectrumAnalyzer({
  analyserNode,
  width,
  height,
  isFullScreen = false,
  isPlaying = false,
  activeBands,
  onBandToggle,
}: SpectrumAnalyzerProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const frequencyDataRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const smoothedDataRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const hasReceivedDataRef = useRef(false);
  const isBandToggleEnabled = typeof onBandToggle === 'function';

  const { mousePosRef } = useCrosshairOverlay({
    canvasRef,
    width,
    height,
    enabled: isFullScreen,
  });

  const dbToY = useCallback(
    (db: number, h: number): number => {
      const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
      return ((DB_MAX - clamped) / (DB_MAX - DB_MIN)) * h;
    },
    []
  );

  // Serialize activeBands for stable dependency tracking
  const activeBandsKey = activeBands ? Array.from(activeBands).sort().join(',') : '';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const fullScreenPointCount = Math.min(
      FULLSCREEN_SPECTRUM_MAX_POINT_COUNT,
      Math.max(
        FULLSCREEN_SPECTRUM_MIN_POINT_COUNT,
        Math.round(width * dpr * FULLSCREEN_SPECTRUM_POINT_DENSITY)
      )
    );

    if (!analyserNode) {
      // Draw empty state
      ctx.fillStyle = 'rgba(9, 14, 19, 0.6)';
      ctx.fillRect(0, 0, width, height);
      if (isFullScreen) {
        ctx.fillStyle = '#9cafc4';
        ctx.font = '13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Play a track to see the spectrum', width / 2, height / 2);
      }
      return;
    }

    const binCount = analyserNode.frequencyBinCount;
    if (!frequencyDataRef.current || frequencyDataRef.current.length !== binCount) {
      frequencyDataRef.current = new Float32Array(binCount);
    }
    if (!smoothedDataRef.current || smoothedDataRef.current.length !== binCount) {
      smoothedDataRef.current = new Float32Array(binCount);
      smoothedDataRef.current.fill(DB_MIN);
    }

    const sampleRate = analyserNode.context.sampleRate;
    const fftSize = analyserNode.fftSize;

    // Render one frame from smoothedDataRef (used by both live and frozen paths)
    const renderFrame = () => {
      const smoothed = smoothedDataRef.current!;

      // Clear
      ctx.clearRect(0, 0, width, height);

      // Background
      ctx.fillStyle = isFullScreen ? 'rgba(9, 14, 19, 0.85)' : 'rgba(9, 14, 19, 0.6)';
      ctx.fillRect(0, 0, width, height);

      const showBandSelectionUi = isBandToggleEnabled;

      // Draw selectable frequency-band regions (shared by fullscreen and mini player)
      if (showBandSelectionUi) {
        for (let i = 0; i < FREQUENCY_BANDS.length; i++) {
          const band = FREQUENCY_BANDS[i];
          const x1 = frequencyToX(band.minHz, width, MIN_FREQ, MAX_FREQ);
          const x2 = frequencyToX(band.maxHz, width, MIN_FREQ, MAX_FREQ);
          const isBandActive = activeBands?.has(i) ?? false;

          if (isBandActive) {
            ctx.fillStyle = isFullScreen ? 'rgba(92, 167, 255, 0.15)' : 'rgba(92, 167, 255, 0.22)';
            ctx.fillRect(x1, 0, x2 - x1, height);

            // Brighter border for active band
            ctx.strokeStyle = isFullScreen ? 'rgba(92, 167, 255, 0.6)' : 'rgba(92, 167, 255, 0.82)';
            ctx.lineWidth = isFullScreen ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(x1, 0);
            ctx.lineTo(x1, height);
            ctx.moveTo(x2, 0);
            ctx.lineTo(x2, height);
            ctx.stroke();
          } else {
            // Subtle alternating background
            ctx.fillStyle =
              i % 2 === 0
                ? isFullScreen
                  ? 'rgba(255, 255, 255, 0.015)'
                  : 'rgba(255, 255, 255, 0.03)'
                : isFullScreen
                  ? 'rgba(255, 255, 255, 0.005)'
                  : 'rgba(255, 255, 255, 0.015)';
            ctx.fillRect(x1, 0, x2 - x1, height);
          }

          // Band divider lines
          if (i > 0) {
            ctx.strokeStyle = isFullScreen ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x1, 0);
            ctx.lineTo(x1, height);
            ctx.stroke();
          }
        }
      }

      // Grid lines
      ctx.strokeStyle = isFullScreen ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;

      // Frequency grid
      for (const freq of FREQ_GRID_LINES) {
        const x = frequencyToX(freq, width, MIN_FREQ, MAX_FREQ);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();

        if (isFullScreen) {
          ctx.fillStyle = 'rgba(156, 175, 196, 0.5)';
          ctx.font = '10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(formatFrequency(freq), x, height - 4);
        }
      }

      // dB grid (full screen only)
      if (isFullScreen) {
        for (const db of DB_GRID_LINES) {
          const y = dbToY(db, height);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();

          ctx.fillStyle = 'rgba(156, 175, 196, 0.4)';
          ctx.font = '10px Inter, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(`${db}dB`, 4, y - 3);
        }
      }

      // Draw band labels in both fullscreen and mini modes for visible mini feedback
      if (showBandSelectionUi) {
        for (let i = 0; i < FREQUENCY_BANDS.length; i++) {
          const band = FREQUENCY_BANDS[i];
          const x1 = frequencyToX(band.minHz, width, MIN_FREQ, MAX_FREQ);
          const x2 = frequencyToX(band.maxHz, width, MIN_FREQ, MAX_FREQ);
          const cx = (x1 + x2) / 2;
          const isBandActive = activeBands?.has(i) ?? false;

          ctx.fillStyle = isBandActive
            ? isFullScreen
              ? 'rgba(92, 167, 255, 0.9)'
              : 'rgba(142, 210, 255, 1)'
            : isFullScreen
              ? 'rgba(156, 175, 196, 0.45)'
              : 'rgba(156, 175, 196, 0.62)';
          ctx.font = isBandActive
            ? isFullScreen
              ? 'bold 11px Inter, sans-serif'
              : '600 9px Inter, sans-serif'
            : isFullScreen
              ? '10px Inter, sans-serif'
              : '9px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(band.shortLabel, cx, isFullScreen ? 14 : 11);
        }
      }

      // Build spectrum curve path using logarithmic frequency mapping
      const numPoints = isFullScreen ? fullScreenPointCount : MINI_SPECTRUM_POINT_COUNT;
      const points: Array<{ x: number; y: number }> = [];

      for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const logMin = Math.log10(MIN_FREQ);
        const logMax = Math.log10(MAX_FREQ);
        const freq = Math.pow(10, logMin + t * (logMax - logMin));

        // Get interpolated dB value at this frequency
        const binFloat = (freq * fftSize) / sampleRate;
        const binLow = Math.floor(binFloat);
        const binHigh = Math.min(Math.ceil(binFloat), smoothed.length - 1);
        const frac = binFloat - binLow;

        let db: number;
        if (binLow >= 0 && binHigh < smoothed.length) {
          db = binLow === binHigh
            ? smoothed[binLow]
            : smoothed[binLow] * (1 - frac) + smoothed[binHigh] * frac;
        } else {
          db = DB_MIN;
        }

        const x = (i / (numPoints - 1)) * width;
        const y = dbToY(db, height);
        points.push({ x, y });
      }

      if (points.length > 1) {
        // Create gradient for the spectrum fill
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, 'rgba(92, 167, 255, 0.4)');
        gradient.addColorStop(0.3, 'rgba(61, 201, 224, 0.4)');
        gradient.addColorStop(0.6, 'rgba(61, 219, 184, 0.35)');
        gradient.addColorStop(1, 'rgba(142, 232, 107, 0.3)');

        const strokeGradient = ctx.createLinearGradient(0, 0, width, 0);
        strokeGradient.addColorStop(0, '#5ca7ff');
        strokeGradient.addColorStop(0.3, '#3dc9e0');
        strokeGradient.addColorStop(0.6, '#3ddbb8');
        strokeGradient.addColorStop(1, '#8ee86b');

        // Draw filled area under curve
        ctx.beginPath();
        ctx.moveTo(points[0].x, height);
        ctx.lineTo(points[0].x, points[0].y);

        // Use bezier curves for smooth interpolation
        for (let i = 1; i < points.length; i++) {
          const prev = points[i - 1];
          const curr = points[i];
          const cpx = (prev.x + curr.x) / 2;
          ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
        }

        ctx.lineTo(points[points.length - 1].x, height);
        ctx.closePath();

        // Vertical gradient for fill (brighter at top, faded at bottom)
        const fillGradient = ctx.createLinearGradient(0, 0, 0, height);
        fillGradient.addColorStop(0, 'rgba(92, 167, 255, 0.35)');
        fillGradient.addColorStop(0.5, 'rgba(92, 167, 255, 0.12)');
        fillGradient.addColorStop(1, 'rgba(92, 167, 255, 0.02)');

        ctx.fillStyle = fillGradient;
        ctx.fill();

        // Also draw the horizontal gradient fill on top
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        // Draw the curve stroke
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          const prev = points[i - 1];
          const curr = points[i];
          const cpx = (prev.x + curr.x) / 2;
          ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
        }

        ctx.strokeStyle = strokeGradient;
        ctx.lineWidth = isFullScreen ? 2 : 1.5;
        ctx.stroke();

        // Glow effect on the line
        ctx.shadowBlur = isFullScreen ? 8 : 4;
        ctx.shadowColor = 'rgba(92, 167, 255, 0.5)';
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Axis title labels in full screen
      if (isFullScreen) {
        ctx.fillStyle = 'rgba(156, 175, 196, 0.45)';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Frequency (Hz)', width / 2, height - 4);
        ctx.save();
        ctx.translate(10, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('dB', 0, 0);
        ctx.restore();
      }


      // Crosshair overlay (fullscreen only)
      if (isFullScreen) {
        const mPos = mousePosRef.current;
        if (mPos) {
          const clampedX = Math.max(0, Math.min(width, mPos.x));
          const freq = xToFrequency(clampedX, width, MIN_FREQ, MAX_FREQ);
          const freqLabel = freq >= 1000
            ? `${(freq / 1000).toFixed(2)}kHz`
            : `${Math.round(freq)}Hz`;

          // Sample the actual spectrum curve value at the hovered frequency.
          const sampledDb = Math.max(
            DB_MIN,
            Math.min(
              DB_MAX,
              sampleSpectrumDbAtFrequency(smoothed, freq, fftSize, sampleRate, DB_MIN)
            )
          );
          const sampledY = dbToY(sampledDb, height);
          const dbLabel = `${sampledDb.toFixed(1)}dB`;

          drawCrosshair(
            ctx,
            {
              x: clampedX,
              y: sampledY,
            },
            {
              plotLeft: 0,
              plotTop: 0,
              plotRight: width,
              plotBottom: height,
              xLabel: freqLabel,
              yLabel: dbLabel,
            }
          );
        }
      }
    };

    // Handle mouse-triggered redraws when paused
    const handleMouseRedraw = () => {
      if (!isPlaying && hasReceivedDataRef.current) {
        renderFrame();
      }
    };
    if (isFullScreen && canvas) {
      canvas.addEventListener('mousemove', handleMouseRedraw);
      canvas.addEventListener('mouseleave', handleMouseRedraw);
    }

    // If not playing, draw a single frozen frame (or empty state if never played)
    if (!isPlaying) {
      if (hasReceivedDataRef.current) {
        renderFrame();
      } else {
        // Never played yet — show empty state
        ctx.fillStyle = 'rgba(9, 14, 19, 0.6)';
        ctx.fillRect(0, 0, width, height);
        if (isFullScreen) {
          ctx.fillStyle = '#9cafc4';
          ctx.font = '13px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Play a track to see the spectrum', width / 2, height / 2);
        }
      }
      return;
    }

    // Live animation loop
    const draw = () => {
      if (!canvas || !ctx || !analyserNode) return;

      analyserNode.getFloatFrequencyData(frequencyDataRef.current!);
      const rawData = frequencyDataRef.current!;
      const smoothed = smoothedDataRef.current!;

      // Smooth the data for less jittery visualization
      const smoothing = 0.7;
      for (let i = 0; i < rawData.length; i++) {
        const val = Number.isFinite(rawData[i]) ? rawData[i] : DB_MIN;
        smoothed[i] = smoothed[i] * smoothing + val * (1 - smoothing);
      }

      hasReceivedDataRef.current = true;
      renderFrame();

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (isFullScreen && canvas) {
        canvas.removeEventListener('mousemove', handleMouseRedraw);
        canvas.removeEventListener('mouseleave', handleMouseRedraw);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    analyserNode,
    width,
    height,
    isFullScreen,
    isPlaying,
    activeBandsKey,
    isBandToggleEnabled,
    dbToY,
    mousePosRef,
  ]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onBandToggle) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const freq = xToFrequency(x, width, MIN_FREQ, MAX_FREQ);
      const bandIndex = getBandIndexForFrequency(freq);

      if (bandIndex >= 0) {
        onBandToggle(bandIndex, event.shiftKey);
      }
    },
    [onBandToggle, width]
  );

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: isFullScreen ? '10px' : '6px',
        display: 'block',
        cursor: isBandToggleEnabled ? (isFullScreen ? 'crosshair' : 'pointer') : 'default',
      }}
      onClick={handleClick}
      data-active-bands={activeBandsKey}
      data-testid={isFullScreen ? 'spectrum-analyzer-full' : 'spectrum-analyzer-mini'}
    />
  );
}
