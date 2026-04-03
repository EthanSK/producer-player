import React from "react";
import { useCurrentFrame, interpolate } from "remotion";

interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  style?: React.CSSProperties;
}

export const FadeIn: React.FC<FadeInProps> = ({
  children,
  delay = 0,
  duration = 15,
  style,
}) => {
  const frame = useCurrentFrame();

  const delayedFrame = Math.max(0, frame - delay);

  const opacity = interpolate(delayedFrame, [0, duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        opacity: frame < delay ? 0 : opacity,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
