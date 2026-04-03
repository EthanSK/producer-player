import React from "react";
import { COLORS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { AppScreenshot } from "../components/AppScreenshot";
import { FeatureLabel } from "../components/FeatureLabel";

export const ChecklistScene: React.FC = () => {
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
      <GlowOrb color={COLORS.yellow} size={500} x={200} y={200} pulseSpeed={0.02} drift={35} />
      <GlowOrb color={COLORS.accent} size={400} x={1300} y={500} pulseSpeed={0.025} drift={30} />

      <FadeIn delay={0} duration={18} direction="right" distance={80} rotate={2} scaleFrom={0.75}>
        <FeatureLabel
          title="Song Checklists & Notes"
          subtitle="Track mix notes per song. Mark items done. Import from any app via LLM migration."
        />
      </FadeIn>

      <div style={{ marginTop: 40 }}>
        <AppScreenshot src="images/app-hero-checklist.png" width={1200} delay={10} />
      </div>
    </div>
  );
};
