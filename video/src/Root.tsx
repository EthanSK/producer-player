import { Composition } from "remotion";
import { ProducerPlayerExplainer } from "./ProducerPlayerExplainer";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ProducerPlayerExplainer"
        component={ProducerPlayerExplainer}
        durationInFrames={2340}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
