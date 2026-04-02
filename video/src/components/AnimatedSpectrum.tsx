import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";

interface AnimatedSpectrumProps {
  width?: number;
  height?: number;
  delay?: number;
}

export const AnimatedSpectrum: React.FC<AnimatedSpectrumProps> = ({
  width = 700,
  height = 200,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const localFrame = Math.max(0, frame - delay);

  const opacity = interpolate(frame, [delay, delay + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const numBars = 64;
  const barWidth = width / numBars;

  return (
    <div style={{ opacity }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <rect width={width} height={height} fill="rgba(255,255,255,0.02)" rx={4} />

        {Array.from({ length: numBars }).map((_, i) => {
          // Create a frequency-shaped spectrum (louder bass, roll-off highs)
          const freqShape = Math.exp(-((i / numBars) * 2)) * 0.7 + 0.1;
          const animation = Math.sin(localFrame * 0.08 + i * 0.4) * 0.2
            + Math.sin(localFrame * 0.12 + i * 0.7) * 0.15
            + Math.sin(localFrame * 0.05 + i * 0.2) * 0.1;
          const barAmp = Math.max(0.03, Math.min(1, freqShape + animation));
          const barH = barAmp * (height - 8);
          const y = height - barH - 4;

          // Color gradient: cyan-ish for bass, blue for mids, purple for highs
          const hue = 200 + (i / numBars) * 60;

          return (
            <rect
              key={i}
              x={i * barWidth + 0.5}
              y={y}
              width={Math.max(1, barWidth - 1.5)}
              height={barH}
              rx={1}
              fill={`hsl(${hue}, 70%, 55%)`}
              opacity={0.75}
            />
          );
        })}
      </svg>
    </div>
  );
};
