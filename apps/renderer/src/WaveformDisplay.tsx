import { useEffect, useRef, useCallback } from 'react';
import type { TrackAnalysisResult } from './audioAnalysis';

interface WaveformDisplayProps {
  /** Pre-computed waveform peaks (downsampled) */
  waveformPeaks: Float32Array | null;
  analysis: TrackAnalysisResult | null;
  currentTimeSeconds: number;
  durationSeconds: number;
  isPlaying: boolean;
  width: number;
  height: number;
}

const PADDING_LEFT = 4;
const PADDING_RIGHT = 4;
const PADDING_TOP = 4;
const PADDING_BOTTOM = 4;

/**
 * Downsample an AudioBuffer's channel data to a fixed number of visual peaks.
 * Returns a Float32Array where each entry is the max absolute value for that bucket.
 */
export function computeWaveformPeaks(
  channelData: Float32Array,
  bucketCount: number
): Float32Array {
  const peaks = new Float32Array(bucketCount);
  const samplesPerBucket = channelData.length / bucketCount;

  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * samplesPerBucket);
    const end = Math.min(Math.floor((b + 1) * samplesPerBucket), channelData.length);
    let maxAbs = 0;

    for (let i = start; i < end; i++) {
      const abs = Math.abs(channelData[i]);
      if (abs > maxAbs) maxAbs = abs;
    }

    peaks[b] = maxAbs;
  }

  return peaks;
}

export function WaveformDisplay({
  waveformPeaks,
  analysis,
  currentTimeSeconds,
  durationSeconds,
  isPlaying,
  width,
  height,
}: WaveformDisplayProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const plotW = width - PADDING_LEFT - PADDING_RIGHT;
    const plotH = height - PADDING_TOP - PADDING_BOTTOM;
    const centerY = PADDING_TOP + plotH / 2;

    // Background
    ctx.fillStyle = 'rgba(9, 14, 19, 0.6)';
    ctx.fillRect(0, 0, width, height);

    if (!waveformPeaks || waveformPeaks.length === 0) {
      ctx.fillStyle = '#9cafc4';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waveform not available', width / 2, height / 2);
      return;
    }

    // Center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING_LEFT, centerY);
    ctx.lineTo(PADDING_LEFT + plotW, centerY);
    ctx.stroke();

    // Determine playback position ratio
    const effectiveDuration = durationSeconds > 0 ? durationSeconds : (analysis?.durationSeconds ?? 0);
    const playRatio = effectiveDuration > 0 ? currentTimeSeconds / effectiveDuration : 0;
    const playX = PADDING_LEFT + playRatio * plotW;

    // Draw waveform bars
    const barCount = waveformPeaks.length;
    const barWidth = plotW / barCount;

    for (let i = 0; i < barCount; i++) {
      const x = PADDING_LEFT + (i / barCount) * plotW;
      const peak = waveformPeaks[i];
      const barH = peak * (plotH / 2);

      // Color based on playback position
      const isPast = x < playX;
      ctx.fillStyle = isPast
        ? 'rgba(92, 167, 255, 0.8)'
        : 'rgba(92, 167, 255, 0.3)';

      // Draw symmetrical bar
      ctx.fillRect(x, centerY - barH, Math.max(1, barWidth - 0.5), barH * 2);
    }

    // Playback position line
    if (currentTimeSeconds > 0 && effectiveDuration > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playX, PADDING_TOP);
      ctx.lineTo(playX, PADDING_TOP + plotH);
      ctx.stroke();
    }
  }, [waveformPeaks, analysis, currentTimeSeconds, durationSeconds, width, height]);

  useEffect(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }

    const tick = () => {
      drawWaveform();
      if (isPlaying) {
        animFrameRef.current = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [drawWaveform, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block', borderRadius: 8 }}
      data-testid="waveform-display"
    />
  );
}
