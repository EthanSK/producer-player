/// <reference lib="webworker" />

import {
  buildIdealStemProxyData,
  encodeMonoPcm16Wav,
  IDEAL_STEM_PROVIDER_DISCLOSURE,
  IDEAL_STEM_PROVIDER_ID,
  IDEAL_STEM_PROVIDER_LABEL,
} from './idealStemAnalysisCore';
import { IDEAL_STEM_IDS, type IdealStemId, type IdealCurvePoint } from './idealCurves';

type WorkerRequest = {
  id: string;
  monoSamples: ArrayBuffer;
  sampleRate: number;
};

type WorkerStemResponse = {
  stemId: IdealStemId;
  curve: IdealCurvePoint[];
  metrics: {
    peakDbfs: number;
    rmsDbfs: number;
    durationSeconds: number;
    sampleRate: number;
  };
  wavBuffer: ArrayBuffer;
};

type WorkerResponse =
  | {
      id: string;
      ok: true;
      provider: {
        id: typeof IDEAL_STEM_PROVIDER_ID;
        label: typeof IDEAL_STEM_PROVIDER_LABEL;
        disclosure: typeof IDEAL_STEM_PROVIDER_DISCLOSURE;
        isApproximation: true;
      };
      stems: WorkerStemResponse[];
    }
  | {
      id: string;
      ok: false;
      error: string;
    };

const ctx = self as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, monoSamples, sampleRate } = event.data;
  try {
    const mono = new Float32Array(monoSamples);
    const proxyData = buildIdealStemProxyData(mono, sampleRate);
    const stems: WorkerStemResponse[] = IDEAL_STEM_IDS.map((stemId) => {
      const stem = proxyData[stemId];
      return {
        stemId,
        curve: stem.curve,
        metrics: stem.metrics,
        wavBuffer: encodeMonoPcm16Wav(stem.samples, sampleRate),
      };
    });

    const transfer = stems.map((stem) => stem.wavBuffer);
    const response: WorkerResponse = {
      id,
      ok: true,
      provider: {
        id: IDEAL_STEM_PROVIDER_ID,
        label: IDEAL_STEM_PROVIDER_LABEL,
        disclosure: IDEAL_STEM_PROVIDER_DISCLOSURE,
        isApproximation: true,
      },
      stems,
    };
    ctx.postMessage(response, transfer);
  } catch (cause: unknown) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
    ctx.postMessage(response);
  }
};

export type { WorkerRequest as IdealStemWorkerRequest, WorkerResponse as IdealStemWorkerResponse };
