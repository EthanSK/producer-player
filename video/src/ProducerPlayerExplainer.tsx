import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
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

const FADE_IN_FRAMES = 25;
const FADE_OUT_FRAMES = 20;

// Scene order per spec (FINAL)
const SCENES = [
  { component: IntroScene, duration: 120 },
  { component: AppOverviewScene, duration: 150 },
  { component: ChecklistScene, duration: 150 },
  { component: HelpSystemScene, duration: 150 },
  { component: AIAgentScene, duration: 150 },
  { component: BandSoloScene, duration: 150 },
  { component: PlatformNormScene, duration: 150 },
  { component: SpectrumLevelScene, duration: 150 },
  { component: LoudnessWaveformScene, duration: 150 },
  { component: StereoAnalysisScene, duration: 150 },
  { component: SpectrogramScene, duration: 150 },
  { component: MidSideScene, duration: 150 },
  { component: ReferenceMatchScene, duration: 150 },
  { component: DraggablePanelsScene, duration: 150 },
  { component: AdvancedAnalysisScene, duration: 150 },
  { component: OutroScene, duration: 120 },
] as const;

export const ProducerPlayerExplainer: React.FC = () => {
  const frame = useCurrentFrame();

  // Calculate sequential offsets (no overlaps — clean cuts with fade-in/out)
  const offsets: number[] = [];
  let offset = 0;
  for (let i = 0; i < SCENES.length; i++) {
    offsets.push(offset);
    offset += SCENES[i].duration;
  }

  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Audio src={staticFile("audio/thedrums-v6.mp3")} volume={0.5} />
      {SCENES.map((scene, i) => {
        const SceneComponent = scene.component;
        const localFrame = frame - offsets[i];

        // Fade in over first FADE_IN_FRAMES
        const fadeIn = interpolate(
          localFrame,
          [0, FADE_IN_FRAMES],
          [0, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.inOut(Easing.ease),
          }
        );

        // Fade out over last FADE_OUT_FRAMES
        const fadeOut = interpolate(
          localFrame,
          [scene.duration - FADE_OUT_FRAMES, scene.duration],
          [1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.inOut(Easing.ease),
          }
        );

        return (
          <Sequence
            key={i}
            from={offsets[i]}
            durationInFrames={scene.duration}
          >
            <AbsoluteFill
              style={{
                opacity: Math.min(fadeIn, fadeOut),
              }}
            >
              <SceneComponent />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
