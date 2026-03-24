import { useEffect, useRef } from 'react';

interface VectorscopeProps {
  analyserNodeL: AnalyserNode | null;
  analyserNodeR: AnalyserNode | null;
  size: number;
  isPlaying: boolean;
}

export function Vectorscope({
  analyserNodeL,
  analyserNodeR,
  size,
  isPlaying,
}: VectorscopeProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const trailCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    // Off-screen canvas for persistent trail effect
    if (!trailCanvasRef.current) {
      trailCanvasRef.current = document.createElement('canvas');
    }
    const trailCanvas = trailCanvasRef.current;
    trailCanvas.width = size * dpr;
    trailCanvas.height = size * dpr;
    const trailCtx = trailCanvas.getContext('2d');

    let bufferL: Float32Array<ArrayBuffer> | null = null;
    let bufferR: Float32Array<ArrayBuffer> | null = null;

    const drawFrame = () => {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.scale(dpr, dpr);

      // Background
      ctx.fillStyle = 'rgba(9, 14, 19, 0.95)';
      ctx.fillRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const radius = (size - 16) / 2;

      // Draw circular boundary
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Draw crosshairs
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.stroke();

      // Labels — M (top), S (right), and L/R on diagonals
      ctx.font = '9px Inter, sans-serif';
      ctx.fillStyle = '#6b8199';
      ctx.textAlign = 'center';
      ctx.fillText('M', cx, cy - radius - 4);
      ctx.fillText('S', cx + radius + 4, cy + 3);
      ctx.fillText('L', cx - radius * 0.7 - 8, cy - radius * 0.7 - 2);
      ctx.fillText('R', cx + radius * 0.7 + 6, cy - radius * 0.7 - 2);
      ctx.textBaseline = 'alphabetic';

      if (!analyserNodeL || !analyserNodeR) {
        ctx.fillStyle = '#9cafc4';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Stereo required', cx, cy);
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

      // Fade the trail canvas
      if (trailCtx) {
        trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        trailCtx.fillStyle = 'rgba(9, 14, 19, 0.15)';
        trailCtx.fillRect(0, 0, size, size);
      }

      // Draw current samples on trail canvas
      if (trailCtx) {
        trailCtx.fillStyle = 'rgba(92, 167, 255, 0.6)';
        const step = Math.max(1, Math.floor(fftSize / 512));
        for (let i = 0; i < fftSize; i += step) {
          const l = bufferL![i];
          const r = bufferR![i];
          // X = L-R (side), Y = L+R (mid), inverted Y for canvas
          const xVal = (l - r) * radius * 0.7;
          const yVal = (l + r) * radius * 0.7;
          const px = cx + xVal;
          const py = cy - yVal;

          trailCtx.fillRect(px - 0.5, py - 0.5, 1, 1);
        }
      }

      // Composite trail onto main canvas
      ctx.drawImage(trailCanvas, 0, 0, size, size);

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
  }, [analyserNodeL, analyserNodeR, size, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: 'block', borderRadius: 8 }}
      data-testid="vectorscope"
    />
  );
}
