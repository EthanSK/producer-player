import React from "react";
import { COLORS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { AppScreenshot } from "../components/AppScreenshot";
import { FeatureLabel } from "../components/FeatureLabel";

export const AppOverviewScene: React.FC = () => {
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
        padding: "60px 60px 40px",
      }}
    >
      <GlowOrb color={COLORS.accent} size={500} x={100} y={200} pulseSpeed={0.015} drift={45} />
      <GlowOrb color="#7c3aed" size={400} x={1400} y={600} pulseSpeed={0.02} drift={30} />

      <div style={{ marginTop: 80 }}>
        <FadeIn delay={0} duration={15}>
          <FeatureLabel
            title="Auto Organize & Track Your Album"
            subtitle="Link folders, auto-detect versions, track every mix iteration"
          />
        </FadeIn>
      </div>

      <div style={{ marginTop: 32 }}>
        <FadeIn delay={10} duration={15}>
          <AppScreenshot width={1200} delay={10} />
        </FadeIn>
      </div>
    </div>
  );
};
