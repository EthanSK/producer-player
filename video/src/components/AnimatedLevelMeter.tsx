import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "../theme";

interface AnimatedLevelMeterProps {
  width?: number;
  height?: number;
  delay?: number;
}

export const AnimatedLevelMeter: React.FC<AnimatedLevelMeterProps> = ({
  width = 36,
  height = 200,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const localFrame = Math.max(0, frame - delay);

  const opacity = interpolate(frame, [delay, delay + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Animated level
  const levelL = interpolate(
    Math.sin(localFrame * 0.09) + Math.sin(localFrame * 0.13) * 0.5,
    [-1.5, 1.5],
    [0.3, 0.85],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const levelR = interpolate(
    Math.sin(localFrame * 0.1 + 1) + Math.sin(localFrame * 0.14 + 0.5) * 0.5,
    [-1.5, 1.5],
    [0.3, 0.85],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const meterWidth = (width - 6) / 2;

  return (
    <div style={{ opacity, display: "flex", gap: 2 }}>
      {[levelL, levelR].map((level, ch) => {
        const filledH = level * height;
        return (
          <svg key={ch} width={meterWidth} height={height}>
            <rect width={meterWidth} height={height} fill="rgba(255,255,255,0.04)" rx={2} />
            <defs>
              <linearGradient id={`meterGrad${ch}`} x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={COLORS.green} />
                <stop offset="70%" stopColor={COLORS.yellow} />
                <stop offset="100%" stopColor={COLORS.red} />
              </linearGradient>
            </defs>
            <rect
              x={1}
              y={height - filledH}
              width={meterWidth - 2}
              height={filledH}
              rx={1}
              fill={`url(#meterGrad${ch})`}
              opacity={0.8}
            />
          </svg>
        );
      })}
    </div>
  );
};
