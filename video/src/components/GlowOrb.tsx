import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

interface GlowOrbProps {
  color: string;
  size: number;
  x: number;
  y: number;
  pulseSpeed?: number;
  drift?: number;
}

export const GlowOrb: React.FC<GlowOrbProps> = ({
  color,
  size,
  x,
  y,
  pulseSpeed = 0.03,
  drift = 30,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(
    Math.sin(frame * pulseSpeed),
    [-1, 1],
    [0.7, 1.3]
  );

  // Orbs gently drift in a lissajous pattern
  const driftX = Math.sin(frame * pulseSpeed * 0.7) * drift;
  const driftY = Math.cos(frame * pulseSpeed * 1.1) * drift * 0.6;

  return (
    <div
      style={{
        position: "absolute",
        left: x + driftX,
        top: y + driftY,
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color}50 0%, ${color}20 40%, transparent 70%)`,
        transform: `scale(${scale})`,
        filter: "blur(60px)",
        pointerEvents: "none",
        willChange: "transform",
      }}
    />
  );
};
