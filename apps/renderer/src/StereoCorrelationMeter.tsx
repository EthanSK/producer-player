import { useEffect, useRef } from 'react';

interface StereoCorrelationMeterProps {
  analyserNodeL: AnalyserNode | null;
  analyserNodeR: AnalyserNode | null;
  width: number;
  height: number;
  isPlaying: boolean;
}

const SMOOTHING = 0.85;

function getColor(correlation: number): string {
  if (correlation >= 0.5) return '#4ade80'; // green
  if (correlation >= 0) return '#fbbf24'; // yellow
  return '#f87171'; // red
}

export function StereoCorrelationMeter({
  analyserNodeL,
  analyserNodeR,
  width,
  height,
  isPlaying,
}: StereoCorrelationMeterProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const smoothedRef = useRef(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    let bufferL: Float32Array<ArrayBuffer> | null = null;
    let bufferR: Float32Array<ArrayBuffer> | null = null;

    const drawFrame = () => {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      ctx.fillStyle = 'rgba(9, 14, 19, 0.6)';
      ctx.fillRect(0, 0, width, height);

      if (!analyserNodeL || !analyserNodeR) {
        ctx.fillStyle = '#9cafc4';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Stereo correlation requires split channels', width / 2, height / 2);
        return;
      }

      const fftSize = analyserNodeL.fftSize;
      if (!bufferL || bufferL.length !== fftSize) {
        bufferL = new Float32Array(fftSize);
      }
      if (!bufferR || bufferR.length !== fftSize) {
        bufferR = new Float32Array(fftSize);
      }

      analyserNodeL.getFloatTimeDomainData(bufferL);
      analyserNodeR.getFloatTimeDomainData(bufferR);

      // Calculate correlation
      let sumLR = 0;
      let sumL2 = 0;
      let sumR2 = 0;

      for (let i = 0; i < fftSize; i++) {
        const l = bufferL[i];
        const r = bufferR[i];
        sumLR += l * r;
        sumL2 += l * l;
        sumR2 += r * r;
      }

      const denom = Math.sqrt(sumL2 * sumR2);
      const rawCorrelation = denom > 0 ? sumLR / denom : 1;
      smoothedRef.current = SMOOTHING * smoothedRef.current + (1 - SMOOTHING) * rawCorrelation;

      const correlation = smoothedRef.current;

      // Draw meter
      const meterY = 16;
      const meterH = Math.max(8, height - 32);
      const meterX = 28;
      const meterW = width - 56;

      // Background track
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.beginPath();
      ctx.roundRect(meterX, meterY, meterW, meterH, 4);
      ctx.fill();

      // Gradient background zones
      const gradient = ctx.createLinearGradient(meterX, 0, meterX + meterW, 0);
      gradient.addColorStop(0, 'rgba(248, 113, 113, 0.15)');
      gradient.addColorStop(0.25, 'rgba(251, 191, 36, 0.08)');
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.02)');
      gradient.addColorStop(0.75, 'rgba(74, 222, 128, 0.08)');
      gradient.addColorStop(1, 'rgba(74, 222, 128, 0.15)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(meterX, meterY, meterW, meterH, 4);
      ctx.fill();

      // Center line (0)
      const centerX = meterX + meterW * 0.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX, meterY);
      ctx.lineTo(centerX, meterY + meterH);
      ctx.stroke();

      // Indicator
      const indicatorX = meterX + ((correlation + 1) / 2) * meterW;
      const indicatorW = 4;
      ctx.fillStyle = getColor(correlation);
      ctx.shadowColor = getColor(correlation);
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.roundRect(indicatorX - indicatorW / 2, meterY + 1, indicatorW, meterH - 2, 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Labels
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = '#6b8199';
      ctx.textAlign = 'center';
      ctx.fillText('-1', meterX, height - 2);
      ctx.fillText('0', centerX, height - 2);
      ctx.fillText('+1', meterX + meterW, height - 2);

      // Value text
      ctx.font = '11px Inter, sans-serif';
      ctx.fillStyle = getColor(correlation);
      ctx.textAlign = 'right';
      ctx.fillText(correlation.toFixed(2), width - 2, 12);

      if (isPlaying) {
        animFrameRef.current = requestAnimationFrame(drawFrame);
      }
    };

    drawFrame();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [analyserNodeL, analyserNodeR, width, height, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block', borderRadius: 8 }}
      data-testid="stereo-correlation-meter"
    />
  );
}
