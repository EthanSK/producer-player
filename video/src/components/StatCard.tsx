import React from "react";
import { spring, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { COLORS, FONTS } from "../theme";

interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  delay?: number;
  accentColor?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subtitle,
  delay = 0,
  accentColor = COLORS.accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const delayedFrame = Math.max(0, frame - delay);

  const springVal = spring({
    fps,
    frame: delayedFrame,
    config: {
      damping: 10,
      stiffness: 100,
      mass: 0.5,
    },
  });

  const opacity = interpolate(delayedFrame, [0, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const translateY = interpolate(springVal, [0, 1], [30, 0]);
  const scale = interpolate(springVal, [0, 1], [0.6, 1]);
  const rotate = interpolate(springVal, [0, 1], [-3, 0]);

  // Count-up for numeric values
  const numericMatch = value.match(/^([+-]?)(\d+\.?\d*)/);
  let displayValue = value;
  if (numericMatch && delayedFrame > 0) {
    const sign = numericMatch[1];
    const num = parseFloat(numericMatch[2]);
    const countProgress = interpolate(delayedFrame, [0, 18], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const currentNum = num * countProgress;
    const decimals = numericMatch[2].includes(".") ? numericMatch[2].split(".")[1].length : 0;
    displayValue = value.replace(
      numericMatch[0],
      `${sign}${currentNum.toFixed(decimals)}`
    );
  }

  return (
    <div
      style={{
        opacity: frame < delay ? 0 : opacity,
        transform: `translateY(${translateY}px) scale(${scale}) rotate(${rotate}deg)`,
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 10,
        padding: "16px 20px",
        minWidth: 140,
        willChange: "transform, opacity",
      }}
    >
      <div
        style={{
          fontFamily: FONTS.body,
          fontSize: 12,
          color: COLORS.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 26,
          fontWeight: 700,
          color: accentColor,
          lineHeight: 1,
        }}
      >
        {displayValue}
      </div>
      {subtitle && (
        <div
          style={{
            fontFamily: FONTS.body,
            fontSize: 11,
            color: COLORS.textMuted,
            marginTop: 6,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
};
