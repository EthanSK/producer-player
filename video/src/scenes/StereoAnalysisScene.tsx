import React from "react";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";
import { AnimatedVectorscope } from "../components/AnimatedVectorscope";
import { AnimatedCorrelationMeter } from "../components/AnimatedCorrelationMeter";

export const StereoAnalysisScene: React.FC = () => {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: COLORS.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        position: "relative",
        overflow: "hidden",
        padding: 80,
      }}
    >
      <GlowOrb color={COLORS.green} size={600} x={400} y={200} pulseSpeed={0.02} drift={40} />
      <GlowOrb color="#7c3aed" size={400} x={1200} y={400} pulseSpeed={0.025} drift={30} />

      <div style={{ marginTop: 80 }}>
        <FadeIn delay={0} duration={15}>
          <FeatureLabel
            title="Stereo Field Analysis"
            subtitle="Visualize your stereo image. Catch phase issues before they become problems."
          />
        </FadeIn>
      </div>

      <div
        style={{
          display: "flex",
          gap: 64,
          marginTop: 48,
          alignItems: "center",
        }}
      >
        {/* Vectorscope */}
        <FadeIn delay={10} duration={15}>
          <div
            style={{
              background: COLORS.bgCard,
              borderRadius: 12,
              padding: 32,
              border: `1px solid ${COLORS.border}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Vectorscope (XY Stereo Plot)
            </div>
            <AnimatedVectorscope size={320} delay={15} />
            <p style={{ fontFamily: FONTS.body, fontSize: 13, color: COLORS.textMuted, marginTop: 12, textAlign: "center", maxWidth: 280 }}>
              Real-time XY plot of the stereo field.
              Wider spreads indicate more stereo width.
            </p>
          </div>
        </FadeIn>

        {/* Correlation + M/S info */}
        <FadeIn delay={20} duration={15}>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div
              style={{
                background: COLORS.bgCard,
                borderRadius: 12,
                padding: 32,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Stereo Correlation Meter
              </div>
              <AnimatedCorrelationMeter width={500} height={50} delay={25} />
              <p style={{ fontFamily: FONTS.body, fontSize: 13, color: COLORS.textMuted, marginTop: 12, maxWidth: 460 }}>
                +1 = perfect mono compatibility. 0 = uncorrelated. -1 = out of phase.
              </p>
            </div>

            {/* Mid/Side Monitoring card */}
            <div
              style={{
                background: COLORS.bgCard,
                borderRadius: 12,
                padding: 32,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Mid/Side Monitoring
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {["Stereo", "Mid", "Side"].map((mode, i) => (
                  <div
                    key={mode}
                    style={{
                      fontFamily: FONTS.body,
                      fontSize: 15,
                      color: i === 0 ? COLORS.text : COLORS.textMuted,
                      background: i === 0 ? COLORS.accent : "rgba(255,255,255,0.06)",
                      borderRadius: 6,
                      padding: "8px 24px",
                      fontWeight: i === 0 ? 600 : 400,
                    }}
                  >
                    {mode}
                  </div>
                ))}
              </div>
              <p style={{ fontFamily: FONTS.body, fontSize: 13, color: COLORS.textMuted, marginTop: 12, maxWidth: 460 }}>
                Instantly solo the Mid or Side channel to check mono compatibility
                and stereo width decisions.
              </p>
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  );
};
