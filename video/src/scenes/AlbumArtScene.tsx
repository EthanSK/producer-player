import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";

export const AlbumArtScene: React.FC = () => {
  const frame = useCurrentFrame();

  // Animated editing cursor blink
  const cursorVisible = Math.sin(frame * 0.3) > 0;

  // Typing animation for album title
  const fullTitle = "Midnight Sessions EP";
  const typedChars = Math.floor(
    interpolate(frame, [30, 60], [0, fullTitle.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );
  const displayTitle = fullTitle.substring(0, typedChars);

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
      <GlowOrb color="#e040fb" size={500} x={200} y={100} pulseSpeed={0.02} />
      <GlowOrb color={COLORS.accent} size={400} x={1300} y={500} pulseSpeed={0.025} />

      <FadeIn delay={0} duration={18} direction="up">
        <FeatureLabel
          title="Album Art & Project Links"
          subtitle="Set album artwork, edit titles, and link directly to your DAW project files"
        />
      </FadeIn>

      <FadeIn delay={8} duration={18} direction="up" distance={25}>
        <div style={{ marginTop: 40, display: "flex", gap: 40, alignItems: "flex-start" }}>
          {/* Album art preview */}
          <div
            style={{
              background: COLORS.bgCard,
              borderRadius: 12,
              padding: 24,
              border: `1px solid ${COLORS.border}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Album Artwork
            </div>

            {/* Placeholder album art with gradient */}
            <div
              style={{
                width: 280,
                height: 280,
                borderRadius: 8,
                background: "linear-gradient(135deg, #1a0a2e, #2d1b4e, #0d1b3e, #162847)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                overflow: "hidden",
                boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
              }}
            >
              {/* Decorative circles */}
              <div style={{
                position: "absolute",
                width: 200,
                height: 200,
                borderRadius: "50%",
                border: "1px solid rgba(255,255,255,0.08)",
                top: 40,
                left: 40,
              }} />
              <div style={{
                position: "absolute",
                width: 120,
                height: 120,
                borderRadius: "50%",
                border: "1px solid rgba(255,255,255,0.05)",
                top: 80,
                left: 80,
              }} />
              <div style={{
                fontFamily: FONTS.body,
                fontSize: 28,
                fontWeight: 800,
                color: "rgba(255,255,255,0.9)",
                letterSpacing: "-0.02em",
                textAlign: "center",
                zIndex: 1,
              }}>
                MS
              </div>
              <div style={{
                fontFamily: FONTS.body,
                fontSize: 12,
                color: "rgba(255,255,255,0.5)",
                marginTop: 4,
                zIndex: 1,
              }}>
                2024
              </div>
            </div>

            <div style={{ marginTop: 12, fontFamily: FONTS.body, fontSize: 12, color: COLORS.accent }}>
              280 x 280 px
            </div>
          </div>

          {/* Metadata editing */}
          <div
            style={{
              background: COLORS.bgCard,
              borderRadius: 12,
              padding: 28,
              border: `1px solid ${COLORS.border}`,
              width: 460,
            }}
          >
            <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted, marginBottom: 20, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Album Details
            </div>

            {/* Title field */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>
                Album Title
              </div>
              <div style={{
                background: "rgba(255,255,255,0.04)",
                borderRadius: 6,
                padding: "10px 14px",
                border: `1px solid ${COLORS.accent}40`,
                fontFamily: FONTS.body,
                fontSize: 16,
                color: COLORS.text,
                minHeight: 20,
              }}>
                {displayTitle}
                {cursorVisible && typedChars < fullTitle.length && (
                  <span style={{ display: "inline-block", width: 2, height: 18, background: COLORS.accent, marginLeft: 1, verticalAlign: "text-bottom" }} />
                )}
              </div>
            </div>

            {/* Artist */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>
                Artist
              </div>
              <div style={{
                background: "rgba(255,255,255,0.04)",
                borderRadius: 6,
                padding: "10px 14px",
                border: `1px solid ${COLORS.border}`,
                fontFamily: FONTS.body,
                fontSize: 16,
                color: COLORS.text,
              }}>
                Ethan
              </div>
            </div>

            {/* Project file link */}
            <div>
              <div style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.textMuted, marginBottom: 6 }}>
                Project File Link
              </div>
              <div style={{
                background: "rgba(255,255,255,0.04)",
                borderRadius: 6,
                padding: "10px 14px",
                border: `1px solid ${COLORS.border}`,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}>
                {/* File icon */}
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke={COLORS.accent} strokeWidth={2} fill="none" />
                  <polyline points="14,2 14,8 20,8" stroke={COLORS.accent} strokeWidth={2} fill="none" />
                </svg>
                <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.accent }}>
                  ~/Music/Midnight Sessions.als
                </span>
              </div>
              <div style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>
                Click to open directly in your DAW
              </div>
            </div>
          </div>
        </div>
      </FadeIn>
    </div>
  );
};
