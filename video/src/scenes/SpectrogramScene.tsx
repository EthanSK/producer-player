import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";

export const SpectrogramScene: React.FC = () => {
  const frame = useCurrentFrame();

  const width = 900;
  const height = 400;
  const cols = 120;
  const rows = 60;
  const cellW = width / cols;
  const cellH = height / rows;

  // Animated playback sweep
  const sweepCol = interpolate(frame, [10, 85], [0, cols], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Container opacity
  const containerOpacity = interpolate(frame, [8, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
      <GlowOrb color="#7c3aed" size={500} x={200} y={100} pulseSpeed={0.02} drift={35} />
      <GlowOrb color={COLORS.red} size={400} x={1300} y={500} pulseSpeed={0.025} drift={30} />

      <div style={{ marginTop: 80 }}>
        <FadeIn delay={0} duration={15}>
          <FeatureLabel
            title="Spectrogram — Time x Frequency"
            subtitle="Visualize frequency energy over time with a scrolling heatmap display"
          />
        </FadeIn>
      </div>

      <div
        style={{
          marginTop: 40,
          opacity: containerOpacity,
        }}
      >
        <div
          style={{
            background: COLORS.bgCard,
            borderRadius: 12,
            padding: 24,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Spectrogram
          </div>
          <svg width={width} height={height} style={{ display: "block" }}>
            <rect width={width} height={height} fill="rgba(0,0,20,0.8)" rx={4} />
            {Array.from({ length: Math.min(Math.ceil(sweepCol), cols) }).map((_, col) =>
              Array.from({ length: rows }).map((_, row) => {
                const freqNorm = row / rows;
                const bassWeight = Math.exp(-freqNorm * 3) * 0.8;
                const midBump = Math.exp(-Math.pow((freqNorm - 0.3) * 5, 2)) * 0.4;
                const highDecay = Math.exp(-freqNorm * 6) * 0.2;
                const timeVariation =
                  Math.sin(col * 0.15 + row * 0.1) * 0.3 +
                  Math.sin(col * 0.08 + row * 0.3) * 0.2;
                const energy = Math.max(0, Math.min(1, bassWeight + midBump + highDecay + timeVariation));

                const r = Math.floor(interpolate(energy, [0, 0.3, 0.6, 0.8, 1], [10, 20, 50, 220, 255], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
                const g = Math.floor(interpolate(energy, [0, 0.3, 0.6, 0.8, 1], [10, 40, 180, 200, 60], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
                const b = Math.floor(interpolate(energy, [0, 0.3, 0.6, 0.8, 1], [40, 140, 200, 80, 20], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

                return (
                  <rect
                    key={`${col}-${row}`}
                    x={col * cellW}
                    y={height - (row + 1) * cellH}
                    width={cellW + 0.5}
                    height={cellH + 0.5}
                    fill={`rgb(${r},${g},${b})`}
                    opacity={0.85}
                  />
                );
              })
            )}
            {/* Playhead */}
            <line
              x1={Math.min(sweepCol, cols) * cellW}
              y1={0}
              x2={Math.min(sweepCol, cols) * cellW}
              y2={height}
              stroke={COLORS.text}
              strokeWidth={2}
              opacity={0.7}
            />
          </svg>

          {/* Axis labels */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.textMuted }}>0s</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.textMuted }}>Time</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.textMuted }}>30s</span>
          </div>
        </div>
      </div>
    </div>
  );
};
