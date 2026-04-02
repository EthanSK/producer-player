import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

interface GlowOrbProps {
  color: string;
  size: number;
  x: number;
  y: number;
  pulseSpeed?: number;
}

export const GlowOrb: React.FC<GlowOrbProps> = ({
  color,
  size,
  x,
  y,
  pulseSpeed = 0.03,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(
    Math.sin(frame * pulseSpeed),
    [-1, 1],
    [0.8, 1.2]
  );

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color}40 0%, transparent 70%)`,
        transform: `scale(${scale})`,
        filter: "blur(60px)",
        pointerEvents: "none",
      }}
    />
  );
};
