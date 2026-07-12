import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  cleanupE2ETestDirectories,
  createE2ETestDirectories,
  launchProducerPlayer,
} from './helpers/electron-app';

type HandoffState = {
  preloadedSourceFilePath: string | null;
  preloadedReadyState: number | null;
  preloadedStatus: string | null;
  currentPlaybackSourceFilePath: string | null;
  currentAudioTimeSeconds: number | null;
  audioPaused: boolean | null;
  audioReadyState: number | null;
  playbackSourceReady: boolean;
  playbackAudioContextState: string | null;
  playbackAudioContextTimeSeconds: number | null;
  outputRmsLinear: number | null;
  outputPeakLinear: number | null;
};

type PlaybackEventLogEntry = {
  event: string;
  perfNowMs: number;
  selectedFilePath?: string | null;
  filePath?: string | null;
  readyState?: number | null;
  currentSrc?: string | null;
  currentTimeSeconds?: number | null;
  durationSeconds?: number | null;
};

type OutputSample = {
  perfNowMs: number;
  preloadedSourceFilePath: string | null;
  preloadedReadyState: number | null;
  preloadedStatus: string | null;
  currentPlaybackSourceFilePath: string | null;
  currentAudioTimeSeconds: number | null;
  audioPaused: boolean | null;
  audioReadyState: number | null;
  playbackSourceReady: boolean;
  playbackAudioContextState: string | null;
  playbackAudioContextTimeSeconds: number | null;
  outputRmsLinear: number | null;
  outputPeakLinear: number | null;
};

type TransitionMeasurement = {
  transitionIndex: number;
  nextFileName: string;
  endedToSourceSelectedMs: number;
  endedToPreloadedPlayRequestedMs: number | null;
  endedToPlayEventMs: number | null;
  endedToPlayingEventMs: number;
  endedToFirstOutputSampleMs: number | null;
  firstOutputSampleResolutionMs: number | null;
  prefetchedBeforeEnded: boolean;
};

const TRACK_COUNT = 18;
const TRACK_DURATION_MS = 2400;
const SAMPLE_RATE = 44_100;
const OUTPUT_SAMPLE_INTERVAL_MS = 5;
const OUTPUT_RMS_THRESHOLD = 0.01;

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) {
    return Number.NaN;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((quantile / 100) * sorted.length) - 1)
  );

  return sorted[index];
}

function summarizeMs(values: number[]): {
  count: number;
  min: number;
  median: number;
  p95: number;
  max: number;
} {
  return {
    count: values.length,
    min: roundMs(Math.min(...values)),
    median: roundMs(percentile(values, 50)),
    p95: roundMs(percentile(values, 95)),
    max: roundMs(Math.max(...values)),
  };
}

async function writeDeterministicWav(
  filePath: string,
  options: { durationMs: number; frequencyHz: number; sampleRate?: number }
): Promise<void> {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const sampleCount = Math.floor((sampleRate * options.durationMs) / 1000);
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = sampleCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  buffer.write('RIFF', offset);
  offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset);
  offset += 4;
  buffer.write('WAVE', offset);
  offset += 4;
  buffer.write('fmt ', offset);
  offset += 4;
  buffer.writeUInt32LE(16, offset);
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(channels, offset);
  offset += 2;
  buffer.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buffer.writeUInt32LE(byteRate, offset);
  offset += 4;
  buffer.writeUInt16LE(blockAlign, offset);
  offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset);
  offset += 2;
  buffer.write('data', offset);
  offset += 4;
  buffer.writeUInt32LE(dataSize, offset);
  offset += 4;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * options.frequencyHz * index) / sampleRate);
    const value = Math.max(-1, Math.min(1, sample)) * 0.36;
    buffer.writeInt16LE(Math.floor(value * 32767), offset);
    offset += 2;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

async function linkFixtureFolder(page: Page, fixtureDirectory: string): Promise<void> {
  await page.evaluate(async (folderPath) => {
    await (window as typeof window & {
      producerPlayer: { linkFolder: (path: string) => Promise<unknown> };
    }).producerPlayer.linkFolder(folderPath);
  }, fixtureDirectory);
}

async function cueSongVersion(page: Page, songTitle: string, fileName: string): Promise<void> {
  await page.getByTestId('main-list-row').filter({ hasText: songTitle }).first().click();
  await page
    .getByTestId('inspector-version-row')
    .filter({ hasText: fileName })
    .getByRole('button', { name: 'Cue' })
    .click();
  await expect(page.getByTestId('player-track-name')).toContainText(fileName);
}

async function startOutputSampler(page: Page): Promise<void> {
  await page.evaluate((intervalMs) => {
    const win = window as typeof window & {
      __producerPlayerGetPlaybackHandoffState?: () => HandoffState;
      __producerPlayerStopGaplessOutputSampler?: () => OutputSample[];
    };
    const samples: OutputSample[] = [];
    const capture = (): void => {
      const state = win.__producerPlayerGetPlaybackHandoffState?.();
      if (!state) {
        return;
      }

      samples.push({
        perfNowMs: performance.now(),
        preloadedSourceFilePath: state.preloadedSourceFilePath,
        preloadedReadyState: state.preloadedReadyState,
        preloadedStatus: state.preloadedStatus,
        currentPlaybackSourceFilePath: state.currentPlaybackSourceFilePath,
        currentAudioTimeSeconds: state.currentAudioTimeSeconds,
        audioPaused: state.audioPaused,
        audioReadyState: state.audioReadyState,
        playbackSourceReady: state.playbackSourceReady,
        playbackAudioContextState: state.playbackAudioContextState,
        playbackAudioContextTimeSeconds: state.playbackAudioContextTimeSeconds,
        outputRmsLinear: state.outputRmsLinear,
        outputPeakLinear: state.outputPeakLinear,
      });
    };

    capture();
    const timer = window.setInterval(capture, intervalMs);
    win.__producerPlayerStopGaplessOutputSampler = () => {
      window.clearInterval(timer);
      delete win.__producerPlayerStopGaplessOutputSampler;
      capture();
      return [...samples];
    };
  }, OUTPUT_SAMPLE_INTERVAL_MS);
}

async function stopOutputSampler(page: Page): Promise<OutputSample[]> {
  return page.evaluate(() => {
    const stop = (window as typeof window & {
      __producerPlayerStopGaplessOutputSampler?: () => OutputSample[];
    }).__producerPlayerStopGaplessOutputSampler;
    return stop ? stop() : [];
  });
}

async function readPlaybackEvents(page: Page): Promise<PlaybackEventLogEntry[]> {
  return page.evaluate(() => {
    return (
      (window as typeof window & {
        __producerPlayerGetPlaybackEventLog?: () => PlaybackEventLogEntry[];
      }).__producerPlayerGetPlaybackEventLog?.() ?? []
    );
  });
}

function firstEventAfter(
  events: PlaybackEventLogEntry[],
  eventName: string,
  perfNowMs: number,
  predicate: (entry: PlaybackEventLogEntry) => boolean = () => true
): PlaybackEventLogEntry | null {
  return (
    events.find(
      (entry) =>
        entry.event === eventName &&
        entry.perfNowMs >= perfNowMs &&
        predicate(entry)
    ) ?? null
  );
}

function measureTransitions(
  events: PlaybackEventLogEntry[],
  samples: OutputSample[]
): TransitionMeasurement[] {
  const endedEvents = events.filter((entry) => entry.event === 'ended');

  return endedEvents.flatMap((ended, transitionIndex) => {
    const nextSource = firstEventAfter(events, 'source-selected', ended.perfNowMs);
    if (!nextSource?.filePath) {
      return [];
    }

    const nextFilePath = nextSource.filePath;
    const nextFileName = path.basename(nextFilePath);
    const nextPlaying = firstEventAfter(
      events,
      'playing',
      nextSource.perfNowMs,
      (entry) => entry.selectedFilePath === nextFilePath
    );
    const nextPlay = firstEventAfter(
      events,
      'play',
      nextSource.perfNowMs,
      (entry) =>
        entry.selectedFilePath === nextFilePath &&
        (!nextPlaying || entry.perfNowMs <= nextPlaying.perfNowMs)
    );
    const preloadedPlayRequested = firstEventAfter(
      events,
      'autoplay-next-preloaded-play-requested',
      nextSource.perfNowMs,
      (entry) => entry.filePath === nextFilePath
    );
    const sampleBeforeEnded = [...samples]
      .reverse()
      .find((sample) => sample.perfNowMs <= ended.perfNowMs);
    const preloadedBeforeEnded = Boolean(
      sampleBeforeEnded &&
        sampleBeforeEnded.preloadedSourceFilePath === nextFilePath &&
        sampleBeforeEnded.preloadedStatus === 'ready' &&
        (sampleBeforeEnded.preloadedReadyState ?? 0) >= 2
    );
    const firstOutputSampleIndex = samples.findIndex(
      (sample) =>
        sample.perfNowMs >= ended.perfNowMs &&
        sample.currentPlaybackSourceFilePath === nextFilePath &&
        sample.audioPaused === false &&
        (sample.outputRmsLinear ?? 0) >= OUTPUT_RMS_THRESHOLD
    );
    const firstOutputSample =
      firstOutputSampleIndex >= 0 ? samples[firstOutputSampleIndex] : null;
    const previousOutputSample =
      firstOutputSampleIndex > 0 ? samples[firstOutputSampleIndex - 1] : null;

    if (!nextPlaying) {
      return [];
    }

    return [
      {
        transitionIndex,
        nextFileName,
        endedToSourceSelectedMs: roundMs(nextSource.perfNowMs - ended.perfNowMs),
        endedToPreloadedPlayRequestedMs: preloadedPlayRequested
          ? roundMs(preloadedPlayRequested.perfNowMs - ended.perfNowMs)
          : null,
        endedToPlayEventMs: nextPlay ? roundMs(nextPlay.perfNowMs - ended.perfNowMs) : null,
        endedToPlayingEventMs: roundMs(nextPlaying.perfNowMs - ended.perfNowMs),
        endedToFirstOutputSampleMs: firstOutputSample
          ? roundMs(firstOutputSample.perfNowMs - ended.perfNowMs)
          : null,
        firstOutputSampleResolutionMs:
          firstOutputSample && previousOutputSample
            ? roundMs(firstOutputSample.perfNowMs - previousOutputSample.perfNowMs)
            : null,
        prefetchedBeforeEnded: preloadedBeforeEnded,
      },
    ];
  });
}

test.describe('gapless playback performance', () => {
  test.setTimeout(120_000);

  test('measures natural autoplay transition latency through the real Electron player', async () => {
    const directories = await createE2ETestDirectories(
      'producer-player-gapless-performance'
    );
    const trackNames = Array.from({ length: TRACK_COUNT }, (_, index) => {
      const trackNumber = index + 1;
      const padded = trackNumber.toString().padStart(2, '0');
      return {
        songTitle: `Gapless ${padded}`,
        fileName: `Gapless ${padded} v1.wav`,
        frequencyHz: 220 + (trackNumber % 9) * 55,
      };
    });

    for (const track of trackNames) {
      await writeDeterministicWav(path.join(directories.fixtureDirectory, track.fileName), {
        durationMs: TRACK_DURATION_MS,
        frequencyHz: track.frequencyHz,
      });
    }

    const { electronApp, page } = await launchProducerPlayer(directories.userDataDirectory);

    try {
      await linkFixtureFolder(page, directories.fixtureDirectory);
      await expect(page.getByTestId('main-list-row')).toHaveCount(TRACK_COUNT);
      const queueTitles = (await page.getByTestId('main-list-row-title').allTextContents())
        .map((title) => title.trim())
        .filter((title) => title.length > 0);
      const orderedFileNames = queueTitles.map((title) => `${title} v1.wav`);
      await cueSongVersion(page, queueTitles[0], orderedFileNames[0]);

      await page.evaluate(() => {
        (window as typeof window & {
          __producerPlayerClearPlaybackEventLog?: () => void;
        }).__producerPlayerClearPlaybackEventLog?.();
      });
      await startOutputSampler(page);
      await page.getByTestId('player-play-toggle').click();

      // The first transition is only meaningful if the hidden media element had
      // time to read the second track before track 1 ends. Wait for that state
      // explicitly, then let natural autoplay run the queue.
      await expect
        .poll(async () =>
          page.evaluate((expectedFilePath) => {
            const state = (window as typeof window & {
              __producerPlayerGetPlaybackHandoffState?: () => {
                preloadedSourceFilePath: string | null;
                preloadedStatus: string | null;
                preloadedReadyState: number | null;
              };
            }).__producerPlayerGetPlaybackHandoffState?.();
            return Boolean(
              state &&
                state.preloadedSourceFilePath === expectedFilePath &&
                state.preloadedStatus === 'ready' &&
                (state.preloadedReadyState ?? 0) >= 2
            );
          }, path.join(directories.fixtureDirectory, orderedFileNames[1]))
        )
        .toBe(true);

      const finalFileName = orderedFileNames[orderedFileNames.length - 1];
      await expect
        .poll(
          async () =>
            page.evaluate((expectedFilePath) => {
              const state = (window as typeof window & {
                __producerPlayerGetPlaybackHandoffState?: () => HandoffState;
              }).__producerPlayerGetPlaybackHandoffState?.();
              return Boolean(
                state &&
                  state.currentPlaybackSourceFilePath === expectedFilePath &&
                  (state.currentAudioTimeSeconds ?? 0) > 0.25 &&
                  state.audioPaused === false
              );
            }, path.join(directories.fixtureDirectory, finalFileName)),
          { timeout: TRACK_COUNT * TRACK_DURATION_MS + 30_000 }
        )
        .toBe(true);

      const samples = await stopOutputSampler(page);
      const events = await readPlaybackEvents(page);
      const endedEvents = events.filter((entry) => entry.event === 'ended');
      const measurements = measureTransitions(events, samples);
      const outputMeasurements = measurements.filter(
        (entry) => entry.endedToFirstOutputSampleMs !== null
      );

      expect(measurements).toHaveLength(TRACK_COUNT - 1);
      expect(outputMeasurements).toHaveLength(TRACK_COUNT - 1);
      expect(endedEvents).toHaveLength(TRACK_COUNT - 1);
      for (const ended of endedEvents) {
        expect(ended.currentTimeSeconds).not.toBeNull();
        expect(ended.durationSeconds).not.toBeNull();
        expect(
          Math.abs((ended.currentTimeSeconds ?? 0) - (ended.durationSeconds ?? 0)),
        ).toBeLessThanOrEqual(1 / SAMPLE_RATE);
      }

      const summary = {
        environment: {
          platform: process.platform,
          arch: process.arch,
          trackCount: TRACK_COUNT,
          transitionCount: measurements.length,
          trackDurationMs: TRACK_DURATION_MS,
          sampleRateHz: SAMPLE_RATE,
          outputSamplerIntervalMs: OUTPUT_SAMPLE_INTERVAL_MS,
          outputRmsThreshold: OUTPUT_RMS_THRESHOLD,
        },
        prefetch: {
          prefetchedBeforeEndedCount: measurements.filter(
            (entry) => entry.prefetchedBeforeEnded
          ).length,
          notObservedBeforeEnded: measurements
            .filter((entry) => !entry.prefetchedBeforeEnded)
            .map((entry) => ({
              transitionIndex: entry.transitionIndex,
              nextFileName: entry.nextFileName,
            })),
        },
        eventTimingMs: {
          endedToSourceSelected: summarizeMs(
            measurements.map((entry) => entry.endedToSourceSelectedMs)
          ),
          endedToPreloadedPlayRequested: summarizeMs(
            measurements.flatMap((entry) =>
              entry.endedToPreloadedPlayRequestedMs === null
                ? []
                : [entry.endedToPreloadedPlayRequestedMs]
            )
          ),
          endedToPlay: summarizeMs(
            measurements.flatMap((entry) =>
              entry.endedToPlayEventMs === null ? [] : [entry.endedToPlayEventMs]
            )
          ),
          endedToPlaying: summarizeMs(
            measurements.map((entry) => entry.endedToPlayingEventMs)
          ),
        },
        outputProxyTimingMs: {
          endedToFirstAboveThresholdOutputSample: summarizeMs(
            outputMeasurements.map((entry) => entry.endedToFirstOutputSampleMs!)
          ),
          firstOutputSampleResolution: summarizeMs(
            outputMeasurements.flatMap((entry) =>
              entry.firstOutputSampleResolutionMs === null
                ? []
                : [entry.firstOutputSampleResolutionMs]
            )
          ),
        },
        transitions: measurements,
      };

      const artifactPath = path.join(
        process.cwd(),
        'test-results',
        'gapless-playback-performance-latest.json'
      );
      await fs.mkdir(path.dirname(artifactPath), { recursive: true });
      await fs.writeFile(artifactPath, JSON.stringify(summary, null, 2), 'utf8');
      await test.info().attach('gapless-playback-performance-summary', {
        path: artifactPath,
        contentType: 'application/json',
      });

      expect(summary.eventTimingMs.endedToPlaying.p95).toBeLessThan(80);
      expect(summary.outputProxyTimingMs.endedToFirstAboveThresholdOutputSample.p95).toBeLessThan(100);
    } finally {
      await electronApp.close();
      await cleanupE2ETestDirectories(directories);
    }
  });
});
