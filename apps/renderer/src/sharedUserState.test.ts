import { describe, expect, it } from 'vitest';
import {
  mergeLegacyAndSharedUserState,
  sanitizeSongChecklists,
  sanitizeSongRatings,
} from './sharedUserState';

describe('shared user state sanitizers', () => {
  it('keeps only valid ratings in range 1..10', () => {
    expect(
      sanitizeSongRatings({
        validLow: 1,
        validHigh: 10,
        tooLow: 0,
        tooHigh: 11,
        nan: Number.NaN,
        string: '9',
      })
    ).toEqual({
      validLow: 1,
      validHigh: 10,
    });
  });

  it('keeps only valid checklist items', () => {
    expect(
      sanitizeSongChecklists({
        songA: [
          {
            id: 'item-1',
            text: 'Kick too loud',
            completed: false,
            timestampSeconds: 12.34,
          },
          {
            id: '',
            text: 'invalid id',
            completed: true,
            timestampSeconds: 5,
          },
          {
            id: 'item-2',
            text: 'Bad timestamp is normalized to null',
            completed: true,
            timestampSeconds: -4,
          },
        ],
      })
    ).toEqual({
      songA: [
        {
          id: 'item-1',
          text: 'Kick too loud',
          completed: false,
          timestampSeconds: 12.34,
        },
        {
          id: 'item-2',
          text: 'Bad timestamp is normalized to null',
          completed: true,
          timestampSeconds: null,
        },
      ],
    });
  });
});

describe('mergeLegacyAndSharedUserState', () => {
  it('prefers shared keys and only fills missing entries from legacy localStorage', () => {
    const merged = mergeLegacyAndSharedUserState(
      {
        ratings: { songA: 9 },
        checklists: {
          songA: [
            {
              id: 'shared-item',
              text: 'Shared checklist item',
              completed: false,
              timestampSeconds: 30,
            },
          ],
        },
      },
      {
        ratings: { songA: 4, songB: 8 },
        checklists: {
          songA: [
            {
              id: 'legacy-item',
              text: 'Legacy item should not replace non-empty shared list',
              completed: false,
              timestampSeconds: 10,
            },
          ],
          songB: [
            {
              id: 'legacy-only',
              text: 'Legacy-only item',
              completed: true,
              timestampSeconds: null,
            },
          ],
        },
      }
    );

    expect(merged).toEqual({
      ratings: {
        songA: 9,
        songB: 8,
      },
      checklists: {
        songA: [
          {
            id: 'shared-item',
            text: 'Shared checklist item',
            completed: false,
            timestampSeconds: 30,
          },
        ],
        songB: [
          {
            id: 'legacy-only',
            text: 'Legacy-only item',
            completed: true,
            timestampSeconds: null,
          },
        ],
      },
    });
  });
});
