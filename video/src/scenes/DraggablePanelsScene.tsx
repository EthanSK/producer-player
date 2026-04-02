import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";

interface PanelDef {
  name: string;
  icon: string;
  color: string;
}

const panels: PanelDef[] = [
  { name: "Spectrum", icon: "~", color: COLORS.accent },
  { name: "Loudness", icon: "L", color: COLORS.green },
  { name: "Vectorscope", icon: "V", color: "#7c3aed" },
  { name: "Waveform", icon: "W", color: COLORS.yellow },
  { name: "Correlation", icon: "C", color: "#ff8c42" },
  { name: "Level Meter", icon: "M", color: COLORS.red },
];

export const DraggablePanelsScene: React.FC = () => {
  const frame = useCurrentFrame();

  // Grid layout positions (2 rows x 3 cols)
  const gridCols = 3;
  const panelW = 260;
  const panelH = 160;
  const gap = 16;
  const gridW = gridCols * panelW + (gridCols - 1) * gap;

  // Animate two panels swapping positions (indices 1 and 4)
  const swapStart = 30;
  const swapEnd = 55;
  const swapProgress = interpolate(frame, [swapStart, swapEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Ease function
  const eased = 0.5 - 0.5 * Math.cos(swapProgress * Math.PI);

  function getGridPos(index: number): { x: number; y: number } {
    const col = index % gridCols;
    const row = Math.floor(index / gridCols);
    return {
      x: col * (panelW + gap),
      y: row * (panelH + gap),
    };
  }

  function getPanelPos(index: number): { x: number; y: number } {
    if (index === 1) {
      const from = getGridPos(1);
      const to = getGridPos(4);
      return {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
      };
    }
    if (index === 4) {
      const from = getGridPos(4);
      const to = getGridPos(1);
      return {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
      };
    }
    return getGridPos(index);
  }

  // Dragging visual: scale up the panels being swapped
  const dragScale = index => {
    if (index !== 1 && index !== 4) return 1;
    if (swapProgress <= 0 || swapProgress >= 1) return 1;
    return 1 + Math.sin(swapProgress * Math.PI) * 0.06;
  };

  const dragShadow = (index: number) => {
    if (index !== 1 && index !== 4) return "none";
    if (swapProgress <= 0 || swapProgress >= 1) return "none";
    const intensity = Math.sin(swapProgress * Math.PI);
    return `0 ${8 * intensity}px ${24 * intensity}px rgba(0,0,0,0.5)`;
  };

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
      <GlowOrb color={COLORS.accent} size={500} x={200} y={150} pulseSpeed={0.02} />
      <GlowOrb color="#7c3aed" size={400} x={1300} y={500} pulseSpeed={0.025} />

      <FadeIn delay={0} duration={18} direction="up">
        <FeatureLabel
          title="Customizable Workspace"
          subtitle="Drag and rearrange mastering panels to build your ideal layout"
        />
      </FadeIn>

      <FadeIn delay={8} duration={18} direction="up" distance={25}>
        <div
          style={{
            marginTop: 48,
            position: "relative",
            width: gridW,
            height: 2 * panelH + gap,
          }}
        >
          {panels.map((panel, i) => {
            const pos = getPanelPos(i);
            const scale = dragScale(i);
            const shadow = dragShadow(i);
            const isSwapping = (i === 1 || i === 4) && swapProgress > 0 && swapProgress < 1;

            return (
              <div
                key={panel.name}
                style={{
                  position: "absolute",
                  left: pos.x,
                  top: pos.y,
                  width: panelW,
                  height: panelH,
                  background: COLORS.bgCard,
                  borderRadius: 10,
                  border: `1px solid ${isSwapping ? panel.color : COLORS.border}`,
                  padding: 20,
                  transform: `scale(${scale})`,
                  boxShadow: shadow,
                  zIndex: isSwapping ? 10 : 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: `${panel.color}20`,
                    border: `1px solid ${panel.color}40`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: FONTS.mono,
                    fontSize: 14,
                    fontWeight: 700,
                    color: panel.color,
                  }}>
                    {panel.icon}
                  </div>
                  <span style={{ fontFamily: FONTS.body, fontSize: 15, fontWeight: 600, color: COLORS.text }}>
                    {panel.name}
                  </span>
                </div>

                {/* Mini visualization placeholder */}
                <div style={{
                  height: 60,
                  background: "rgba(255,255,255,0.02)",
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "flex-end",
                  padding: "0 4px 4px",
                  gap: 2,
                }}>
                  {Array.from({ length: 16 }).map((_, j) => {
                    const barH = interpolate(
                      Math.sin(frame * 0.06 + j * 0.5 + i * 2),
                      [-1, 1],
                      [8, 48]
                    );
                    return (
                      <div
                        key={j}
                        style={{
                          flex: 1,
                          height: barH,
                          background: panel.color,
                          opacity: 0.4,
                          borderRadius: 1,
                        }}
                      />
                    );
                  })}
                </div>

                {/* Drag handle indicator */}
                <div style={{
                  position: "absolute",
                  top: 8,
                  right: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}>
                  {[0, 1, 2].map(k => (
                    <div key={k} style={{
                      width: 12,
                      height: 2,
                      background: "rgba(255,255,255,0.15)",
                      borderRadius: 1,
                    }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </FadeIn>
    </div>
  );
};
