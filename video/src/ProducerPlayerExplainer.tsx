import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "./theme";
import { IntroScene } from "./scenes/IntroScene";
import { AppOverviewScene } from "./scenes/AppOverviewScene";
import { MasteringIntroScene } from "./scenes/MasteringIntroScene";
import { SpectrumLevelScene } from "./scenes/SpectrumLevelScene";
import { LoudnessWaveformScene } from "./scenes/LoudnessWaveformScene";
import { StereoAnalysisScene } from "./scenes/StereoAnalysisScene";
import { ReferenceMatchScene } from "./scenes/ReferenceMatchScene";
import { AdvancedAnalysisScene } from "./scenes/AdvancedAnalysisScene";
import { SpectrogramScene } from "./scenes/SpectrogramScene";
import { MidSideScene } from "./scenes/MidSideScene";
import { BandSoloScene } from "./scenes/BandSoloScene";
import { AIAgentScene } from "./scenes/AIAgentScene";
import { DraggablePanelsScene } from "./scenes/DraggablePanelsScene";
import { AlbumArtScene } from "./scenes/AlbumArtScene";
import { HelpSystemScene } from "./scenes/HelpSystemScene";
import { PlatformNormScene } from "./scenes/PlatformNormScene";
import { ChecklistScene } from "./scenes/ChecklistScene";
import { OutroScene } from "./scenes/OutroScene";

// Scene durations in frames (at 30fps)
const SCENES = [
  { component: IntroScene, duration: 90 },              // 3s intro
  { component: AppOverviewScene, duration: 100 },        // 3.3s app overview
  { component: MasteringIntroScene, duration: 100 },     // 3.3s mastering intro
  { component: SpectrumLevelScene, duration: 100 },      // 3.3s spectrum + level
  { component: LoudnessWaveformScene, duration: 100 },   // 3.3s loudness + waveform
  { component: StereoAnalysisScene, duration: 100 },     // 3.3s stereo analysis
  { component: ReferenceMatchScene, duration: 100 },     // 3.3s reference matching
  { component: AdvancedAnalysisScene, duration: 100 },   // 3.3s advanced analysis
  { component: SpectrogramScene, duration: 100 },        // 3.3s spectrogram (NEW)
  { component: MidSideScene, duration: 100 },            // 3.3s mid/side (NEW)
  { component: BandSoloScene, duration: 100 },           // 3.3s band soloing (NEW)
  { component: AIAgentScene, duration: 100 },            // 3.3s AI agent (NEW)
  { component: DraggablePanelsScene, duration: 100 },    // 3.3s draggable panels (NEW)
  { component: AlbumArtScene, duration: 100 },           // 3.3s album art (NEW)
  { component: HelpSystemScene, duration: 100 },         // 3.3s help system (NEW)
  { component: PlatformNormScene, duration: 90 },        // 3s platform normalization
  { component: ChecklistScene, duration: 90 },           // 3s checklists
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
