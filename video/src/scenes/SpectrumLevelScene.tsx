import React from "react";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";
import { AnimatedSpectrum } from "../components/AnimatedSpectrum";
import { AnimatedLevelMeter } from "../components/AnimatedLevelMeter";

export const SpectrumLevelScene: React.FC = () => {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: COLORS.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
        padding: 80,
      }}
    >
      <GlowOrb color={COLORS.accent} size={500} x={300} y={100} pulseSpeed={0.015} />

      <FadeIn delay={0} duration={18} direction="up">
        <FeatureLabel
          title="Real-time Spectrum & Level"
          subtitle="Clickable frequency bands for instant soloing. Full stereo level metering."
        />
      </FadeIn>

      <div
        style={{
          display: "flex",
          gap: 24,
          marginTop: 48,
          alignItems: "flex-end",
        }}
      >
        <FadeIn delay={10} duration={18} direction="left" distance={30}>
          <div
            style={{
              background: COLORS.bgCard,
              borderRadius: 12,
              padding: 24,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div
              style={{
                fontFamily: FONTS.body,
                fontSize: 14,
                color: COLORS.textMuted,
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Spectrum Analyzer
            </div>
            <AnimatedSpectrum width={900} height={280} delay={15} />

            {/* Band labels */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
                padding: "0 4px",
              }}
            >
              {["Sub", "Bass", "Low-Mid", "Mid", "Hi-Mid", "Presence", "Brilliance"].map(
                (label) => (
                  <span
                    key={label}
                    style={{
                      fontFamily: FONTS.mono,
                      fontSize: 10,
                      color: COLORS.textMuted,
                    }}
                  >
                    {label}
                  </span>
                )
              )}
            </div>
          </div>
        </FadeIn>

        <FadeIn delay={20} duration={18} direction="right" distance={30}>
          <div
            style={{
              background: COLORS.bgCard,
              borderRadius: 12,
              padding: 24,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div
              style={{
                fontFamily: FONTS.body,
                fontSize: 14,
                color: COLORS.textMuted,
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                textAlign: "center",
              }}
            >
              Level
            </div>
            <AnimatedLevelMeter width={50} height={280} delay={25} />
            <div
              style={{
                display: "flex",
                justifyContent: "space-around",
                marginTop: 6,
              }}
            >
              <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.textMuted }}>L</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.textMuted }}>R</span>
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  );
};
