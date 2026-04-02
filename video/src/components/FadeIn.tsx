import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
  distance?: number;
  style?: React.CSSProperties;
}

export const FadeIn: React.FC<FadeInProps> = ({
  children,
  delay = 0,
  duration = 20,
  direction = "up",
  distance = 40,
  style,
}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [delay, delay + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const translateMap = {
    up: `translateY(${interpolate(frame, [delay, delay + duration], [distance, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
    down: `translateY(${interpolate(frame, [delay, delay + duration], [-distance, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
    left: `translateX(${interpolate(frame, [delay, delay + duration], [distance, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
    right: `translateX(${interpolate(frame, [delay, delay + duration], [-distance, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
    none: "none",
  };

  return (
    <div
      style={{
        opacity,
        transform: translateMap[direction],
        ...style,
      }}
    >
      {children}
    </div>
  );
};
