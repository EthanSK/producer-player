import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLORS } from "./theme";
import { IntroScene } from "./scenes/IntroScene";
import { AppOverviewScene } from "./scenes/AppOverviewScene";
import { ChecklistScene } from "./scenes/ChecklistScene";
import { HelpSystemScene } from "./scenes/HelpSystemScene";
import { AIAgentScene } from "./scenes/AIAgentScene";
import { PlatformNormScene } from "./scenes/PlatformNormScene";
import { DraggablePanelsScene } from "./scenes/DraggablePanelsScene";
import { BandSoloScene } from "./scenes/BandSoloScene";
import { SpectrumLevelScene } from "./scenes/SpectrumLevelScene";
import { LoudnessWaveformScene } from "./scenes/LoudnessWaveformScene";
import { StereoAnalysisScene } from "./scenes/StereoAnalysisScene";
import { SpectrogramScene } from "./scenes/SpectrogramScene";
import { MidSideScene } from "./scenes/MidSideScene";
import { AdvancedAnalysisScene } from "./scenes/AdvancedAnalysisScene";
import { ReferenceMatchScene } from "./scenes/ReferenceMatchScene";
import { OutroScene } from "./scenes/OutroScene";

// Scene durations in frames (at 30fps)
const SCENES = [
  { component: IntroScene, duration: 90 },              // 3s intro
  { component: AppOverviewScene, duration: 100 },        // 3.3s app overview
  { component: ChecklistScene, duration: 90 },           // 3s checklists (main workflow)
  { component: HelpSystemScene, duration: 100 },         // 3.3s built-in tutorials
  { component: AIAgentScene, duration: 100 },            // 3.3s AI agent (Producey Boy)
  { component: PlatformNormScene, duration: 90 },        // 3s platform normalization
  { component: DraggablePanelsScene, duration: 100 },    // 3.3s draggable panels
  { component: BandSoloScene, duration: 100 },           // 3.3s band soloing
  { component: SpectrumLevelScene, duration: 100 },      // 3.3s spectrum + level
  { component: LoudnessWaveformScene, duration: 100 },   // 3.3s loudness + waveform
  { component: StereoAnalysisScene, duration: 100 },     // 3.3s stereo analysis
  { component: SpectrogramScene, duration: 100 },        // 3.3s spectrogram
  { component: MidSideScene, duration: 100 },            // 3.3s mid/side
  { component: AdvancedAnalysisScene, duration: 100 },   // 3.3s advanced analysis
  { component: ReferenceMatchScene, duration: 100 },     // 3.3s reference matching
  { component: OutroScene, duration: 90 },               // 3s outro
] as const;

// Verify total matches composition duration
const TOTAL = SCENES.reduce((sum, s) => sum + s.duration, 0);

const TRANSITION_FRAMES = 12;

interface TransitionWrapProps {
  children: React.ReactNode;
  durationInFrames: number;
}

const TransitionWrap: React.FC<TransitionWrapProps> = ({ children, durationInFrames }) => {
  const frame = useCurrentFrame();

  // Fade in at start
  const fadeIn = interpolate(frame, [0, TRANSITION_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Fade out at end
  const fadeOut = interpolate(
    frame,
    [durationInFrames - TRANSITION_FRAMES, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
      {children}
    </AbsoluteFill>
  );
};

export const ProducerPlayerExplainer: React.FC = () => {
  let offset = 0;

  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Audio src={staticFile("audio/thedrums-v6.wav")} volume={0.5} />
      {SCENES.map((scene, i) => {
        const from = offset;
        offset += scene.duration;
        const SceneComponent = scene.component;

        return (
          <Sequence key={i} from={from} durationInFrames={scene.duration}>
            <TransitionWrap durationInFrames={scene.duration}>
              <SceneComponent />
            </TransitionWrap>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
