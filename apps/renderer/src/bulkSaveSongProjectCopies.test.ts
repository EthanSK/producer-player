import { describe, expect, it, vi } from 'vitest';
import {
  bulkSaveSongProjectCopies,
  buildBulkSaveCopyToastText,
  buildSaveCopyTooltipBody,
  SAVE_COPY_TOOLTIP_HEADING,
  type BulkSaveCopyInputSong,
  type BulkSaveCopyOutcome,
  type BulkSaveCopyProgress,
} from './bulkSaveSongProjectCopies';

function makeSong(
  id: string,
  projectFilePath: string | null,
  targetVersion = 42
): BulkSaveCopyInputSong {
  return {
    id,
    title: `Song ${id}`,
    projectFilePath,
    targetVersion,
  };
}

describe('bulkSaveSongProjectCopies', () => {
  it('calls saveSongProjectCopy once per eligible song in order', async () => {
    const songs: BulkSaveCopyInputSong[] = [
      makeSong('a', '/p/a.als', 10),
      makeSong('b', '/p/b.als', 20),
      makeSong('c', '/p/c.als', 30),
    ];
    const calls: Array<[string, number]> = [];
    const saveSongProjectCopy = vi.fn(async (path: string, version: number) => {
      calls.push([path, version]);
      return {
        ok: true as const,
        newPath: `${path.replace('.als', '')} v${version}.als`,
        newFileName: `dummy v${version}.als`,
        targetVersion: version,
        sizeBytes: 1234,
      };
    });

    const summary = await bulkSaveSongProjectCopies(songs, { saveSongProjectCopy });

    expect(saveSongProjectCopy).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([
      ['/p/a.als', 10],
      ['/p/b.als', 20],
      ['/p/c.als', 30],
    ]);
    expect(summary.total).toBe(3);
    expect(summary.eligible).toBe(3);
    expect(summary.succeeded).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.skippedNoProject).toBe(0);
  });

  it('skips songs with no linked project file', async () => {
    const songs: BulkSaveCopyInputSong[] = [
      makeSong('a', '/p/a.als'),
      makeSong('b', null),
      makeSong('c', '/p/c.als'),
    ];
    const saveSongProjectCopy = vi.fn(async (path: string, version: number) => ({
      ok: true as const,
      newPath: path,
      newFileName: 'x.als',
      targetVersion: version,
      sizeBytes: null,
    }));

    const summary = await bulkSaveSongProjectCopies(songs, { saveSongProjectCopy });

    expect(saveSongProjectCopy).toHaveBeenCalledTimes(2);
    expect(summary.total).toBe(3);
    expect(summary.eligible).toBe(2);
    expect(summary.succeeded).toBe(2);
    expect(summary.skippedNoProject).toBe(1);
    expect(summary.outcomes.find((o) => o.song.id === 'b')?.kind).toBe('skipped-no-project');
  });

  it('reports partial failure when one save returns ok:false', async () => {
    const songs: BulkSaveCopyInputSong[] = [
      makeSong('a', '/p/a.als'),
      makeSong('b', '/p/b.als'),
    ];
    const saveSongProjectCopy = vi.fn(async (path: string, version: number) => {
      if (path === '/p/b.als') {
        return { ok: false as const, error: 'disk full' };
      }
      return {
        ok: true as const,
        newPath: path,
        newFileName: 'x.als',
        targetVersion: version,
        sizeBytes: null,
      };
    });

    const summary = await bulkSaveSongProjectCopies(songs, { saveSongProjectCopy });

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    const bOutcome = summary.outcomes.find((o) => o.song.id === 'b');
    expect(bOutcome?.kind).toBe('failure');
    expect(bOutcome?.error).toBe('disk full');
  });

  it('captures thrown errors as failures (never throws out of the bulk run)', async () => {
    const songs: BulkSaveCopyInputSong[] = [
      makeSong('a', '/p/a.als'),
      makeSong('b', '/p/b.als'),
    ];
    const saveSongProjectCopy = vi.fn(async (path: string) => {
      if (path === '/p/a.als') {
        throw new Error('IPC blew up');
      }
      return {
        ok: true as const,
        newPath: path,
        newFileName: 'x.als',
        targetVersion: 1,
        sizeBytes: null,
      };
    });

    const summary = await bulkSaveSongProjectCopies(songs, { saveSongProjectCopy });

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.outcomes.find((o) => o.song.id === 'a')?.error).toBe('IPC blew up');
  });

  it('emits progress events with the running 1-based index and total eligible count', async () => {
    const songs: BulkSaveCopyInputSong[] = [
      makeSong('a', '/p/a.als'),
      makeSong('b', null),
      makeSong('c', '/p/c.als'),
      makeSong('d', '/p/d.als'),
    ];
    const progressEvents: BulkSaveCopyProgress[] = [];
    const saveSongProjectCopy = vi.fn(async (path: string, version: number) => ({
      ok: true as const,
      newPath: path,
      newFileName: 'x.als',
      targetVersion: version,
      sizeBytes: null,
    }));

    await bulkSaveSongProjectCopies(songs, {
      saveSongProjectCopy,
      onProgress: (p) => progressEvents.push(p),
    });

    expect(progressEvents).toHaveLength(3);
    expect(progressEvents[0].currentIndex).toBe(1);
    expect(progressEvents[0].totalEligible).toBe(3);
    expect(progressEvents[1].currentIndex).toBe(2);
    expect(progressEvents[2].currentIndex).toBe(3);
    expect(progressEvents.map((p) => p.song.id)).toEqual(['a', 'c', 'd']);
  });

  it('reports an outcome for every input song (eligible + skipped)', async () => {
    const songs: BulkSaveCopyInputSong[] = [
      makeSong('a', '/p/a.als'),
      makeSong('b', null),
      makeSong('c', '/p/c.als'),
    ];
    const outcomeEvents: BulkSaveCopyOutcome[] = [];
    const saveSongProjectCopy = vi.fn(async (path: string, version: number) => ({
      ok: true as const,
      newPath: path,
      newFileName: 'x.als',
      targetVersion: version,
      sizeBytes: null,
    }));

    await bulkSaveSongProjectCopies(songs, {
      saveSongProjectCopy,
      onOutcome: (o) => outcomeEvents.push(o),
    });

    expect(outcomeEvents).toHaveLength(3);
    expect(outcomeEvents.map((o) => o.kind).sort()).toEqual([
      'skipped-no-project',
      'success',
      'success',
    ]);
  });
});

describe('buildBulkSaveCopyToastText', () => {
  it('reports info when no songs are eligible', () => {
    const toast = buildBulkSaveCopyToastText({
      total: 5,
      eligible: 0,
      succeeded: 0,
      failed: 0,
      skippedNoProject: 5,
      outcomes: [],
    });
    expect(toast.kind).toBe('info');
    expect(toast.text).toMatch(/no.*linked.*DAW project/i);
  });

  it('reports success with plural copies', () => {
    const toast = buildBulkSaveCopyToastText({
      total: 3,
      eligible: 3,
      succeeded: 3,
      failed: 0,
      skippedNoProject: 0,
      outcomes: [],
    });
    expect(toast.kind).toBe('success');
    expect(toast.text).toBe('Saved 3 copies');
  });

  it('uses the singular "copy" when exactly one saved', () => {
    const toast = buildBulkSaveCopyToastText({
      total: 1,
      eligible: 1,
      succeeded: 1,
      failed: 0,
      skippedNoProject: 0,
      outcomes: [],
    });
    expect(toast.text).toBe('Saved 1 copy');
  });

  it('mentions skipped tracks in the success toast', () => {
    const toast = buildBulkSaveCopyToastText({
      total: 5,
      eligible: 3,
      succeeded: 3,
      failed: 0,
      skippedNoProject: 2,
      outcomes: [],
    });
    expect(toast.kind).toBe('success');
    expect(toast.text).toContain('Saved 3 copies');
    expect(toast.text).toContain('2 tracks skipped');
  });

  it('reports warning on partial failure', () => {
    const toast = buildBulkSaveCopyToastText({
      total: 4,
      eligible: 4,
      succeeded: 3,
      failed: 1,
      skippedNoProject: 0,
      outcomes: [],
    });
    expect(toast.kind).toBe('warning');
    expect(toast.text).toContain('Saved 3 of 4');
    expect(toast.text).toContain('1 failed');
  });

  it('reports error when all eligible saves failed', () => {
    const toast = buildBulkSaveCopyToastText({
      total: 3,
      eligible: 3,
      succeeded: 0,
      failed: 3,
      skippedNoProject: 0,
      outcomes: [],
    });
    expect(toast.kind).toBe('error');
    expect(toast.text).toContain('Failed');
  });
});

describe('save copy tooltip text (voice 3133)', () => {
  it('heading explicitly mentions DAW project', () => {
    expect(SAVE_COPY_TOOLTIP_HEADING.toLowerCase()).toContain('daw project');
  });

  it('body explicitly mentions DAW project', () => {
    const body = buildSaveCopyTooltipBody(42);
    expect(body.toLowerCase()).toContain('daw project');
  });

  it('body shows the example file name with the current version number', () => {
    const body = buildSaveCopyTooltipBody(42);
    expect(body).toContain('song v42.als');
  });

  it('body documents the non-destructive re-click behaviour', () => {
    const body = buildSaveCopyTooltipBody(42);
    expect(body).toMatch(/\(2\)/);
    expect(body.toLowerCase()).toContain('never overwrites');
  });
});
