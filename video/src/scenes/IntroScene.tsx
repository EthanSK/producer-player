import React from "react";
import { spring, interpolate, useCurrentFrame, useVideoConfig, Img, staticFile } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo springs in with a big bounce
  const logoSpring = spring({
    fps,
    frame,
    config: {
      damping: 8,
      stiffness: 80,
      mass: 0.5,
    },
  });

  const logoScale = interpolate(logoSpring, [0, 1], [0.1, 1]);
  const logoOpacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const logoRotate = interpolate(logoSpring, [0, 1], [-15, 0]);

  // Title springs in from below
  const titleSpring = spring({
    fps,
    frame: Math.max(0, frame - 10),
    config: { damping: 10, stiffness: 100, mass: 0.6 },
  });
  const titleY = interpolate(titleSpring, [0, 1], [60, 0]);
  const titleOpacity = interpolate(frame, [10, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleScale = interpolate(titleSpring, [0, 1], [0.7, 1]);

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

      {/* Logo — bouncy entrance */}
      <div
        style={{
          opacity: logoOpacity,
          transform: `scale(${logoScale}) rotate(${logoRotate}deg)`,
          marginBottom: 32,
          willChange: "transform",
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

      {/* Title — slides up with scale bounce */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px) scale(${titleScale})`,
          textAlign: "center",
          willChange: "transform",
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

      {/* Subtitle — flies in from the right with rotation */}
      <FadeIn delay={25} duration={18} direction="right" distance={80} rotate={3} scaleFrom={0.8}>
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

      {/* Tagline — flies in from the left */}
      <FadeIn delay={40} duration={18} direction="left" distance={60} rotate={-2} scaleFrom={0.85}>
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
