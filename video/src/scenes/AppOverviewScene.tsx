import React from "react";
import { useCurrentFrame } from "remotion";
import { COLORS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { AppScreenshot } from "../components/AppScreenshot";
import { FeatureLabel } from "../components/FeatureLabel";

export const AppOverviewScene: React.FC = () => {
  const frame = useCurrentFrame();

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
      <GlowOrb color={COLORS.accent} size={500} x={100} y={200} pulseSpeed={0.015} />
      <GlowOrb color="#7c3aed" size={400} x={1400} y={600} pulseSpeed={0.02} />

      <FadeIn delay={0} duration={18} direction="up" distance={25}>
        <FeatureLabel
          title="Your entire album at a glance"
          subtitle="Link folders, auto-detect versions, track every mix iteration"
        />
      </FadeIn>

      <div style={{ marginTop: 40 }}>
        <AppScreenshot width={1400} delay={10} />
      </div>
    </div>
  );
};
