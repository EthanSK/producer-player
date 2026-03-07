import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  AUDIO_EXTENSIONS,
  type AudioExtension,
  type LogicalSong,
  type SongVersion,
  type SongWithVersions,
} from '@producer-player/contracts';

export interface ScannedAudioFile {
  folderId: string;
  filePath: string;
  sizeBytes: number;
  modifiedAt: Date;
}

const SUPPORTED_EXTENSIONS = new Set<string>(AUDIO_EXTENSIONS);

function stableId(...parts: string[]): string {
  return createHash('sha1').update(parts.join('::')).digest('hex').slice(0, 16);
}

export function getAudioExtension(filePath: string): AudioExtension | null {
  const extension = path.extname(filePath).replace('.', '').toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return null;
  }

  return extension as AudioExtension;
}

export function isSupportedAudioFile(filePath: string): boolean {
  return getAudioExtension(filePath) !== null;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function stripTrailingVersionSuffix(stem: string): string {
  // Supports both "Leaky v5" and "Leakyv5" (and _v5 / -v5).
  const match = stem.match(/^(.*?)(?:[\s_-]?v\d+)$/i);

  if (!match) {
    return stem;
  }

  const base = normalizeWhitespace(match[1] ?? '');
  return base.length > 0 ? base : stem;
}

export function normalizeSongStem(stem: string): string {
  const withoutDecorators = normalizeWhitespace(
    stem
      .replace(/[_]+/g, ' ')
      .replace(/[()[\]]/g, ' ')
      .replace(/\.(wav|aiff|flac|mp3|m4a)$/i, '')
  );

  const withoutVersionSuffix = stripTrailingVersionSuffix(withoutDecorators);
  return withoutVersionSuffix.toLowerCase();
}

function titleFromNormalized(normalized: string): string {
  const words = normalized
    .split(' ')
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return 'Untitled Song';
  }

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function buildSongsFromFiles(files: ScannedAudioFile[]): SongWithVersions[] {
  const songMap = new Map<
    string,
    {
      logicalSong: LogicalSong;
      versions: SongVersion[];
    }
  >();

  for (const file of files) {
    const extension = getAudioExtension(file.filePath);
    if (!extension) {
      continue;
    }

    const fileName = path.basename(file.filePath);
    const stem = path.basename(file.filePath, path.extname(file.filePath));
    const normalizedTitle = normalizeSongStem(stem);

    const songId = stableId(file.folderId, normalizedTitle);
    const versionId = stableId(
      file.filePath,
      String(file.sizeBytes),
      file.modifiedAt.toISOString()
    );

    const entry = songMap.get(songId);

    const version: SongVersion = {
      id: versionId,
      songId,
      folderId: file.folderId,
      filePath: file.filePath,
      fileName,
      extension,
      modifiedAt: file.modifiedAt.toISOString(),
      sizeBytes: file.sizeBytes,
      durationMs: null,
      isActive: false,
    };

    if (!entry) {
      songMap.set(songId, {
        logicalSong: {
          id: songId,
          folderId: file.folderId,
          title: titleFromNormalized(normalizedTitle),
          normalizedTitle,
          activeVersionId: null,
          latestExportAt: null,
        },
        versions: [version],
      });
      continue;
    }

    entry.versions.push(version);
  }

  const songs: SongWithVersions[] = [];

  for (const { logicalSong, versions } of songMap.values()) {
    versions.sort(
      (a, b) =>
        new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    );

    const activeVersion = versions[0] ?? null;

    for (const version of versions) {
      version.isActive = activeVersion?.id === version.id;
    }

    songs.push({
      ...logicalSong,
      activeVersionId: activeVersion?.id ?? null,
      latestExportAt: activeVersion?.modifiedAt ?? null,
      versions,
    });
  }

  songs.sort((a, b) => {
    const left = a.latestExportAt ? new Date(a.latestExportAt).getTime() : 0;
    const right = b.latestExportAt ? new Date(b.latestExportAt).getTime() : 0;
    return right - left;
  });

  return songs;
}
