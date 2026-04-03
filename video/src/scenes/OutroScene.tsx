import React from "react";
import { interpolate, useCurrentFrame, Img, staticFile } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();

  const logoOpacity = interpolate(frame, [5, 18], [0, 1], {
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
      <GlowOrb color={COLORS.accent} size={700} x={400} y={200} pulseSpeed={0.015} drift={50} />
      <GlowOrb color={COLORS.green} size={500} x={1100} y={500} pulseSpeed={0.02} drift={40} />
      <GlowOrb color="#7c3aed" size={400} x={800} y={100} pulseSpeed={0.025} drift={30} />

      <div
        style={{
          opacity: logoOpacity,
          marginBottom: 24,
        }}
      >
        <Img
          src={staticFile("images/icon.svg")}
          style={{
            width: 100,
            height: 100,
            filter: "drop-shadow(0 0 30px rgba(92, 167, 255, 0.3))",
          }}
        />
      </div>

      <FadeIn delay={10} duration={15}>
        <h1
          style={{
            fontFamily: FONTS.body,
            fontSize: 56,
            fontWeight: 800,
            color: COLORS.text,
            letterSpacing: "-0.03em",
            margin: 0,
            textAlign: "center",
          }}
        >
          Producer Player
        </h1>
      </FadeIn>

      <FadeIn delay={20} duration={15}>
        <p
          style={{
            fontFamily: FONTS.body,
            fontSize: 22,
            color: COLORS.textMuted,
            marginTop: 12,
            textAlign: "center",
          }}
        >
          Free &amp; open source. macOS, Windows, Linux.
        </p>
      </FadeIn>

      <FadeIn delay={30} duration={15}>
        <div
          style={{
            marginTop: 36,
            fontFamily: FONTS.mono,
            fontSize: 18,
            color: COLORS.accent,
            background: "rgba(92, 167, 255, 0.08)",
            border: "1px solid rgba(92, 167, 255, 0.25)",
            borderRadius: 10,
            padding: "14px 36px",
          }}
        >
          github.com/EthanSK/producer-player
        </div>
      </FadeIn>

      <FadeIn delay={40} duration={15}>
        <div
          style={{
            display: "flex",
            gap: 24,
            marginTop: 32,
          }}
        >
          {["Version Tracking", "Mastering Workspace", "Album Ordering", "Song Checklists"].map(
            (feature, i) => (
              <FadeIn key={feature} delay={42 + i * 3} duration={15}>
                <span
                  style={{
                    fontFamily: FONTS.body,
                    fontSize: 14,
                    color: COLORS.textMuted,
                  }}
                >
                  {feature}
                </span>
              </FadeIn>
            )
          )}
        </div>
      </FadeIn>
    </div>
  );
};
