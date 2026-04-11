import { useEffect, useRef, useCallback } from 'react';
import type { TrackAnalysisResult } from './audioAnalysis';
import { useCrosshairOverlay, drawCrosshair } from './useCrosshairOverlay';
import { sampleSeriesAtRatio } from './graphHoverSampling';

interface WaveformDisplayProps {
  /** Pre-computed waveform peaks (downsampled) */
  waveformPeaks: Float32Array | null;
  analysis: TrackAnalysisResult | null;
  currentTimeSeconds: number;
  durationSeconds: number;
  isPlaying: boolean;
  width: number;
  height: number;
  /** Called when the user clicks on the waveform to seek to a time position. */
  onSeek?: (timeSeconds: number) => void;
  /** When true, the waveform belongs to the reference track — render amber instead of blue. */
  isReference?: boolean;
}

/** Color stops for the waveform bars — blue for mix, amber for reference. */
const WAVEFORM_MIX_PAST = 'rgba(92, 167, 255, 0.8)';
const WAVEFORM_MIX_FUTURE = 'rgba(92, 167, 255, 0.3)';
const WAVEFORM_REF_PAST = 'rgba(255, 180, 84, 0.85)';
const WAVEFORM_REF_FUTURE = 'rgba(255, 180, 84, 0.32)';

const PADDING_LEFT = 30;
const PADDING_RIGHT = 4;
const PADDING_TOP = 4;
const PADDING_BOTTOM = 18;

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
  onSeek,
  isReference = false,
}: WaveformDisplayProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  const pastColor = isReference ? WAVEFORM_REF_PAST : WAVEFORM_MIX_PAST;
  const futureColor = isReference ? WAVEFORM_REF_FUTURE : WAVEFORM_MIX_FUTURE;

  const { mousePosRef } = useCrosshairOverlay({
    canvasRef,
    width,
    height,
  });

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const effectiveDuration = durationSeconds > 0 ? durationSeconds : (analysis?.durationSeconds ?? 0);
      if (!onSeek || !waveformPeaks || waveformPeaks.length === 0 || effectiveDuration <= 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const plotW = width - PADDING_LEFT - PADDING_RIGHT;
      const clampedX = Math.max(PADDING_LEFT, Math.min(PADDING_LEFT + plotW, x));
      const timeAtClick = ((clampedX - PADDING_LEFT) / plotW) * effectiveDuration;
      onSeek(Math.max(0, Math.min(effectiveDuration, timeAtClick)));
    },
    [onSeek, waveformPeaks, analysis, durationSeconds, width]
  );

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

    // Amplitude scale labels on Y axis
    ctx.font = '9px Inter, sans-serif';
    ctx.fillStyle = 'rgba(156, 175, 196, 0.5)';
    ctx.textAlign = 'right';
    ctx.fillText('1.0', PADDING_LEFT - 3, PADDING_TOP + 6);
    ctx.fillText('0', PADDING_LEFT - 3, centerY + 3);
    ctx.fillText('-1.0', PADDING_LEFT - 3, PADDING_TOP + plotH);

    // Time labels on X axis
    const effectiveDurationForLabels = durationSeconds > 0 ? durationSeconds : (analysis?.durationSeconds ?? 0);
    if (effectiveDurationForLabels > 0) {
      ctx.textAlign = 'center';
      const timeSteps = Math.max(1, Math.ceil(effectiveDurationForLabels / 30));
      const timeInterval = effectiveDurationForLabels / timeSteps;
      for (let i = 0; i <= timeSteps; i++) {
        const t = i * timeInterval;
        const x = PADDING_LEFT + (t / effectiveDurationForLabels) * plotW;
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        ctx.fillText(`${m}:${s.toString().padStart(2, '0')}`, x, height - 6);
      }
    }

    // Axis title labels
    ctx.fillStyle = 'rgba(156, 175, 196, 0.45)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Time', PADDING_LEFT + plotW / 2, height - 0);
    ctx.save();
    ctx.translate(8, PADDING_TOP + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Amplitude', 0, 0);
    ctx.restore();

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
      ctx.fillStyle = isPast ? pastColor : futureColor;

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

    // Crosshair overlay
    const mPos = mousePosRef.current;
    if (mPos) {
      const clampedX = Math.max(PADDING_LEFT, Math.min(PADDING_LEFT + plotW, mPos.x));

      // Compute precise time from x position
      const timeAtCursor =
        effectiveDuration > 0 && plotW > 0
          ? ((clampedX - PADDING_LEFT) / plotW) * effectiveDuration
          : 0;
      const m = Math.floor(timeAtCursor / 60);
      const s = Math.floor(timeAtCursor % 60);
      const timeLabel = `${m}:${s.toString().padStart(2, '0')}`;

      // Sample the actual waveform peak value at the hovered X position.
      const xRatio = plotW > 0 ? (clampedX - PADDING_LEFT) / plotW : 0;
      const sampledPeak = Math.max(
        0,
        Math.min(1, sampleSeriesAtRatio(waveformPeaks, xRatio) ?? 0)
      );
      const topY = centerY - sampledPeak * (plotH / 2);
      const bottomY = centerY + sampledPeak * (plotH / 2);
      const clampedMouseY = Math.max(PADDING_TOP, Math.min(PADDING_TOP + plotH, mPos.y));
      const useTopEdge = Math.abs(clampedMouseY - topY) <= Math.abs(clampedMouseY - bottomY);
      const sampledY = useTopEdge ? topY : bottomY;
      const sampledAmplitude = useTopEdge ? sampledPeak : -sampledPeak;
      const ampLabel = sampledAmplitude.toFixed(2);

      drawCrosshair(
        ctx,
        {
          x: clampedX,
          y: sampledY,
        },
        {
          plotLeft: PADDING_LEFT,
          plotTop: PADDING_TOP,
          plotRight: PADDING_LEFT + plotW,
          plotBottom: PADDING_TOP + plotH,
          xLabel: timeLabel,
          yLabel: ampLabel,
        }
      );
    }
  }, [
    waveformPeaks,
    analysis,
    currentTimeSeconds,
    durationSeconds,
    width,
    height,
    mousePosRef,
    pastColor,
    futureColor,
  ]);

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
      style={{ width, height, display: 'block', borderRadius: 8, cursor: 'crosshair' }}
      onMouseMove={() => drawWaveform()}
      onMouseLeave={() => drawWaveform()}
      onClick={handleCanvasClick}
      data-testid="waveform-display"
    />
  );
}
