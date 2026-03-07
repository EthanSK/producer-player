import type { ProducerPlayerBridge } from '@producer-player/contracts';

declare global {
  interface Window {
    producerPlayer: ProducerPlayerBridge;
  }
}

export {};
