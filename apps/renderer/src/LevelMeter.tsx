import { useEffect, useRef } from 'react';

interface LevelMeterProps {
  analyserNode: AnalyserNode | null;
  orientation?: 'horizontal' | 'vertical';
  width?: number;
  height?: number;
  showLabel?: boolean;
  isPlaying?: boolean;
}

const DB_MIN = -60;
const DB_MAX = 0;
const PEAK_HOLD_TIME_MS = 1500;
const PEAK_FALL_RATE_DB_PER_FRAME = 0.5;
const ATTACK_SMOOTHING = 0.15;  // Fast attack
const RELEASE_SMOOTHING = 0.92; // Slow release

function dbToNormalized(db: number): number {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return (clamped - DB_MIN) / (DB_MAX - DB_MIN);
}

export function LevelMeter({
  analyserNode,
  orientation = 'horizontal',
  width = 120,
  height = 20,
  showLabel = false,
  isPlaying = false,
}: LevelMeterProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const rmsLevelRef = useRef(DB_MIN);
  const peakLevelRef = useRef(DB_MIN);
  const peakHoldRef = useRef(DB_MIN);
  const peakHoldTimeRef = useRef(0);
  const hasReceivedDataRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const isHorizontal = orientation === 'horizontal';
    const meterThickness = isHorizontal ? height : width;

    // Render a single frame using current ref values
    const renderFrame = () => {
      const rmsNorm = dbToNormalized(rmsLevelRef.current);
      const peakNorm = dbToNormalized(peakLevelRef.current);
      const peakHoldNorm = dbToNormalized(peakHoldRef.current);

      // Clear
      ctx.clearRect(0, 0, width, height);

      // Background
      ctx.fillStyle = 'rgba(9, 14, 19, 0.6)';
      ctx.fillRect(0, 0, width, height);

      if (isHorizontal) {
        const meterH = showLabel ? Math.max(4, (height - 14) * 0.65) : Math.max(4, height * 0.55);
        const meterY = showLabel ? 12 : (height - meterH) / 2;
        const meterW = width - 4;
        const meterX = 2;

        // Groove background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.beginPath();
        ctx.roundRect(meterX, meterY, meterW, meterH, 3);
        ctx.fill();

        // RMS level bar with gradient
        const rmsWidth = rmsNorm * meterW;
        if (rmsWidth > 0.5) {
          const gradient = ctx.createLinearGradient(meterX, 0, meterX + meterW, 0);
          gradient.addColorStop(0, '#5fd28f');      // Green
          gradient.addColorStop(0.55, '#a8d850');    // Yellow-green
          gradient.addColorStop(0.75, '#f6b443');    // Yellow/orange
          gradient.addColorStop(0.9, '#ff7d7d');     // Red
          gradient.addColorStop(1, '#ff4444');        // Bright red

          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.roundRect(meterX, meterY, rmsWidth, meterH, 3);
          ctx.fill();

          // Subtle glow on the bar
          ctx.shadowBlur = 4;
          ctx.shadowColor = rmsNorm > 0.75 ? 'rgba(255, 125, 125, 0.4)' : 'rgba(95, 210, 143, 0.3)';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        // Peak level (slightly brighter, thinner overlay)
        const peakWidth = peakNorm * meterW;
        if (peakWidth > rmsWidth + 0.5) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.fillRect(meterX + rmsWidth, meterY, peakWidth - rmsWidth, meterH);
        }

        // Peak hold indicator (thin line)
        const holdX = meterX + peakHoldNorm * meterW;
        if (peakHoldNorm > 0.005) {
          ctx.fillStyle = peakHoldNorm > 0.9 ? '#ff4444' : peakHoldNorm > 0.75 ? '#f6b443' : '#ecf2f9';
          ctx.fillRect(holdX - 1, meterY, 2, meterH);
        }

        // Tick marks
        const ticks = [-48, -36, -24, -12, -6, 0];
        for (const tick of ticks) {
          const tickNorm = dbToNormalized(tick);
          const tickX = meterX + tickNorm * meterW;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.fillRect(tickX, meterY + meterH, 1, 3);
        }

        // dB label
        if (showLabel) {
          const displayDb = rmsLevelRef.current > DB_MIN + 1 ? rmsLevelRef.current.toFixed(1) : '-∞';
          ctx.fillStyle = rmsLevelRef.current > -6 ? '#ff7d7d' : '#9cafc4';
          ctx.font = '10px Inter, sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(`${displayDb} dB`, width - 4, 10);
        }
      } else {
        // Vertical meter
        const meterW = Math.max(4, width * 0.55);
        const meterX = (width - meterW) / 2;
        const meterH = height - 4;
        const meterY = 2;

        // Groove background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.beginPath();
        ctx.roundRect(meterX, meterY, meterW, meterH, 3);
        ctx.fill();

        // RMS level bar (drawn from bottom)
        const rmsHeight = rmsNorm * meterH;
        if (rmsHeight > 0.5) {
          const gradient = ctx.createLinearGradient(0, meterY + meterH, 0, meterY);
          gradient.addColorStop(0, '#5fd28f');
          gradient.addColorStop(0.55, '#a8d850');
          gradient.addColorStop(0.75, '#f6b443');
          gradient.addColorStop(0.9, '#ff7d7d');
          gradient.addColorStop(1, '#ff4444');

          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.roundRect(meterX, meterY + meterH - rmsHeight, meterW, rmsHeight, 3);
          ctx.fill();
        }

        // Peak hold indicator
        const holdY = meterY + meterH - peakHoldNorm * meterH;
        if (peakHoldNorm > 0.005) {
          ctx.fillStyle = peakHoldNorm > 0.9 ? '#ff4444' : peakHoldNorm > 0.75 ? '#f6b443' : '#ecf2f9';
          ctx.fillRect(meterX, holdY - 1, meterW, 2);
        }

        // dB scale labels for vertical meter
        const vertTicks = [-48, -36, -24, -12, -6, 0];
        ctx.font = '8px Inter, sans-serif';
        ctx.fillStyle = 'rgba(156, 175, 196, 0.5)';
        ctx.textAlign = 'right';
        for (const tick of vertTicks) {
          const tickNorm = dbToNormalized(tick);
          const tickY = meterY + meterH - tickNorm * meterH;
          ctx.fillText(`${tick}`, meterX - 2, tickY + 3);
        }
      }
    };

    if (!analyserNode) {
      // No analyser at all: draw empty state or frozen state
      if (hasReceivedDataRef.current) {
        renderFrame();
      } else {
        ctx.fillStyle = 'rgba(9, 14, 19, 0.6)';
        ctx.fillRect(0, 0, width, height);

        // Empty meter groove
        const grooveColor = 'rgba(255, 255, 255, 0.04)';
        if (isHorizontal) {
          ctx.fillStyle = grooveColor;
          const grooveH = Math.max(4, meterThickness * 0.5);
          const grooveY = (height - grooveH) / 2;
          ctx.fillRect(2, grooveY, width - 4, grooveH);
        } else {
          ctx.fillStyle = grooveColor;
          const grooveW = Math.max(4, meterThickness * 0.5);
          const grooveX = (width - grooveW) / 2;
          ctx.fillRect(grooveX, 2, grooveW, height - 4);
        }
      }
      return;
    }

    // If not playing, render a frozen frame with last known values
    if (!isPlaying) {
      if (hasReceivedDataRef.current) {
        renderFrame();
      } else {
        // Never played yet — show empty groove
        ctx.fillStyle = 'rgba(9, 14, 19, 0.6)';
        ctx.fillRect(0, 0, width, height);
        const grooveColor = 'rgba(255, 255, 255, 0.04)';
        if (isHorizontal) {
          ctx.fillStyle = grooveColor;
          const grooveH = Math.max(4, meterThickness * 0.5);
          const grooveY = (height - grooveH) / 2;
          ctx.fillRect(2, grooveY, width - 4, grooveH);
        } else {
          ctx.fillStyle = grooveColor;
          const grooveW = Math.max(4, meterThickness * 0.5);
          const grooveX = (width - grooveW) / 2;
          ctx.fillRect(grooveX, 2, grooveW, height - 4);
        }
      }
      return;
    }

    const timeDomainData = new Float32Array(analyserNode.fftSize);

    const draw = () => {
      if (!canvas || !ctx || !analyserNode) return;

      analyserNode.getFloatTimeDomainData(timeDomainData);

      // Calculate RMS and peak
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < timeDomainData.length; i++) {
        const sample = timeDomainData[i];
        sum += sample * sample;
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
      }

      const rmsRaw = Math.sqrt(sum / timeDomainData.length);
      const rmsDb = rmsRaw > 0 ? 20 * Math.log10(rmsRaw) : DB_MIN;
      const peakDb = peak > 0 ? 20 * Math.log10(peak) : DB_MIN;

      // Apply ballistics - fast attack, slow release
      if (rmsDb > rmsLevelRef.current) {
        rmsLevelRef.current = rmsLevelRef.current * ATTACK_SMOOTHING + rmsDb * (1 - ATTACK_SMOOTHING);
      } else {
        rmsLevelRef.current = rmsLevelRef.current * RELEASE_SMOOTHING + rmsDb * (1 - RELEASE_SMOOTHING);
      }

      if (peakDb > peakLevelRef.current) {
        peakLevelRef.current = peakDb;
      } else {
        peakLevelRef.current = peakLevelRef.current * RELEASE_SMOOTHING + peakDb * (1 - RELEASE_SMOOTHING);
      }

      // Peak hold
      const now = performance.now();
      if (peakDb >= peakHoldRef.current) {
        peakHoldRef.current = peakDb;
        peakHoldTimeRef.current = now;
      } else if (now - peakHoldTimeRef.current > PEAK_HOLD_TIME_MS) {
        peakHoldRef.current -= PEAK_FALL_RATE_DB_PER_FRAME;
        if (peakHoldRef.current < DB_MIN) {
          peakHoldRef.current = DB_MIN;
        }
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
    };
  }, [analyserNode, orientation, width, height, showLabel, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: '4px',
        display: 'block',
      }}
      data-testid={showLabel ? 'level-meter-full' : 'level-meter-mini'}
    />
  );
}
