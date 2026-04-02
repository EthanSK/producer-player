import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";

interface AnimatedWaveformProps {
  width?: number;
  height?: number;
  delay?: number;
}

function generateWaveformBars(count: number): number[] {
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const envelope = Math.sin((i / count) * Math.PI) * 0.6 + 0.3;
    const detail = Math.sin(i * 0.7) * 0.15 + Math.sin(i * 1.3) * 0.1 + Math.sin(i * 0.3) * 0.08;
    bars.push(Math.max(0.05, Math.min(1, envelope + detail)));
  }
  return bars;
}

export const AnimatedWaveform: React.FC<AnimatedWaveformProps> = ({
  width = 700,
  height = 120,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - delay;

  const opacity = interpolate(frame, [delay, delay + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const bars = generateWaveformBars(180);
  const barWidth = width / bars.length;
  const progress = interpolate(Math.max(0, localFrame), [0, 180], [0, 1], {
    extrapolateRight: "clamp",
  });
  const playheadX = progress * width;

  return (
    <div style={{ opacity }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <rect width={width} height={height} fill="rgba(255,255,255,0.02)" rx={4} />

        {bars.map((amp, i) => {
          const x = i * barWidth;
          const barH = amp * (height - 8);
          const y = (height - barH) / 2;
          const isPast = x < playheadX;

          return (
            <rect
              key={i}
              x={x + 0.5}
              y={y}
              width={Math.max(1, barWidth - 1)}
              height={barH}
              rx={1}
              fill={isPast ? COLORS.accent : "rgba(255,255,255,0.15)"}
              opacity={isPast ? 0.85 : 0.5}
            />
          );
        })}

        {/* Playhead */}
        <line
          x1={playheadX}
          y1={0}
          x2={playheadX}
          y2={height}
          stroke={COLORS.text}
          strokeWidth={2}
          opacity={0.8}
        />
      </svg>
    </div>
  );
};
