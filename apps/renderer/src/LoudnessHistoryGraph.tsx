import { useEffect, useRef, useCallback } from 'react';
import type { TrackAnalysisResult } from './audioAnalysis';

interface LoudnessHistoryGraphProps {
  analysis: TrackAnalysisResult | null;
  currentTimeSeconds: number;
  isPlaying: boolean;
  width: number;
  height: number;
}

const DB_MIN = -60;
const DB_MAX = 0;
const PADDING_LEFT = 44;
const PADDING_RIGHT = 12;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 30;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function LoudnessHistoryGraph({
  analysis,
  currentTimeSeconds,
  isPlaying,
  width,
  height,
}: LoudnessHistoryGraphProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  const drawGraph = useCallback(() => {
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

    // Background
    ctx.fillStyle = 'rgba(9, 14, 19, 0.6)';
    ctx.fillRect(0, 0, width, height);

    if (!analysis || analysis.frameLoudnessDbfs.length === 0) {
      ctx.fillStyle = '#9cafc4';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Play a track to see loudness history', width / 2, height / 2);
      return;
    }

    const frames = analysis.frameLoudnessDbfs;
    const frameDur = analysis.frameDurationSeconds;
    const totalDur = analysis.durationSeconds;

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = '#6b8199';
    ctx.textAlign = 'right';

    const dbSteps = [-50, -40, -30, -20, -10, 0];
    for (const db of dbSteps) {
      const y = PADDING_TOP + plotH * (1 - (db - DB_MIN) / (DB_MAX - DB_MIN));
      ctx.beginPath();
      ctx.moveTo(PADDING_LEFT, y);
      ctx.lineTo(PADDING_LEFT + plotW, y);
      ctx.stroke();
      ctx.fillText(`${db}`, PADDING_LEFT - 4, y + 3);
    }

    // Time labels
    ctx.textAlign = 'center';
    const timeSteps = Math.max(1, Math.ceil(totalDur / 30));
    const timeInterval = totalDur / timeSteps;
    for (let i = 0; i <= timeSteps; i++) {
      const t = i * timeInterval;
      const x = PADDING_LEFT + (t / totalDur) * plotW;
      ctx.fillText(formatTime(t), x, height - 14);
    }

    // Axis title labels
    ctx.fillStyle = 'rgba(156, 175, 196, 0.5)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Time', PADDING_LEFT + plotW / 2, height - 2);
    ctx.save();
    ctx.translate(10, PADDING_TOP + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('LUFS', 0, 0);
    ctx.restore();

    // Integrated LUFS reference line
    const intLufs = analysis.integratedLufsEstimate;
    if (intLufs > DB_MIN) {
      const intY = PADDING_TOP + plotH * (1 - (intLufs - DB_MIN) / (DB_MAX - DB_MIN));
      ctx.strokeStyle = 'rgba(92, 167, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(PADDING_LEFT, intY);
      ctx.lineTo(PADDING_LEFT + plotW, intY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(92, 167, 255, 0.9)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${intLufs.toFixed(1)} LUFS`, PADDING_LEFT + plotW + 2, intY + 3);
    }

    // Draw loudness curve
    ctx.beginPath();
    ctx.strokeStyle = '#5ca7ff';
    ctx.lineWidth = 1.5;

    let started = false;
    for (let i = 0; i < frames.length; i++) {
      const t = i * frameDur;
      const x = PADDING_LEFT + (t / totalDur) * plotW;
      const db = Math.max(DB_MIN, Math.min(DB_MAX, frames[i]));
      const y = PADDING_TOP + plotH * (1 - (db - DB_MIN) / (DB_MAX - DB_MIN));

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Fill under curve
    if (frames.length > 0) {
      const lastT = (frames.length - 1) * frameDur;
      const lastX = PADDING_LEFT + (lastT / totalDur) * plotW;
      ctx.lineTo(lastX, PADDING_TOP + plotH);
      ctx.lineTo(PADDING_LEFT, PADDING_TOP + plotH);
      ctx.closePath();
      ctx.fillStyle = 'rgba(92, 167, 255, 0.08)';
      ctx.fill();
    }

    // Playback position indicator
    if (currentTimeSeconds > 0 && currentTimeSeconds <= totalDur) {
      const posX = PADDING_LEFT + (currentTimeSeconds / totalDur) * plotW;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(posX, PADDING_TOP);
      ctx.lineTo(posX, PADDING_TOP + plotH);
      ctx.stroke();
    }
  }, [analysis, currentTimeSeconds, width, height]);

  useEffect(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }

    const tick = () => {
      drawGraph();
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
  }, [drawGraph, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block', borderRadius: 8 }}
      data-testid="loudness-history-graph"
    />
  );
}
