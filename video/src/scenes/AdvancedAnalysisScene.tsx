import React from "react";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";
import { StatCard } from "../components/StatCard";

export const AdvancedAnalysisScene: React.FC = () => {
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
      <GlowOrb color="#7c3aed" size={500} x={300} y={200} pulseSpeed={0.02} drift={40} />
      <GlowOrb color={COLORS.accent} size={400} x={1200} y={500} pulseSpeed={0.025} drift={30} />

      <div style={{ marginTop: 80 }}>
        <FadeIn delay={0} duration={15}>
          <FeatureLabel
            title="Deep Analysis Tools"
            subtitle="K-Metering, Crest Factor, Clip Detection, DC Offset, and more"
          />
        </FadeIn>
      </div>

      {/* K-Metering section */}
      <div style={{ marginTop: 48, display: "flex", gap: 40, alignItems: "flex-start" }}>
        <FadeIn delay={10} duration={15}>
          <div
            style={{
              background: COLORS.bgCard,
              borderRadius: 12,
              padding: 32,
              border: `1px solid ${COLORS.border}`,
              width: 460,
            }}
          >
            <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted, marginBottom: 20, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              K-Metering
            </div>

            {/* K-14 */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontFamily: FONTS.body, fontSize: 15, color: COLORS.text, fontWeight: 600 }}>K-14 Reading</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 20, color: COLORS.accent, fontWeight: 700 }}>+0.2 dB</span>
              </div>
              <div style={{ height: 12, background: "rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ width: "72%", height: "100%", background: `linear-gradient(90deg, ${COLORS.green}, ${COLORS.yellow})`, borderRadius: 6 }} />
              </div>
              <div style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>
                0 dB = -14 dBFS (music production)
              </div>
            </div>

            {/* K-20 */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontFamily: FONTS.body, fontSize: 15, color: COLORS.text, fontWeight: 600 }}>K-20 Reading</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 20, color: COLORS.green, fontWeight: 700 }}>+6.2 dB</span>
              </div>
              <div style={{ height: 12, background: "rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ width: "58%", height: "100%", background: `linear-gradient(90deg, ${COLORS.green}, ${COLORS.accent})`, borderRadius: 6 }} />
              </div>
              <div style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>
                0 dB = -20 dBFS (film / classical)
              </div>
            </div>
          </div>
        </FadeIn>

        <FadeIn delay={20} duration={15}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 16 }}>
              <StatCard label="Crest Factor" value="11.4 dB" subtitle="Peak-to-RMS ratio" delay={25} accentColor={COLORS.accent} />
              <StatCard label="Clip Count" value="None" subtitle="No clipping detected" delay={29} accentColor={COLORS.green} />
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <StatCard label="DC Offset" value="Clean" subtitle="No DC bias" delay={33} accentColor={COLORS.green} />
              <StatCard label="Mean Volume" value="-17.6 dB" subtitle="RMS-based average" delay={37} />
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <StatCard label="Peak Momentary" value="-8.2 LUFS" subtitle="Highest 400ms window" delay={41} accentColor={COLORS.yellow} />
              <StatCard label="Sample Peak" value="-0.3 dBFS" subtitle="Highest digital sample" delay={45} />
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  );
};
