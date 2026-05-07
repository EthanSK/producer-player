import { describe, expect, it } from 'vitest';
import { formatBackgroundTaskRunningJob } from './BackgroundTasksIndicator';
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
