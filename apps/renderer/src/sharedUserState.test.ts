import { describe, expect, it } from 'vitest';
import {
  mergeLegacyAndSharedUserState,
  sanitizeSongChecklists,
  sanitizeSongProjectFilePaths,
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
            versionNumber: 4.7,
          },
          {
            id: '',
            text: 'invalid id',
            completed: true,
            timestampSeconds: 5,
            versionNumber: 3,
          },
          {
            id: 'item-2',
            text: 'Bad timestamp and version are normalized to null',
            completed: true,
            timestampSeconds: -4,
            versionNumber: -1,
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
          versionNumber: 4,
        },
        {
          id: 'item-2',
          text: 'Bad timestamp and version are normalized to null',
          completed: true,
          timestampSeconds: null,
          versionNumber: null,
        },
      ],
    });
  });

  it('keeps only valid per-song project file paths', () => {
    expect(
      sanitizeSongProjectFilePaths({
        songA: '/Users/ethan/music/song-a.logicx',
        songB: '   C:\\Projects\\song-b.flp   ',
        empty: '',
        bad: 42,
      })
    ).toEqual({
      songA: '/Users/ethan/music/song-a.logicx',
      songB: 'C:\\Projects\\song-b.flp',
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
              versionNumber: 5,
            },
          ],
        },
        projectFilePaths: {
          songA: '/Shared/SongA.logicx',
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
              versionNumber: 4,
            },
          ],
          songB: [
            {
              id: 'legacy-only',
              text: 'Legacy-only item',
              completed: true,
              timestampSeconds: null,
              versionNumber: null,
            },
          ],
        },
        projectFilePaths: {
          songA: '/Legacy/ShouldNotWin.logicx',
          songB: '/Legacy/SongB.als',
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
            versionNumber: 5,
          },
        ],
        songB: [
          {
            id: 'legacy-only',
            text: 'Legacy-only item',
            completed: true,
            timestampSeconds: null,
            versionNumber: null,
          },
        ],
      },
      projectFilePaths: {
        songA: '/Shared/SongA.logicx',
        songB: '/Legacy/SongB.als',
      },
    });
  });
});
