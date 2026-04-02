import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS } from "../theme";

interface AnimatedCorrelationMeterProps {
  width?: number;
  height?: number;
  delay?: number;
}

export const AnimatedCorrelationMeter: React.FC<AnimatedCorrelationMeterProps> = ({
  width = 500,
  height = 50,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - delay;

  const opacity = interpolate(frame, [delay, delay + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Animated correlation value oscillating mostly in the positive range
  const correlation = interpolate(
    Math.sin(Math.max(0, localFrame) * 0.06) + Math.sin(Math.max(0, localFrame) * 0.11) * 0.3,
    [-1.3, 1.3],
    [-0.2, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const barPadding = 40;
  const barWidth = width - barPadding * 2;
  const barHeight = 16;
  const barY = (height - barHeight) / 2;

  // Map correlation -1..+1 to position on bar
  const indicatorX = barPadding + ((correlation + 1) / 2) * barWidth;

  // Color based on correlation
  const color = correlation >= 0.5 ? COLORS.green : correlation >= 0 ? COLORS.yellow : COLORS.red;

  return (
    <div style={{ opacity }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        {/* Track background */}
        <rect x={barPadding} y={barY} width={barWidth} height={barHeight}
          rx={barHeight / 2} fill="rgba(255,255,255,0.06)" />

        {/* Gradient fill from center */}
        <defs>
          <linearGradient id="corrGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={COLORS.red} stopOpacity={0.4} />
            <stop offset="50%" stopColor={COLORS.yellow} stopOpacity={0.2} />
            <stop offset="100%" stopColor={COLORS.green} stopOpacity={0.4} />
          </linearGradient>
        </defs>
        <rect x={barPadding} y={barY} width={barWidth} height={barHeight}
          rx={barHeight / 2} fill="url(#corrGrad)" opacity={0.5} />

        {/* Center mark */}
        <line x1={barPadding + barWidth / 2} y1={barY - 2}
          x2={barPadding + barWidth / 2} y2={barY + barHeight + 2}
          stroke="rgba(255,255,255,0.3)" strokeWidth={1} />

        {/* Indicator */}
        <circle cx={indicatorX} cy={barY + barHeight / 2} r={8}
          fill={color} stroke="white" strokeWidth={1.5} />

        {/* Labels */}
        <text x={barPadding - 4} y={barY + barHeight / 2 + 4}
          textAnchor="end" fill={COLORS.textMuted} fontSize={11} fontFamily={FONTS.mono}>
          -1
        </text>
        <text x={barPadding + barWidth + 4} y={barY + barHeight / 2 + 4}
          textAnchor="start" fill={COLORS.textMuted} fontSize={11} fontFamily={FONTS.mono}>
          +1
        </text>
      </svg>
    </div>
  );
};
