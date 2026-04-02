import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS } from "../theme";

interface AnimatedLoudnessGraphProps {
  width?: number;
  height?: number;
  delay?: number;
}

// Generate a realistic loudness curve (LUFS over time)
function generateLufsData(numPoints: number, seed: number): number[] {
  const data: number[] = [];
  let value = -14;
  for (let i = 0; i < numPoints; i++) {
    const noise = Math.sin(i * 0.15 + seed) * 3 + Math.sin(i * 0.05 + seed * 2) * 4;
    const trend = Math.sin(i * 0.02) * 2;
    value = -14 + noise + trend;
    value = Math.max(-30, Math.min(-6, value));
    data.push(value);
  }
  return data;
}

export const AnimatedLoudnessGraph: React.FC<AnimatedLoudnessGraphProps> = ({
  width = 700,
  height = 200,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - delay;

  const opacity = interpolate(frame, [delay, delay + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const data = generateLufsData(200, 42);
  const paddingLeft = 50;
  const paddingRight = 12;
  const paddingTop = 10;
  const paddingBottom = 26;
  const plotW = width - paddingLeft - paddingRight;
  const plotH = height - paddingTop - paddingBottom;
  const dbMin = -30;
  const dbMax = -6;

  // Animated playback position
  const progress = interpolate(Math.max(0, localFrame), [0, 180], [0, 1], {
    extrapolateRight: "clamp",
  });
  const visibleCount = Math.floor(progress * data.length);

  // Build SVG path
  const points = data.slice(0, Math.max(1, visibleCount)).map((val, i) => {
    const x = paddingLeft + (i / (data.length - 1)) * plotW;
    const y = paddingTop + ((dbMax - val) / (dbMax - dbMin)) * plotH;
    return `${x},${y}`;
  });
  const pathD = points.length > 0 ? `M${points.join(" L")}` : "";

  // Grid lines
  const gridLines = [-10, -14, -20, -26];

  return (
    <div style={{ opacity }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        {/* Background */}
        <rect x={paddingLeft} y={paddingTop} width={plotW} height={plotH}
          fill="rgba(255,255,255,0.02)" rx={4} />

        {/* Grid lines */}
        {gridLines.map((db) => {
          const y = paddingTop + ((dbMax - db) / (dbMax - dbMin)) * plotH;
          return (
            <g key={db}>
              <line x1={paddingLeft} y1={y} x2={paddingLeft + plotW} y2={y}
                stroke="rgba(255,255,255,0.06)" strokeDasharray="4,4" />
              <text x={paddingLeft - 6} y={y + 4} textAnchor="end"
                fill={COLORS.textMuted} fontSize={11} fontFamily={FONTS.mono}>
                {db}
              </text>
            </g>
          );
        })}

        {/* LUFS curve */}
        <path d={pathD} fill="none" stroke={COLORS.accent} strokeWidth={2.5}
          strokeLinecap="round" strokeLinejoin="round" />

        {/* Filled area under curve */}
        {points.length > 1 && (
          <path
            d={`${pathD} L${points[points.length - 1].split(",")[0]},${paddingTop + plotH} L${paddingLeft},${paddingTop + plotH} Z`}
            fill="url(#loudnessGradient)" opacity={0.3}
          />
        )}

        {/* Playhead */}
        {visibleCount > 0 && (
          <line
            x1={paddingLeft + ((visibleCount - 1) / (data.length - 1)) * plotW}
            y1={paddingTop}
            x2={paddingLeft + ((visibleCount - 1) / (data.length - 1)) * plotW}
            y2={paddingTop + plotH}
            stroke={COLORS.accent}
            strokeWidth={1.5}
            opacity={0.6}
          />
        )}

        {/* Gradient definition */}
        <defs>
          <linearGradient id="loudnessGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.4} />
            <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Axis labels */}
        <text x={paddingLeft + plotW / 2} y={height - 4}
          textAnchor="middle" fill={COLORS.textMuted} fontSize={11} fontFamily={FONTS.mono}>
          Time
        </text>
        <text x={8} y={paddingTop + plotH / 2}
          textAnchor="middle" fill={COLORS.textMuted} fontSize={11} fontFamily={FONTS.mono}
          transform={`rotate(-90, 8, ${paddingTop + plotH / 2})`}>
          LUFS
        </text>
      </svg>
    </div>
  );
};
