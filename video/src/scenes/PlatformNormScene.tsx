import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";

const platforms = [
  { name: "Spotify", target: -14, color: "#1DB954", ceiling: -1 },
  { name: "Apple Music", target: -16, color: "#fc3c44", ceiling: -1 },
  { name: "YouTube", target: -14, color: "#ff0000", ceiling: -1 },
  { name: "Tidal", target: -14, color: "#000000", ceiling: -1 },
  { name: "Amazon Music", target: -14, color: "#25d1da", ceiling: -2 },
  { name: "SoundCloud", target: -14, color: "#ff5500", ceiling: -1 },
];

export const PlatformNormScene: React.FC = () => {
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
        position: "relative",
        overflow: "hidden",
        padding: 80,
      }}
    >
      <GlowOrb color={COLORS.green} size={500} x={200} y={200} pulseSpeed={0.02} drift={35} />
      <GlowOrb color={COLORS.accent} size={400} x={1300} y={500} pulseSpeed={0.025} drift={30} />

      <div style={{ marginTop: 80 }}>
        <FadeIn delay={0} duration={15}>
          <FeatureLabel
            title="Platform Normalization Preview"
            subtitle="Hear exactly how Spotify, Apple Music, YouTube, and others will play your track"
          />
        </FadeIn>
      </div>

      <div style={{ marginTop: 48, display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
        {/* Platform grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
            width: 900,
          }}
        >
          {platforms.map((platform, i) => (
            <FadeIn
              key={platform.name}
              delay={12 + i * 5}
              duration={15}
            >
              <div
                style={{
                  background: COLORS.bgCard,
                  borderRadius: 10,
                  padding: "20px 24px",
                  border: `1px solid ${COLORS.border}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: platform.color,
                    }}
                  />
                  <span style={{ fontFamily: FONTS.body, fontSize: 16, fontWeight: 600, color: COLORS.text }}>
                    {platform.name}
                  </span>
                </div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 14, color: COLORS.accent }}>
                  {platform.target} LUFS target
                </div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.textMuted }}>
                  {platform.ceiling} dBTP ceiling
                </div>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Preview toggle */}
        <FadeIn delay={45} duration={15}>
          <div
            style={{
              background: COLORS.bgCard,
              borderRadius: 10,
              padding: "16px 32px",
              border: `1px solid ${COLORS.border}`,
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <span style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted }}>
              Normalization Preview
            </span>
            <div
              style={{
                fontFamily: FONTS.body,
                fontSize: 14,
                fontWeight: 600,
                color: COLORS.green,
                background: "rgba(95, 210, 143, 0.12)",
                border: "1px solid rgba(95, 210, 143, 0.3)",
                borderRadius: 6,
                padding: "6px 16px",
              }}
            >
              Preview On
            </div>
            <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.textMuted }}>
              Applied: -2.1 dB
            </span>
          </div>
        </FadeIn>
      </div>
    </div>
  );
};
