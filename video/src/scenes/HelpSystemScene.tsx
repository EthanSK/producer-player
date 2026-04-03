import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";

// Real tutorial data from the app's helpTooltipLinks.ts
const tutorials = [
  { title: "Understanding LUFS", channel: "Ben Kestok", color: "#5ca7ff" },
  { title: "True Peak Limiting", channel: "Streaky", color: "#fbbf24" },
  { title: "Mastering with References", channel: "iZotope", color: "#5fd28f" },
  { title: "Spectrum Analyzer Tips", channel: "In The Mix", color: "#7c3aed" },
  { title: "Mid/Side EQ Simplified", channel: "In The Mix", color: "#ff8c42" },
  { title: "K-System Metering", channel: "MeterPlugs", color: "#f87171" },
  { title: "Phase Correlation Meter", channel: "AM Music", color: "#5ca7ff" },
  { title: "DC Offset Explained", channel: "Sweetwater", color: "#5fd28f" },
  { title: "Stereo Width Tips", channel: "Cableguys", color: "#fbbf24" },
];

export const HelpSystemScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Modal pop-up opacity
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
        position: "relative",
        overflow: "hidden",
        padding: 80,
      }}
    >
      <GlowOrb color={COLORS.yellow} size={500} x={200} y={100} pulseSpeed={0.02} />
      <GlowOrb color={COLORS.accent} size={400} x={1300} y={500} pulseSpeed={0.025} />

      <div style={{ marginTop: 80 }}>
        <FadeIn delay={0} duration={15}>
          <FeatureLabel
            title="Built-in Tutorials"
            subtitle="AI-ranked YouTube tutorials for every panel, right inside the app"
          />
        </FadeIn>
      </div>

      {/* Background app mockup (dimmed) */}
      <FadeIn delay={5} duration={15}>
        <div
          style={{
            marginTop: 36,
            position: "relative",
            width: 900,
            height: 520,
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
            opacity: 0.3,
          }}>
            {/* Fake toolbar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f56" }} />
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ffbd2e" }} />
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#27c93f" }} />
            </div>
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
              transform: "translate(-50%, -50%)",
              opacity: modalOpacity,
              background: "#111922",
              borderRadius: 12,
              border: "1px solid #2b3a49",
              padding: "20px 24px",
              width: 760,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            {/* Modal header */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 12,
            }}>
              <div style={{
                fontFamily: FONTS.body,
                fontSize: 13,
                lineHeight: "1.55",
                color: "#c6d5e8",
                whiteSpace: "pre-wrap",
                paddingRight: 28,
              }}>
                Click the{" "}
                <span style={{
                  display: "inline-flex",
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: "1px solid rgba(156,175,196,0.25)",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  color: "#9cafc4",
                  verticalAlign: "middle",
                }}>?</span>
                {" "}icon on any panel for context-specific help and curated video tutorials.
              </div>
              <div style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                border: "1px solid rgba(156,175,196,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
                color: "#9cafc4",
                flexShrink: 0,
              }}>
                x
              </div>
            </div>

            {/* LUFS explainer paragraph */}
            <div style={{
              borderTop: "1px solid rgba(156,175,196,0.15)",
              paddingTop: 12,
              marginBottom: 12,
            }}>
              <p style={{
                fontFamily: FONTS.body,
                fontSize: 12,
                lineHeight: 1.6,
                color: "#9cafc4",
                margin: 0,
              }}>
                LUFS (Loudness Units Full Scale) measures perceived loudness.
                Spotify targets -14 LUFS, Apple Music -16 LUFS, and YouTube -14 LUFS.
                Understanding these standards is essential for competitive masters.
              </p>
            </div>

            {/* Video tutorials section */}
            <div style={{
              paddingTop: 12,
              borderTop: "1px solid rgba(156,175,196,0.15)",
            }}>
              <span style={{
                fontFamily: FONTS.body,
                fontSize: 12,
                fontWeight: 600,
                color: "#7a8fa3",
                marginBottom: 8,
                display: "block",
              }}>
                Video Tutorials (ranked by AI)
              </span>

              {/* 3x3 grid of video cards */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10,
                marginTop: 8,
              }}>
                {tutorials.map((tutorial, i) => {
                  const cardDelay = 25 + i * 3;
                  const cardOpacity = interpolate(frame, [cardDelay, cardDelay + 10], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  });

                  return (
                    <div
                      key={tutorial.title}
                      style={{
                        opacity: cardOpacity,
                        borderRadius: 6,
                        overflow: "hidden",
                        border: "1px solid rgba(156,175,196,0.15)",
                        background: "#0d1520",
                      }}
                    >
                      {/* Fake YouTube thumbnail */}
                      <div style={{
                        width: "100%",
                        aspectRatio: "16 / 9",
                        background: `linear-gradient(135deg, ${tutorial.color}30, ${tutorial.color}10)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                      }}>
                        {/* Play button */}
                        <div style={{
                          width: 32,
                          height: 22,
                          background: "rgba(255,0,0,0.85)",
                          borderRadius: 4,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}>
                          <div style={{
                            width: 0,
                            height: 0,
                            borderLeft: "8px solid white",
                            borderTop: "5px solid transparent",
                            borderBottom: "5px solid transparent",
                            marginLeft: 2,
                          }} />
                        </div>
                        {/* AI rank badge */}
                        <div style={{
                          position: "absolute",
                          top: 4,
                          left: 4,
                          fontFamily: FONTS.mono,
                          fontSize: 8,
                          color: "#fff",
                          background: "rgba(0,0,0,0.7)",
                          borderRadius: 3,
                          padding: "1px 4px",
                        }}>
                          #{i + 1}
                        </div>
                      </div>
                      {/* Caption */}
                      <div style={{
                        fontSize: 9,
                        lineHeight: "1.35",
                        padding: "4px 6px",
                        color: "#9cafc4",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: FONTS.body,
                      }}>
                        {tutorial.title} - {tutorial.channel}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </FadeIn>
    </div>
  );
};
