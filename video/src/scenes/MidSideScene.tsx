import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";

const midColor = COLORS.accent;
const sideColor = "#ff8c42"; // orange

function generateSpectrumCurve(
  numPoints: number,
  frame: number,
  seed: number
): number[] {
  const data: number[] = [];
  for (let i = 0; i < numPoints; i++) {
    const freqNorm = i / numPoints;
    const base = Math.exp(-freqNorm * 2.5) * 0.8 + 0.05;
    const animation =
      Math.sin(frame * 0.07 + i * 0.3 + seed) * 0.12 +
      Math.sin(frame * 0.11 + i * 0.5 + seed * 2) * 0.08;
    data.push(Math.max(0.02, Math.min(1, base + animation)));
  }
  return data;
}

export const MidSideScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const width = 900;
  const height = 340;
  const padding = { left: 50, right: 12, top: 20, bottom: 30 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const midData = generateSpectrumCurve(128, frame, 0);
  const sideData = generateSpectrumCurve(128, frame, 5).map(
    (v) => v * 0.55 + Math.sin(frame * 0.05) * 0.05
  );

  // SVG curves spring into view
  const curveSpring = spring({
    fps,
    frame: Math.max(0, frame - 10),
    config: { damping: 14, stiffness: 100, mass: 0.5 },
  });

  function toPath(data: number[]): string {
    return data
      .map((val, i) => {
        const x = padding.left + (i / (data.length - 1)) * plotW;
        // Spring affects the vertical scale
        const y = padding.top + (1 - val * curveSpring) * plotH;
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  }

  function toFillPath(data: number[]): string {
    const path = toPath(data);
    const lastX = padding.left + plotW;
    const firstX = padding.left;
    const bottom = padding.top + plotH;
    return `${path} L${lastX},${bottom} L${firstX},${bottom} Z`;
  }

  const gridDb = [-10, -20, -30, -40, -50];

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
      <GlowOrb color={COLORS.accent} size={500} x={200} y={100} pulseSpeed={0.02} drift={35} />
      <GlowOrb color="#ff8c42" size={400} x={1300} y={500} pulseSpeed={0.025} drift={30} />

      <FadeIn delay={0} duration={18} direction="left" distance={80} rotate={-3} scaleFrom={0.7}>
        <FeatureLabel
          title="Mid/Side Analysis"
          subtitle="Compare the center (Mid) and stereo (Side) spectrums in real time"
        />
      </FadeIn>

      <FadeIn delay={8} duration={18} direction="up" distance={60} rotate={2}>
        <div
          style={{
            marginTop: 40,
            background: COLORS.bgCard,
            borderRadius: 12,
            padding: 24,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div style={{ display: "flex", gap: 24, marginBottom: 16, alignItems: "center" }}>
            <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Mid/Side Spectrum
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 12, height: 3, borderRadius: 2, background: midColor }} />
                <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: midColor }}>Mid</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 12, height: 3, borderRadius: 2, background: sideColor }} />
                <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: sideColor }}>Side</span>
              </div>
            </div>
          </div>

          <svg width={width} height={height} style={{ display: "block" }}>
            <rect x={padding.left} y={padding.top} width={plotW} height={plotH}
              fill="rgba(255,255,255,0.02)" rx={4} />

            {/* Grid lines */}
            {gridDb.map((db, i) => {
              const y = padding.top + (i / (gridDb.length - 1)) * plotH;
              return (
                <g key={db}>
                  <line x1={padding.left} y1={y} x2={padding.left + plotW} y2={y}
                    stroke="rgba(255,255,255,0.06)" strokeDasharray="4,4" />
                  <text x={padding.left - 6} y={y + 4} textAnchor="end"
                    fill={COLORS.textMuted} fontSize={10} fontFamily={FONTS.mono}>
                    {db} dB
                  </text>
                </g>
              );
            })}

            {/* Freq labels */}
            {["20", "100", "500", "2k", "10k", "20k"].map((label, i, arr) => {
              const x = padding.left + (i / (arr.length - 1)) * plotW;
              return (
                <text key={label} x={x} y={height - 6} textAnchor="middle"
                  fill={COLORS.textMuted} fontSize={10} fontFamily={FONTS.mono}>
                  {label}
                </text>
              );
            })}

            {/* Side fill */}
            <path d={toFillPath(sideData)} fill={sideColor} opacity={0.12} />
            {/* Mid fill */}
            <path d={toFillPath(midData)} fill={midColor} opacity={0.12} />

            {/* Side curve */}
            <path d={toPath(sideData)} fill="none" stroke={sideColor}
              strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
            {/* Mid curve */}
            <path d={toPath(midData)} fill="none" stroke={midColor}
              strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
          </svg>
        </div>
      </FadeIn>
    </div>
  );
};
