import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";

export const ReferenceMatchScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animated toggle between Mix and Reference
  const toggleProgress = interpolate(
    Math.sin(frame * 0.04),
    [-1, 1],
    [0, 1]
  );
  const isMixActive = toggleProgress < 0.5;

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
      <GlowOrb color={COLORS.accent} size={600} x={300} y={200} pulseSpeed={0.02} drift={40} />
      <GlowOrb color={COLORS.yellow} size={400} x={1200} y={400} pulseSpeed={0.025} drift={30} />

      <div style={{ marginTop: 80 }}>
        <FadeIn delay={0} duration={15}>
          <FeatureLabel
            title="Reference Track A/B"
            subtitle="Instantly compare your mix against any reference track"
          />
        </FadeIn>
      </div>

      <div style={{ marginTop: 48, display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>
        {/* A/B Toggle — the focal point */}
        <FadeIn delay={10} duration={15}>
          <div
            style={{
              background: COLORS.bgCard,
              borderRadius: 12,
              padding: 32,
              border: `1px solid ${COLORS.border}`,
              width: 800,
            }}
          >
            <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted, marginBottom: 20, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Quick A/B Comparison
            </div>

            {/* Prominent A/B toggle */}
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              <div
                style={{
                  fontFamily: FONTS.body,
                  fontSize: 18,
                  fontWeight: 700,
                  color: isMixActive ? "#fff" : COLORS.textMuted,
                  background: isMixActive ? COLORS.accent : "rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: "14px 48px",
                  border: isMixActive ? `2px solid ${COLORS.accent}` : "2px solid transparent",
                }}
              >
                A — Your Mix
              </div>
              <div
                style={{
                  fontFamily: FONTS.body,
                  fontSize: 18,
                  fontWeight: 700,
                  color: !isMixActive ? "#fff" : COLORS.textMuted,
                  background: !isMixActive ? COLORS.green : "rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: "14px 48px",
                  border: !isMixActive ? `2px solid ${COLORS.green}` : "2px solid transparent",
                }}
              >
                B — Reference
              </div>
            </div>

            {/* Level Match toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted }}>
                Level Match
              </div>
              <div style={{
                fontFamily: FONTS.body,
                fontSize: 14,
                fontWeight: 600,
                color: COLORS.green,
                background: "rgba(95, 210, 143, 0.12)",
                border: "1px solid rgba(95, 210, 143, 0.3)",
                borderRadius: 6,
                padding: "6px 16px",
              }}>
                Level Match On
              </div>
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.textMuted }}>
                +2.3 dB
              </span>
            </div>

            {/* Reference track info */}
            <div style={{
              background: "rgba(255,255,255,0.03)",
              borderRadius: 8,
              padding: 20,
              border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>
                Active reference track
              </div>
              <div style={{ fontFamily: FONTS.body, fontSize: 16, fontWeight: 600, color: COLORS.text }}>
                Reference_Master_Final.wav
              </div>
              <div style={{ fontFamily: FONTS.body, fontSize: 13, color: COLORS.textMuted, marginTop: 4 }}>
                External file
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  );
};
