import React from "react";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";
import { AnimatedLoudnessGraph } from "../components/AnimatedLoudnessGraph";
import { AnimatedWaveform } from "../components/AnimatedWaveform";
import { StatCard } from "../components/StatCard";

export const LoudnessWaveformScene: React.FC = () => {
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
        padding: 60,
      }}
    >
      <GlowOrb color={COLORS.accent} size={600} x={200} y={100} pulseSpeed={0.015} />
      <GlowOrb color={COLORS.green} size={400} x={1300} y={600} pulseSpeed={0.02} />

      <FadeIn delay={0} duration={18} direction="up">
        <FeatureLabel
          title="Loudness History & Waveform"
          subtitle="Track LUFS over time with an animated playback cursor. See the full waveform at a glance."
        />
      </FadeIn>

      <div style={{ marginTop: 36 }}>
        <FadeIn delay={10} duration={18} direction="up" distance={25}>
          <div
            style={{
              background: COLORS.bgCard,
              borderRadius: 12,
              padding: 24,
              border: `1px solid ${COLORS.border}`,
              marginBottom: 20,
            }}
          >
            <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Loudness History (LUFS over time)
            </div>
            <AnimatedLoudnessGraph width={1000} height={200} delay={15} />
          </div>
        </FadeIn>

        <FadeIn delay={25} duration={18} direction="up" distance={25}>
          <div
            style={{
              background: COLORS.bgCard,
              borderRadius: 12,
              padding: 24,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Waveform Display
            </div>
            <AnimatedWaveform width={1000} height={120} delay={30} />
          </div>
        </FadeIn>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
        <StatCard label="Integrated LUFS" value="-14.2" delay={40} />
        <StatCard label="True Peak" value="-0.8 dBTP" delay={44} />
        <StatCard label="Loudness Range" value="8.4 LU" delay={48} />
        <StatCard label="Peak Short-term" value="-11.3 LUFS" delay={52} />
      </div>
    </div>
  );
};
