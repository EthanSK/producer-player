import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";

export const MasteringIntroScene: React.FC = () => {
  const frame = useCurrentFrame();

  const lineWidth = interpolate(frame, [20, 50], [0, 400], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `radial-gradient(ellipse at 50% 50%, #0a1830 0%, ${COLORS.bg} 70%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <GlowOrb color={COLORS.accent} size={700} x={500} y={200} pulseSpeed={0.02} />
      <GlowOrb color={COLORS.green} size={500} x={1100} y={400} pulseSpeed={0.025} />

      <FadeIn delay={5} duration={15}>
        <h1
          style={{
            fontFamily: FONTS.body,
            fontSize: 64,
            fontWeight: 800,
            color: COLORS.text,
            letterSpacing: "-0.03em",
            textAlign: "center",
            margin: 0,
          }}
        >
          Mastering Workspace
        </h1>
      </FadeIn>

      {/* Animated divider line */}
      <div
        style={{
          width: lineWidth,
          height: 3,
          background: `linear-gradient(90deg, transparent, ${COLORS.accent}, transparent)`,
          marginTop: 24,
          borderRadius: 2,
        }}
      />

      <FadeIn delay={25} duration={15}>
        <p
          style={{
            fontFamily: FONTS.body,
            fontSize: 24,
            color: COLORS.textMuted,
            textAlign: "center",
            maxWidth: 700,
            lineHeight: 1.5,
            marginTop: 24,
          }}
        >
          Professional-grade analysis tools built right into your player.
          <br />
          No extra plugins needed.
        </p>
      </FadeIn>

      <FadeIn delay={40} duration={15}>
        <div
          style={{
            display: "flex",
            gap: 32,
            marginTop: 48,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {[
            "Spectrum Analyzer",
            "Loudness History",
            "Waveform Display",
            "Vectorscope",
            "Stereo Correlation",
            "Reference A/B",
            "M/S Monitoring",
            "K-Metering",
          ].map((label, i) => (
            <FadeIn key={label} delay={45 + i * 4} duration={15}>
              <div
                style={{
                  fontFamily: FONTS.body,
                  fontSize: 16,
                  color: COLORS.accent,
                  background: "rgba(92, 167, 255, 0.08)",
                  border: "1px solid rgba(92, 167, 255, 0.2)",
                  borderRadius: 8,
                  padding: "8px 20px",
                }}
              >
                {label}
              </div>
            </FadeIn>
          ))}
        </div>
      </FadeIn>
    </div>
  );
};
