import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";

const bands = [
  { name: "Sub", range: "20-60 Hz", start: 0, end: 0.05 },
  { name: "Low", range: "60-250 Hz", start: 0.05, end: 0.15 },
  { name: "Low-Mid", range: "250-500 Hz", start: 0.15, end: 0.28 },
  { name: "Mid", range: "500-2k Hz", start: 0.28, end: 0.5 },
  { name: "High-Mid", range: "2k-6k Hz", start: 0.5, end: 0.72 },
  { name: "High", range: "6k-20k Hz", start: 0.72, end: 1.0 },
];

export const BandSoloScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const width = 900;
  const height = 320;
  const numBars = 96;
  const barW = width / numBars;

  // Cycle through bands being soloed
  const soloIndex = Math.floor(interpolate(frame, [15, 85], [0, 5.99], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));

  // Spectrum bars grow from bottom with spring
  const spectrumSpring = spring({
    fps,
    frame: Math.max(0, frame - 10),
    config: { damping: 12, stiffness: 100, mass: 0.5 },
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
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
        padding: 80,
      }}
    >
      <GlowOrb color={COLORS.accent} size={500} x={300} y={100} pulseSpeed={0.02} drift={35} />
      <GlowOrb color={COLORS.green} size={400} x={1200} y={500} pulseSpeed={0.025} drift={30} />

      <FadeIn delay={0} duration={18} direction="right" distance={80} rotate={3} scaleFrom={0.7}>
        <FeatureLabel
          title="Frequency Band Soloing"
          subtitle="Click any frequency band to instantly solo it. Hear exactly what's happening in each range."
        />
      </FadeIn>

      <FadeIn delay={8} duration={18} direction="up" distance={50} rotate={-1}>
        <div
          style={{
            marginTop: 40,
            background: COLORS.bgCard,
            borderRadius: 12,
            padding: 24,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          {/* Band selector pills — each springs in staggered */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {bands.map((band, i) => {
              const isActive = i === soloIndex;
              const pillSpring = spring({
                fps,
                frame: Math.max(0, frame - 12 - i * 2),
                config: { damping: 11, stiffness: 130, mass: 0.4 },
              });
              const pillScale = interpolate(pillSpring, [0, 1], [0.3, 1]);
              const pillOpacity = interpolate(pillSpring, [0, 0.3], [0, 1], {
                extrapolateRight: "clamp",
              });

              return (
                <div
                  key={band.name}
                  style={{
                    fontFamily: FONTS.body,
                    fontSize: 13,
                    fontWeight: isActive ? 700 : 400,
                    color: isActive ? "#fff" : COLORS.textMuted,
                    background: isActive ? COLORS.accent : "rgba(255,255,255,0.06)",
                    borderRadius: 6,
                    padding: "6px 16px",
                    border: isActive ? `1px solid ${COLORS.accent}` : "1px solid transparent",
                    transform: `scale(${pillScale}) ${isActive ? "scale(1.08)" : ""}`,
                    opacity: pillOpacity,
                    willChange: "transform",
                  }}
                >
                  {band.name}
                  <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>
                    {band.range}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Spectrum with band highlighting — bars grow from bottom */}
          <svg width={width} height={height} style={{ display: "block" }}>
            <rect width={width} height={height} fill="rgba(255,255,255,0.02)" rx={4} />

            {Array.from({ length: numBars }).map((_, i) => {
              const freqNorm = i / numBars;
              const freqShape = Math.exp(-freqNorm * 2.2) * 0.75 + 0.08;
              const animation =
                Math.sin(frame * 0.08 + i * 0.4) * 0.15 +
                Math.sin(frame * 0.12 + i * 0.7) * 0.1;
              const barAmp = Math.max(0.03, Math.min(1, freqShape + animation));
              // Bars grow from bottom using spring
              const barH = barAmp * (height - 16) * spectrumSpring;
              const y = height - barH - 8;

              const activeBand = bands[soloIndex];
              const isInBand = freqNorm >= activeBand.start && freqNorm < activeBand.end;
              const hue = 200 + freqNorm * 60;

              return (
                <rect
                  key={i}
                  x={i * barW + 0.5}
                  y={y}
                  width={Math.max(1, barW - 1.5)}
                  height={barH}
                  rx={1}
                  fill={isInBand ? `hsl(${hue}, 80%, 60%)` : `hsl(${hue}, 30%, 25%)`}
                  opacity={isInBand ? 0.95 : 0.25}
                />
              );
            })}

            {/* Band boundary lines */}
            {bands.map((band) => (
              <line
                key={band.name}
                x1={band.start * width}
                y1={0}
                x2={band.start * width}
                y2={height}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth={1}
                strokeDasharray="4,4"
              />
            ))}
          </svg>

          {/* Currently soloed indicator */}
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              fontFamily: FONTS.body,
              fontSize: 12,
              color: COLORS.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}>
              Soloed:
            </div>
            <div style={{
              fontFamily: FONTS.mono,
              fontSize: 14,
              fontWeight: 700,
              color: COLORS.accent,
              background: "rgba(92, 167, 255, 0.1)",
              borderRadius: 4,
              padding: "4px 12px",
            }}>
              {bands[soloIndex].name} ({bands[soloIndex].range})
            </div>
          </div>
        </div>
      </FadeIn>
    </div>
  );
};
