import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS } from "./theme";
import { IntroScene } from "./scenes/IntroScene";
import { AppOverviewScene } from "./scenes/AppOverviewScene";
import { ChecklistScene } from "./scenes/ChecklistScene";
import { HelpSystemScene } from "./scenes/HelpSystemScene";
import { AIAgentScene } from "./scenes/AIAgentScene";
import { ReferenceMatchScene } from "./scenes/ReferenceMatchScene";
import { PlatformNormScene } from "./scenes/PlatformNormScene";
import { DraggablePanelsScene } from "./scenes/DraggablePanelsScene";
import { BandSoloScene } from "./scenes/BandSoloScene";
import { SpectrumLevelScene } from "./scenes/SpectrumLevelScene";
import { LoudnessWaveformScene } from "./scenes/LoudnessWaveformScene";
import { StereoAnalysisScene } from "./scenes/StereoAnalysisScene";
import { SpectrogramScene } from "./scenes/SpectrogramScene";
import { MidSideScene } from "./scenes/MidSideScene";
import { AdvancedAnalysisScene } from "./scenes/AdvancedAnalysisScene";
import { OutroScene } from "./scenes/OutroScene";

// Scene order per spec (FINAL)
const SCENES = [
  { component: IntroScene, duration: 90 },
  { component: AppOverviewScene, duration: 100 },
  { component: ChecklistScene, duration: 90 },
  { component: HelpSystemScene, duration: 100 },
  { component: AIAgentScene, duration: 100 },
  { component: ReferenceMatchScene, duration: 100 },
  { component: PlatformNormScene, duration: 90 },
  { component: DraggablePanelsScene, duration: 100 },
  { component: BandSoloScene, duration: 100 },
  { component: SpectrumLevelScene, duration: 100 },
  { component: LoudnessWaveformScene, duration: 100 },
  { component: StereoAnalysisScene, duration: 100 },
  { component: SpectrogramScene, duration: 100 },
  { component: MidSideScene, duration: 100 },
  { component: AdvancedAnalysisScene, duration: 100 },
  { component: OutroScene, duration: 90 },
] as const;

// Overlap between scenes for seamless transitions
const OVERLAP = 15;

// Transition types cycle through for variety
type TransitionType = "zoomSpin" | "slideLeft" | "slideRight" | "slideUp" | "slideDown" | "whipPan" | "elasticScale";

const TRANSITION_SEQUENCE: TransitionType[] = [
  "zoomSpin",    // Intro -> AppOverview
  "slideRight",  // AppOverview -> Checklist
  "slideUp",     // Checklist -> HelpSystem
  "whipPan",     // HelpSystem -> AI
  "elasticScale",// AI -> Reference
  "slideLeft",   // Reference -> Platform
  "zoomSpin",    // Platform -> Panels
  "slideDown",   // Panels -> BandSolo
  "whipPan",     // BandSolo -> Spectrum
  "slideRight",  // Spectrum -> Loudness
  "elasticScale",// Loudness -> Stereo
  "slideUp",     // Stereo -> Spectrogram
  "slideLeft",   // Spectrogram -> MidSide
  "zoomSpin",    // MidSide -> Advanced
  "whipPan",     // Advanced -> Outro
];

interface TransitionWrapProps {
  children: React.ReactNode;
  durationInFrames: number;
  exitType: TransitionType;
  enterType: TransitionType;
  isFirst: boolean;
  isLast: boolean;
}

const TransitionWrap: React.FC<TransitionWrapProps> = ({
  children,
  durationInFrames,
  exitType,
  enterType,
  isFirst,
  isLast,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ENTER animation (first OVERLAP frames) — spring-based
  const enterSpring = spring({
    fps,
    frame: Math.min(frame, OVERLAP),
    config: {
      damping: 11,
      stiffness: 110,
      mass: 0.5,
    },
  });

  // EXIT animation (last OVERLAP frames)
  const exitFrame = Math.max(0, frame - (durationInFrames - OVERLAP));
  const exitSpring = spring({
    fps,
    frame: exitFrame,
    config: {
      damping: 14,
      stiffness: 140,
      mass: 0.4,
    },
  });

  // Enter transforms
  let enterTransform = "";
  let enterOpacity = 1;
  let enterBlur = 0;

  if (!isFirst && frame < OVERLAP) {
    const inv = 1 - enterSpring;

    switch (enterType) {
      case "zoomSpin":
        enterTransform = `scale(${0.3 + enterSpring * 0.7}) rotate(${inv * -12}deg)`;
        enterOpacity = enterSpring;
        enterBlur = inv * 6;
        break;
      case "slideLeft":
        enterTransform = `translateX(${inv * 1920}px) rotate(${inv * 3}deg)`;
        enterOpacity = enterSpring;
        break;
      case "slideRight":
        enterTransform = `translateX(${inv * -1920}px) rotate(${inv * -3}deg)`;
        enterOpacity = enterSpring;
        break;
      case "slideUp":
        enterTransform = `translateY(${inv * 1080}px) scale(${0.8 + enterSpring * 0.2})`;
        enterOpacity = enterSpring;
        break;
      case "slideDown":
        enterTransform = `translateY(${inv * -1080}px) scale(${0.8 + enterSpring * 0.2})`;
        enterOpacity = enterSpring;
        break;
      case "whipPan":
        enterTransform = `translateX(${inv * 2200}px) skewX(${inv * -15}deg)`;
        enterOpacity = enterSpring;
        enterBlur = inv * 8;
        break;
      case "elasticScale":
        enterTransform = `scale(${enterSpring * 1.0}) rotate(${inv * 8}deg)`;
        enterOpacity = Math.min(1, enterSpring * 1.5);
        break;
    }
  }

  // Exit transforms
  let exitTransform = "";
  let exitOpacity = 1;
  let exitBlur = 0;

  if (!isLast && frame >= durationInFrames - OVERLAP) {
    const prog = exitSpring;

    switch (exitType) {
      case "zoomSpin":
        exitTransform = `scale(${1 + prog * 1.5}) rotate(${prog * 15}deg)`;
        exitOpacity = 1 - prog;
        exitBlur = prog * 8;
        break;
      case "slideLeft":
        exitTransform = `translateX(${-prog * 1920}px) rotate(${prog * -3}deg)`;
        exitOpacity = 1 - prog;
        break;
      case "slideRight":
        exitTransform = `translateX(${prog * 1920}px) rotate(${prog * 3}deg)`;
        exitOpacity = 1 - prog;
        break;
      case "slideUp":
        exitTransform = `translateY(${-prog * 1080}px) scale(${1 - prog * 0.3})`;
        exitOpacity = 1 - prog;
        break;
      case "slideDown":
        exitTransform = `translateY(${prog * 1080}px) scale(${1 - prog * 0.3})`;
        exitOpacity = 1 - prog;
        break;
      case "whipPan":
        exitTransform = `translateX(${-prog * 2200}px) skewX(${prog * 15}deg)`;
        exitOpacity = 1 - prog;
        exitBlur = prog * 8;
        break;
      case "elasticScale":
        exitTransform = `scale(${1 - prog * 0.7}) rotate(${-prog * 10}deg)`;
        exitOpacity = 1 - prog;
        break;
    }
  }

  const combinedTransform = [enterTransform, exitTransform].filter(Boolean).join(" ") || "none";
  const combinedOpacity = Math.min(enterOpacity, exitOpacity);
  const combinedBlur = enterBlur + exitBlur;

  return (
    <AbsoluteFill
      style={{
        opacity: combinedOpacity,
        transform: combinedTransform,
        filter: combinedBlur > 0.1 ? `blur(${combinedBlur}px)` : "none",
        willChange: "transform, opacity, filter",
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const ProducerPlayerExplainer: React.FC = () => {
  // Calculate overlapping offsets
  const offsets: number[] = [];
  let offset = 0;
  for (let i = 0; i < SCENES.length; i++) {
    offsets.push(offset);
    // Each scene overlaps with the next by OVERLAP frames
    offset += SCENES[i].duration - (i < SCENES.length - 1 ? OVERLAP : 0);
  }

  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Audio src={staticFile("audio/thedrums-v6.mp3")} volume={0.5} />
      {SCENES.map((scene, i) => {
        const SceneComponent = scene.component;
        const enterType = i > 0 ? TRANSITION_SEQUENCE[i - 1] : "zoomSpin";
        const exitType = i < SCENES.length - 1 ? TRANSITION_SEQUENCE[i] : "zoomSpin";

        return (
          <Sequence
            key={i}
            from={offsets[i]}
            durationInFrames={scene.duration}
          >
            <TransitionWrap
              durationInFrames={scene.duration}
              enterType={enterType}
              exitType={exitType}
              isFirst={i === 0}
              isLast={i === SCENES.length - 1}
            >
              <SceneComponent />
            </TransitionWrap>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
