import { useRef, useCallback, useEffect, useState } from 'react';

export interface CrosshairPosition {
  /** CSS pixel X relative to canvas */
  x: number;
  /** CSS pixel Y relative to canvas */
  y: number;
}

interface CrosshairConfig {
  /** Canvas ref to attach events to */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Total CSS width */
  width: number;
  /** Total CSS height */
  height: number;
  /** Whether crosshair is enabled */
  enabled?: boolean;
}

/**
 * Tracks mouse position over a canvas and exposes the position
 * so the parent draw loop can render crosshair + value labels.
 */
export function useCrosshairOverlay({
  canvasRef,
  width,
  height,
  enabled = true,
}: CrosshairConfig) {
  const [mousePos, setMousePos] = useState<CrosshairPosition | null>(null);
  const mousePosRef = useRef<CrosshairPosition | null>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!enabled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x >= 0 && x <= width && y >= 0 && y <= height) {
        const pos = { x, y };
        mousePosRef.current = pos;
        setMousePos(pos);
      } else {
        mousePosRef.current = null;
        setMousePos(null);
      }
    },
    [canvasRef, width, height, enabled]
  );

  const handleMouseLeave = useCallback(() => {
    mousePosRef.current = null;
    setMousePos(null);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [canvasRef, handleMouseMove, handleMouseLeave, enabled]);

  return { mousePos, mousePosRef };
}

/** Draw crosshair lines and value labels on a canvas context. */
export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  pos: CrosshairPosition,
  opts: {
    /** Plot area bounds (CSS pixels) */
    plotLeft: number;
    plotTop: number;
    plotRight: number;
    plotBottom: number;
    /** X-axis label string at the cursor position */
    xLabel: string;
    /** Y-axis label string at the cursor position */
    yLabel: string;
  }
) {
  const { plotLeft, plotTop, plotRight, plotBottom, xLabel, yLabel } = opts;

  // Clamp cursor to plot area
  const cx = Math.max(plotLeft, Math.min(plotRight, pos.x));
  const cy = Math.max(plotTop, Math.min(plotBottom, pos.y));

  // Crosshair lines
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  // Vertical line
  ctx.beginPath();
  ctx.moveTo(cx, plotTop);
  ctx.lineTo(cx, plotBottom);
  ctx.stroke();

  // Horizontal line
  ctx.beginPath();
  ctx.moveTo(plotLeft, cy);
  ctx.lineTo(plotRight, cy);
  ctx.stroke();

  ctx.setLineDash([]);

  // Label styling
  ctx.font = '10px Inter, sans-serif';
  const labelPadH = 4;
  const labelPadV = 2;

  // X-axis label (at bottom of plot, near cursor X)
  if (xLabel) {
    const xMetrics = ctx.measureText(xLabel);
    const xLabelW = xMetrics.width + labelPadH * 2;
    const xLabelH = 14;
    let xLabelX = cx - xLabelW / 2;
    // Keep label within plot bounds
    if (xLabelX < plotLeft) xLabelX = plotLeft;
    if (xLabelX + xLabelW > plotRight) xLabelX = plotRight - xLabelW;

    ctx.fillStyle = 'rgba(20, 28, 38, 0.9)';
    ctx.beginPath();
    ctx.roundRect(xLabelX, plotBottom + 1, xLabelW, xLabelH, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(92, 167, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(200, 220, 240, 0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(xLabel, xLabelX + xLabelW / 2, plotBottom + 1 + xLabelH / 2);
  }

  // Y-axis label (at left of plot, near cursor Y)
  if (yLabel) {
    const yMetrics = ctx.measureText(yLabel);
    const yLabelW = yMetrics.width + labelPadH * 2;
    const yLabelH = 14;
    let yLabelY = cy - yLabelH / 2;
    if (yLabelY < plotTop) yLabelY = plotTop;
    if (yLabelY + yLabelH > plotBottom) yLabelY = plotBottom - yLabelH;

    const yLabelX = plotLeft - yLabelW - 2;

    ctx.fillStyle = 'rgba(20, 28, 38, 0.9)';
    ctx.beginPath();
    ctx.roundRect(yLabelX, yLabelY, yLabelW, yLabelH, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(92, 167, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(200, 220, 240, 0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(yLabel, yLabelX + yLabelW / 2, yLabelY + yLabelH / 2);
  }

  ctx.restore();
}
