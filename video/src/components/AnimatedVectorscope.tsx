import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";

interface AnimatedVectorscopeProps {
  size?: number;
  delay?: number;
}

export const AnimatedVectorscope: React.FC<AnimatedVectorscopeProps> = ({
  size = 220,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - delay;

  const opacity = interpolate(frame, [delay, delay + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 20;

  // Generate animated scatter points for vectorscope
  const numPoints = 200;
  const points: Array<{ x: number; y: number; opacity: number }> = [];

  for (let i = 0; i < numPoints; i++) {
    const t = (localFrame * 0.04 + i * 0.1);
    // Create a slightly oval pattern with some chaos
    const angle = t * 0.7 + Math.sin(i * 0.5) * 0.8;
    const spread = (0.3 + Math.sin(t * 0.2 + i * 0.3) * 0.25) * r;
    const x = cx + Math.cos(angle) * spread * (0.8 + Math.sin(i * 0.7) * 0.3);
    const y = cy + Math.sin(angle) * spread * (0.6 + Math.cos(i * 0.5) * 0.2);
    const pointOpacity = interpolate(
      Math.max(0, localFrame - i * 0.3),
      [0, 10],
      [0, 0.4 + Math.random() * 0.3],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    points.push({ x, y, opacity: pointOpacity });
  }

  return (
    <div style={{ opacity }}>
      <svg width={size} height={size} style={{ display: "block" }}>
        {/* Background */}
        <circle cx={cx} cy={cy} r={r + 10} fill="rgba(255,255,255,0.02)" />

        {/* Grid */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
        <circle cx={cx} cy={cy} r={r * 0.66} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} />
        <circle cx={cx} cy={cy} r={r * 0.33} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} />

        {/* Crosshair */}
        <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
        <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />

        {/* Labels */}
        <text x={cx} y={cy - r - 6} textAnchor="middle" fill={COLORS.textMuted} fontSize={10}>M</text>
        <text x={cx} y={cy + r + 14} textAnchor="middle" fill={COLORS.textMuted} fontSize={10}>M</text>
        <text x={cx - r - 8} y={cy + 4} textAnchor="middle" fill={COLORS.textMuted} fontSize={10}>S</text>
        <text x={cx + r + 8} y={cy + 4} textAnchor="middle" fill={COLORS.textMuted} fontSize={10}>S</text>

        {/* Scatter points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={1.5}
            fill={COLORS.green}
            opacity={p.opacity}
          />
        ))}
      </svg>
    </div>
  );
};
