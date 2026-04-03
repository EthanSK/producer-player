import React from "react";
import { spring, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
  distance?: number;
  style?: React.CSSProperties;
  rotate?: number;
  scaleFrom?: number;
  blur?: number;
}

export const FadeIn: React.FC<FadeInProps> = ({
  children,
  delay = 0,
  duration = 20,
  direction = "up",
  distance = 60,
  style,
  rotate = 0,
  scaleFrom = 0.85,
  blur = 4,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const delayedFrame = Math.max(0, frame - delay);

  // Bouncy spring animation
  const springVal = spring({
    fps,
    frame: delayedFrame,
    config: {
      damping: 12,
      stiffness: 120,
      mass: 0.6,
    },
  });

  // Opacity ramps quickly
  const opacity = interpolate(delayedFrame, [0, Math.min(duration * 0.4, 8)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Direction-based translation
  const translateMap: Record<string, string> = {
    up: `translateY(${(1 - springVal) * distance}px)`,
    down: `translateY(${-(1 - springVal) * distance}px)`,
    left: `translateX(${(1 - springVal) * distance}px)`,
    right: `translateX(${-(1 - springVal) * distance}px)`,
    none: "",
  };

  // Scale springs in
  const scale = interpolate(springVal, [0, 1], [scaleFrom, 1]);

  // Rotation springs from rotate to 0
  const rot = interpolate(springVal, [0, 1], [rotate, 0]);

  // Blur fades away
  const blurVal = interpolate(springVal, [0, 0.5], [blur, 0], {
    extrapolateRight: "clamp",
  });

  const transform = [
    translateMap[direction] || "",
    `scale(${scale})`,
    rot !== 0 ? `rotate(${rot}deg)` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      style={{
        opacity: frame < delay ? 0 : opacity,
        transform,
        filter: blurVal > 0.1 ? `blur(${blurVal}px)` : "none",
        willChange: "transform, opacity, filter",
        ...style,
      }}
    >
      {children}
    </div>
  );
};
