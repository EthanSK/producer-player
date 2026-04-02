import React from "react";
import { Img, staticFile, interpolate, useCurrentFrame } from "remotion";

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

  const opacity = interpolate(frame, [delay, delay + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const scale = interpolate(frame, [delay, delay + 25], [0.95, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        opacity,
        transform: `scale(${scale})`,
        display: "flex",
        justifyContent: "center",
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
