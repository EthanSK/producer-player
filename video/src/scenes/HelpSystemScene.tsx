import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";

export const HelpSystemScene: React.FC = () => {
  const frame = useCurrentFrame();

  // Modal pop-up animation
  const modalScale = interpolate(frame, [15, 30], [0.85, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const modalOpacity = interpolate(frame, [15, 25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Backdrop
  const backdropOpacity = interpolate(frame, [12, 20], [0, 0.5], {
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
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
        padding: 80,
      }}
    >
      <GlowOrb color={COLORS.yellow} size={500} x={200} y={100} pulseSpeed={0.02} />
      <GlowOrb color={COLORS.accent} size={400} x={1300} y={500} pulseSpeed={0.025} />

      <FadeIn delay={0} duration={18} direction="up">
        <FeatureLabel
          title="Built-in Tutorials"
          subtitle="Professional mastering education and keyboard shortcuts right inside the app"
        />
      </FadeIn>

      {/* Background app mockup (dimmed) */}
      <FadeIn delay={5} duration={15} direction="none">
        <div
          style={{
            marginTop: 36,
            position: "relative",
            width: 900,
            height: 480,
          }}
        >
          {/* Dimmed background */}
          <div style={{
            width: "100%",
            height: "100%",
            background: COLORS.bgCard,
            borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
            padding: 20,
            opacity: 0.4,
          }}>
            {/* Fake toolbar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f56" }} />
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ffbd2e" }} />
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#27c93f" }} />
            </div>
            {/* Fake content lines */}
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{
                width: `${60 + Math.sin(i) * 20}%`,
                height: 14,
                background: "rgba(255,255,255,0.04)",
                borderRadius: 4,
                marginBottom: 12,
              }} />
            ))}
          </div>

          {/* Backdrop overlay */}
          <div style={{
            position: "absolute",
            inset: 0,
            background: "black",
            borderRadius: 12,
            opacity: backdropOpacity,
          }} />

          {/* Tutorial content modal */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: `translate(-50%, -50%) scale(${modalScale})`,
              opacity: modalOpacity,
              background: COLORS.bgCard,
              borderRadius: 16,
              border: `1px solid ${COLORS.border}`,
              padding: 32,
              width: 740,
              boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}
          >
            {/* Modal header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontFamily: FONTS.body, fontSize: 22, fontWeight: 700, color: COLORS.text }}>
                Mastering Tutorials
              </div>
              <div style={{
                fontFamily: FONTS.mono,
                fontSize: 12,
                color: COLORS.textMuted,
                background: "rgba(255,255,255,0.06)",
                borderRadius: 4,
                padding: "4px 10px",
              }}>
                ?
              </div>
            </div>

            {/* Tutorial content - real mastering education */}
            <FadeIn delay={25} duration={15} direction="up" distance={15}>
              <div style={{
                background: "linear-gradient(135deg, rgba(10,22,40,0.9), rgba(22,32,64,0.9))",
                borderRadius: 10,
                padding: 24,
                marginBottom: 16,
                border: `1px solid ${COLORS.border}`,
              }}>
                <div style={{
                  fontFamily: FONTS.body,
                  fontSize: 16,
                  fontWeight: 700,
                  color: COLORS.accent,
                  marginBottom: 14,
                  letterSpacing: "0.02em",
                }}>
                  Understanding EQ
                </div>

                <div style={{
                  fontFamily: FONTS.body,
                  fontSize: 13,
                  color: "rgba(255,255,255,0.85)",
                  lineHeight: "1.7",
                  marginBottom: 12,
                }}>
                  Cut narrow, boost wide. Start with subtractive EQ to remove problem frequencies before boosting. Use a high-pass filter around 30-40 Hz to clean low-end rumble.
                </div>

                <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
                  <div style={{
                    flex: 1,
                    background: "rgba(255,255,255,0.04)",
                    borderRadius: 6,
                    padding: "10px 14px",
                    border: `1px solid rgba(255,255,255,0.06)`,
                  }}>
                    <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.yellow, marginBottom: 4, fontWeight: 700 }}>
                      COMPRESSION
                    </div>
                    <div style={{ fontFamily: FONTS.body, fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: "1.6" }}>
                      2-4 dB gain reduction for gentle glue. Attack 10-30ms, release 50-100ms. Use your ears, not your eyes.
                    </div>
                  </div>
                  <div style={{
                    flex: 1,
                    background: "rgba(255,255,255,0.04)",
                    borderRadius: 6,
                    padding: "10px 14px",
                    border: `1px solid rgba(255,255,255,0.06)`,
                  }}>
                    <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.green, marginBottom: 4, fontWeight: 700 }}>
                      LIMITING
                    </div>
                    <div style={{ fontFamily: FONTS.body, fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: "1.6" }}>
                      Target -14 LUFS for streaming. Aim for 1-2 dB of limiting max. Preserve transients and dynamic range.
                    </div>
                  </div>
                </div>
              </div>
            </FadeIn>

            {/* Quick links */}
            <FadeIn delay={40} duration={15} direction="up" distance={10}>
              <div style={{ display: "flex", gap: 12 }}>
                {[
                  { label: "Keyboard Shortcuts", icon: "K" },
                  { label: "Stereo Imaging", icon: "S" },
                  { label: "Loudness Standards", icon: "L" },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      flex: 1,
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: 8,
                      padding: "12px 16px",
                      border: `1px solid ${COLORS.border}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div style={{
                      width: 24,
                      height: 24,
                      borderRadius: 4,
                      background: `${COLORS.accent}15`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: FONTS.mono,
                      fontSize: 11,
                      fontWeight: 700,
                      color: COLORS.accent,
                    }}>
                      {item.icon}
                    </div>
                    <span style={{ fontFamily: FONTS.body, fontSize: 13, color: COLORS.text }}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
        </div>
      </FadeIn>
    </div>
  );
};
