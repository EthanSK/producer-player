import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
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

  const opacity = interpolate(frame, [delay, delay + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const translateY = interpolate(frame, [delay, delay + 12], [15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 10,
        padding: "16px 20px",
        minWidth: 140,
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
        {value}
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
