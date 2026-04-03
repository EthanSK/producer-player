import React from "react";
import {
  AbsoluteFill,
  Audio,
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

// Scene order per spec (FINAL)
const SCENES = [
  { component: IntroScene, duration: 90 },
  { component: AppOverviewScene, duration: 100 },
  { component: ChecklistScene, duration: 90 },
  { component: HelpSystemScene, duration: 100 },
  { component: AIAgentScene, duration: 100 },
  { component: BandSoloScene, duration: 100 },
  { component: PlatformNormScene, duration: 90 },
  { component: SpectrumLevelScene, duration: 100 },
  { component: LoudnessWaveformScene, duration: 100 },
  { component: StereoAnalysisScene, duration: 100 },
  { component: SpectrogramScene, duration: 100 },
  { component: MidSideScene, duration: 100 },
  { component: ReferenceMatchScene, duration: 100 },
  { component: DraggablePanelsScene, duration: 100 },
  { component: AdvancedAnalysisScene, duration: 100 },
  { component: OutroScene, duration: 90 },
] as const;

export const ProducerPlayerExplainer: React.FC = () => {
  const frame = useCurrentFrame();

  // Calculate sequential offsets (no overlaps — clean cuts with fade-in)
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

        return (
          <Sequence
            key={i}
            from={offsets[i]}
            durationInFrames={scene.duration}
          >
            <AbsoluteFill
              style={{
                opacity: interpolate(
                  frame - offsets[i],
                  [0, 15],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                ),
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
