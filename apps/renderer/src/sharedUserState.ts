import type { SongChecklistItem } from '@producer-player/contracts';

export interface SharedUserStateDraft {
  ratings: Record<string, number>;
  checklists: Record<string, SongChecklistItem[]>;
  projectFilePaths: Record<string, string>;
}

export function sanitizeSongRatings(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value).flatMap(([songId, rating]) => {
    if (
      songId.length === 0 ||
      typeof rating !== 'number' ||
      !Number.isFinite(rating) ||
      rating < 1 ||
      rating > 10
    ) {
      return [];
    }

    return [[songId, rating] as const];
  });

  return Object.fromEntries(entries);
}

function sanitizeSongChecklistItems(value: unknown): SongChecklistItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return [];
    }

    const candidate = entry as Partial<SongChecklistItem>;
    if (
      typeof candidate.id !== 'string' ||
      candidate.id.trim().length === 0 ||
      typeof candidate.text !== 'string' ||
      typeof candidate.completed !== 'boolean'
    ) {
      return [];
    }

    const timestampSeconds =
      typeof candidate.timestampSeconds === 'number' &&
      Number.isFinite(candidate.timestampSeconds) &&
      candidate.timestampSeconds >= 0
        ? candidate.timestampSeconds
        : null;
    const versionNumber =
      typeof candidate.versionNumber === 'number' &&
      Number.isFinite(candidate.versionNumber) &&
      candidate.versionNumber >= 1
        ? Math.trunc(candidate.versionNumber)
        : null;
    const listeningDeviceId =
      typeof candidate.listeningDeviceId === 'string' &&
      candidate.listeningDeviceId.trim().length > 0
        ? candidate.listeningDeviceId
        : null;

    return [
      {
        id: candidate.id,
        text: candidate.text,
        completed: candidate.completed,
        timestampSeconds,
        versionNumber,
        listeningDeviceId,
      },
    ];
  });
}

export function sanitizeSongChecklists(value: unknown): Record<string, SongChecklistItem[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value).flatMap(([songId, items]) => {
    if (songId.length === 0) {
      return [];
    }

    return [[songId, sanitizeSongChecklistItems(items)] as const];
  });

  return Object.fromEntries(entries);
}

export function sanitizeSongProjectFilePaths(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value).flatMap(([songId, projectFilePath]) => {
    const normalizedPath =
      typeof projectFilePath === 'string' ? projectFilePath.trim() : '';

    if (songId.length === 0 || normalizedPath.length === 0) {
      return [];
    }

    return [[songId, normalizedPath] as const];
  });

  return Object.fromEntries(entries);
}

export function mergeLegacyAndSharedUserState(
  shared: SharedUserStateDraft,
  legacy: SharedUserStateDraft
): SharedUserStateDraft {
  const ratings = { ...shared.ratings };
  for (const [songId, rating] of Object.entries(legacy.ratings)) {
    if (songId in ratings) {
      continue;
    }

    ratings[songId] = rating;
  }

  const checklists: Record<string, SongChecklistItem[]> = { ...shared.checklists };
  for (const [songId, items] of Object.entries(legacy.checklists)) {
    const existingItems = checklists[songId];
    if (Array.isArray(existingItems) && existingItems.length > 0) {
      continue;
    }

    checklists[songId] = items;
  }

  const projectFilePaths = { ...shared.projectFilePaths };
  for (const [songId, projectFilePath] of Object.entries(legacy.projectFilePaths)) {
    if (songId in projectFilePaths) {
      continue;
    }

    projectFilePaths[songId] = projectFilePath;
  }

  return { ratings, checklists, projectFilePaths };
}
