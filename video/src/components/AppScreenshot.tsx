import React from "react";
import { Img, staticFile, spring, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

interface AppScreenshotProps {
  src?: string;
  width?: number;
  delay?: number;
  shadow?: boolean;
}

export const AppScreenshot: React.FC<AppScreenshotProps> = ({
  src = "images/app-hero.png",
  width = 1200,
  delay = 0,
  shadow = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const delayedFrame = Math.max(0, frame - delay);

  const springVal = spring({
    fps,
    frame: delayedFrame,
    config: {
      damping: 12,
      stiffness: 80,
      mass: 0.7,
    },
  });

  const opacity = interpolate(delayedFrame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const scale = interpolate(springVal, [0, 1], [0.4, 1]);
  const rotate = interpolate(springVal, [0, 1], [-2, 0]);
  const translateY = interpolate(springVal, [0, 1], [80, 0]);

  return (
    <div
      style={{
        opacity: frame < delay ? 0 : opacity,
        transform: `scale(${scale}) rotate(${rotate}deg) translateY(${translateY}px)`,
        display: "flex",
        justifyContent: "center",
        willChange: "transform, opacity",
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          width,
          borderRadius: 12,
          boxShadow: shadow
            ? "0 24px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.05)"
            : "none",
        }}
      />
    </div>
  );
};
