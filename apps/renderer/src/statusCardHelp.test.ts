import { describe, expect, it } from 'vitest';
import type { ICloudAvailabilityResult, LinkedFolder } from '@producer-player/contracts';
import { buildStatusCardHelpText } from './statusCardHelp';

function createLinkedFolder(overrides: Partial<LinkedFolder> = {}): LinkedFolder {
  return {
    id: 'folder-1',
    name: 'Album Exports',
    path: '/Users/ethan/Music/Album Exports',
    linkedAt: '2026-03-25T12:00:00.000Z',
    fileCount: 12,
    ...overrides,
  };
}

describe('buildStatusCardHelpText', () => {
  it('includes status guidance, archive paths, metadata paths, and iCloud file paths', () => {
    const linkedFolders = [createLinkedFolder()];
    const iCloudAvailability: ICloudAvailabilityResult = {
      available: true,
      path: '/Users/ethan/Library/Mobile Documents/com~apple~CloudDocs/Producer Player',
    };

    const helpText = buildStatusCardHelpText(linkedFolders, iCloudAvailability);

    expect(helpText).toContain('Status tells you whether Producer Player is idle, actively scanning, watching your folders for changes, or reporting an error.');
    expect(helpText).toContain('Last scan is the timestamp of the most recent completed library refresh.');
    expect(helpText).toContain('Album Exports: /Users/ethan/Music/Album Exports');
    expect(helpText).toContain('/Users/ethan/Music/Album Exports/old');
    expect(helpText).toContain('/Users/ethan/Music/Album Exports/.producer-player/order-state.json');
    expect(helpText).toContain('/Users/ethan/Music/Album Exports/.producer-player/state');
    expect(helpText).toContain('/Users/ethan/Library/Mobile Documents/com~apple~CloudDocs/Producer Player/checklists.json');
    expect(helpText).toContain('/Users/ethan/Library/Mobile Documents/com~apple~CloudDocs/Producer Player/ratings.json');
    expect(helpText).toContain('/Users/ethan/Library/Mobile Documents/com~apple~CloudDocs/Producer Player/state.json');
    expect(helpText).toContain('syncs checklists, ratings, and app preferences only (not audio files)');
  });

  it('shows sensible fallback copy before folders or iCloud are available', () => {
    const helpText = buildStatusCardHelpText([], null);

    expect(helpText).toContain('No linked folders yet. Use Add Folder… above to start tracking exports.');
    expect(helpText).toContain('Archive paths appear after you link at least one folder.');
    expect(helpText).toContain('Order metadata paths appear after you link at least one folder.');
    expect(helpText).toContain('Folder state mirror paths appear after you link at least one folder.');
    expect(helpText).toContain('iCloud backup folder: shown here once iCloud Drive is available.');
    expect(helpText).toContain('Backup file names: checklists.json, ratings.json, state.json');
  });

  it('preserves windows-style path separators for folder-derived paths', () => {
    const linkedFolders = [
      createLinkedFolder({
        name: 'Windows Album',
        path: 'C:\\Music\\Windows Album',
      }),
    ];
    const iCloudAvailability: ICloudAvailabilityResult = {
      available: false,
      path: null,
      reason: 'iCloud Drive is not available on Windows.',
    };

    const helpText = buildStatusCardHelpText(linkedFolders, iCloudAvailability);

    expect(helpText).toContain('C:\\Music\\Windows Album\\old');
    expect(helpText).toContain('C:\\Music\\Windows Album\\.producer-player\\order-state.json');
    expect(helpText).toContain('C:\\Music\\Windows Album\\.producer-player\\state');
    expect(helpText).toContain('iCloud backup folder: unavailable (iCloud Drive is not available on Windows.)');
  });
});
