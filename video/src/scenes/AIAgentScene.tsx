import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONTS } from "../theme";
import { GlowOrb } from "../components/GlowOrb";
import { FadeIn } from "../components/FadeIn";
import { FeatureLabel } from "../components/FeatureLabel";

const chatMessages = [
  { role: "user", text: "How does my master sound? Any issues?" },
  {
    role: "assistant",
    text: "Looking at your analysis data, here are my recommendations:\n\n1. Your integrated loudness is -14.2 LUFS which is perfect for streaming platforms.\n2. The low-end has a slight buildup around 120 Hz — consider a gentle high-pass or dynamic EQ.\n3. Stereo correlation is healthy at +0.7, but the Side channel is a bit hot above 8 kHz.\n4. True peak is -0.3 dBTP — you have headroom but it's tight for Apple Music's -1 dBTP ceiling.",
  },
];

export const AIAgentScene: React.FC = () => {
  const frame = useCurrentFrame();

  // User message appears first
  const userMsgOpacity = interpolate(frame, [8, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Then the assistant types
  const fullText = chatMessages[1].text;
  const typingStart = 22;
  const charsPerFrame = 3.5;
  const visibleChars = Math.floor(
    interpolate(frame, [typingStart, typingStart + fullText.length / charsPerFrame], [0, fullText.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );
  const displayedText = fullText.substring(0, visibleChars);

  const assistantOpacity = interpolate(frame, [20, 25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Blinking cursor
  const showCursor = visibleChars < fullText.length && frame > typingStart;

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
      <GlowOrb color="#7c3aed" size={600} x={300} y={100} pulseSpeed={0.02} />
      <GlowOrb color={COLORS.green} size={400} x={1200} y={500} pulseSpeed={0.025} />

      <FadeIn delay={0} duration={18} direction="up">
        <FeatureLabel
          title="Produciboi — AI Mastering Assistant"
          subtitle="Ask your AI agent about your mix. Get instant, data-driven mastering recommendations."
        />
      </FadeIn>

      <FadeIn delay={5} duration={18} direction="up" distance={25}>
        <div
          style={{
            marginTop: 36,
            background: COLORS.bgCard,
            borderRadius: 12,
            padding: 28,
            border: `1px solid ${COLORS.border}`,
            width: 900,
            maxHeight: 500,
            overflow: "hidden",
          }}
        >
          {/* Chat header */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${COLORS.border}` }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #7c3aed, #5ca7ff)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FONTS.body,
              fontSize: 16,
              fontWeight: 700,
              color: "#fff",
            }}>
              P
            </div>
            <div>
              <div style={{ fontFamily: FONTS.body, fontSize: 16, fontWeight: 600, color: COLORS.text }}>
                Produciboi
              </div>
              <div style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.green }}>
                Online
              </div>
            </div>
          </div>

          {/* User message */}
          <div style={{ opacity: userMsgOpacity, marginBottom: 16, display: "flex", justifyContent: "flex-end" }}>
            <div style={{
              background: COLORS.accent,
              borderRadius: "12px 12px 4px 12px",
              padding: "12px 18px",
              maxWidth: 500,
            }}>
              <div style={{ fontFamily: FONTS.body, fontSize: 15, color: "#fff", lineHeight: 1.5 }}>
                {chatMessages[0].text}
              </div>
            </div>
          </div>

          {/* Assistant response */}
          <div style={{ opacity: assistantOpacity, display: "flex", justifyContent: "flex-start" }}>
            <div style={{
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${COLORS.border}`,
              borderRadius: "12px 12px 12px 4px",
              padding: "12px 18px",
              maxWidth: 700,
            }}>
              <div style={{ fontFamily: FONTS.body, fontSize: 14, color: COLORS.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {displayedText}
                {showCursor && (
                  <span style={{
                    display: "inline-block",
                    width: 2,
                    height: 16,
                    background: COLORS.accent,
                    marginLeft: 2,
                    verticalAlign: "text-bottom",
                    opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
                  }} />
                )}
              </div>
            </div>
          </div>

          {/* Input bar */}
          <div style={{
            marginTop: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "rgba(255,255,255,0.03)",
            borderRadius: 10,
            padding: "10px 16px",
            border: `1px solid ${COLORS.border}`,
          }}>
            {/* Voice input button */}
            <div style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "rgba(92, 167, 255, 0.15)",
              border: `1px solid rgba(92, 167, 255, 0.3)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <rect x={9} y={2} width={6} height={12} rx={3} fill={COLORS.accent} />
                <path d="M5 10v1a7 7 0 0014 0v-1" stroke={COLORS.accent} strokeWidth={2} fill="none" />
                <line x1={12} y1={18} x2={12} y2={22} stroke={COLORS.accent} strokeWidth={2} />
              </svg>
            </div>
            <div style={{ flex: 1, fontFamily: FONTS.body, fontSize: 14, color: COLORS.textMuted }}>
              Ask Produciboi about your mix...
            </div>
            <div style={{
              fontFamily: FONTS.body,
              fontSize: 13,
              color: COLORS.accent,
              background: "rgba(92, 167, 255, 0.1)",
              borderRadius: 6,
              padding: "6px 14px",
            }}>
              Send
            </div>
          </div>
        </div>
      </FadeIn>
    </div>
  );
};
