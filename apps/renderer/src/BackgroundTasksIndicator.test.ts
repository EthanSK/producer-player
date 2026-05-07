import { describe, expect, it } from 'vitest';
import {
  formatBackgroundTaskRunningJob,
  getWarmupPlanPending,
} from './BackgroundTasksIndicator';
import {
  ANALYSIS_PRIORITY_BACKGROUND,
  ANALYSIS_PRIORITY_NEIGHBOR,
  ANALYSIS_PRIORITY_USER_SELECTED,
} from './audioAnalysisQueue';

describe('formatBackgroundTaskRunningJob', () => {
  it('formats human-readable running job labels for the status popover', () => {
    expect(
      formatBackgroundTaskRunningJob({
        queue: 'Measured',
        key: 'measured-key-alpha',
        priority: ANALYSIS_PRIORITY_NEIGHBOR,
        label: 'Alpha v3.wav',
        slot: 'regular',
      })
    ).toBe('Measured: Alpha v3.wav (warmup)');

    expect(
      formatBackgroundTaskRunningJob({
        queue: 'Preview',
        key: 'preview-key-bravo',
        priority: ANALYSIS_PRIORITY_USER_SELECTED,
        label: 'Bravo v1.wav',
        slot: 'user-bypass',
      })
    ).toBe('Preview: Bravo v1.wav (selected)');
  });

  it('falls back to a compact key when no label is available', () => {
    expect(
      formatBackgroundTaskRunningJob({
        queue: 'Measured',
        key: '/Users/ethan/Music/Project/Charlie v2.wav',
        priority: ANALYSIS_PRIORITY_BACKGROUND,
        label: null,
        slot: 'regular',
      })
    ).toBe('Measured: Charlie v2.wav (background)');
  });
});

describe('getWarmupPlanPending', () => {
  it('counts planned warmup tracks that are not active or complete yet', () => {
    expect(
      getWarmupPlanPending({
        total: 5,
        completed: 2,
        activeLabel: 'Song C — mix.wav',
        nextLabels: ['Song D — mix.wav', 'Song E — mix.wav'],
      })
    ).toBe(2);
  });

  it('keeps the whole planned album visible before the next ffmpeg job starts', () => {
    expect(
      getWarmupPlanPending({
        total: 5,
        completed: 2,
        activeLabel: null,
        nextLabels: ['Song C — mix.wav', 'Song D — mix.wav'],
      })
    ).toBe(3);
  });
});
