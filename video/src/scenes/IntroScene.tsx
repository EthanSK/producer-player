import React from "react";
import { interpolate, useCurrentFrame, Img, staticFile } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();

  const logoOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleOpacity = interpolate(frame, [10, 25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `radial-gradient(ellipse at 50% 40%, #0f1a2e 0%, ${COLORS.bg} 70%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <GlowOrb color={COLORS.accent} size={600} x={200} y={100} pulseSpeed={0.02} drift={40} />
      <GlowOrb color="#7c3aed" size={500} x={1200} y={500} pulseSpeed={0.025} drift={35} />
      <GlowOrb color={COLORS.green} size={400} x={800} y={-100} pulseSpeed={0.03} drift={25} />

      {/* Logo */}
      <div
        style={{
          opacity: logoOpacity,
          marginBottom: 32,
        }}
      >
        <Img
          src={staticFile("images/icon.svg")}
          style={{
            width: 120,
            height: 120,
            filter: "drop-shadow(0 0 30px rgba(92, 167, 255, 0.3))",
          }}
        />
      </div>

      {/* Title */}
      <div
        style={{
          opacity: titleOpacity,
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontFamily: FONTS.body,
            fontSize: 72,
            fontWeight: 800,
            color: COLORS.text,
            margin: 0,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
          }}
        >
          Producer Player
        </h1>
      </div>

      {/* Subtitle */}
      <FadeIn delay={25} duration={15}>
        <p
          style={{
            fontFamily: FONTS.body,
            fontSize: 26,
            color: COLORS.textMuted,
            marginTop: 16,
            letterSpacing: "-0.01em",
          }}
        >
          The desktop app for music producers
        </p>
      </FadeIn>

      {/* Tagline */}
      <FadeIn delay={40} duration={15}>
        <p
          style={{
            fontFamily: FONTS.body,
            fontSize: 20,
            color: COLORS.accent,
            marginTop: 12,
          }}
        >
          Version tracking &middot; Mastering workspace &middot; Album ordering
        </p>
      </FadeIn>
    </div>
  );
};
