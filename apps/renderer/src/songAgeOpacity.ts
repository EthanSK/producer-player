const OLDEST_SONG_OPACITY = 1;
const NEWEST_SONG_OPACITY = 0.5;
const UNKNOWN_AGE_OPACITY = (OLDEST_SONG_OPACITY + NEWEST_SONG_OPACITY) / 2;

export interface SongAgeOpacityInput {
  id: string;
  latestExportAt: string | null;
}

export function computeSongDateOpacitiesByAge(
  songs: SongAgeOpacityInput[]
): Map<string, number> {
  const result = new Map<string, number>();

  if (songs.length === 0) {
    return result;
  }

  const songsWithAge = songs.map((song, sourceIndex) => {
    const parsed = song.latestExportAt ? new Date(song.latestExportAt).getTime() : Number.NaN;

    return {
      id: song.id,
      sourceIndex,
      timestampMs: Number.isFinite(parsed) ? parsed : null,
    };
  });

  const songsWithKnownAge = songsWithAge
    .filter((song): song is { id: string; sourceIndex: number; timestampMs: number } => song.timestampMs !== null)
    .sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) {
        return left.timestampMs - right.timestampMs;
      }

      return left.sourceIndex - right.sourceIndex;
    });

  if (songsWithKnownAge.length === 1) {
    result.set(songsWithKnownAge[0].id, OLDEST_SONG_OPACITY);
  } else if (songsWithKnownAge.length > 1) {
    const opacityRange = OLDEST_SONG_OPACITY - NEWEST_SONG_OPACITY;
    const denominator = songsWithKnownAge.length - 1;

    songsWithKnownAge.forEach((song, rank) => {
      const opacity = OLDEST_SONG_OPACITY - (rank / denominator) * opacityRange;
      result.set(song.id, opacity);
    });
  }

  songsWithAge.forEach((song) => {
    if (!result.has(song.id)) {
      result.set(song.id, UNKNOWN_AGE_OPACITY);
    }
  });

  return result;
}

export const SONG_DATE_OPACITY_RANGE = {
  oldest: OLDEST_SONG_OPACITY,
  newest: NEWEST_SONG_OPACITY,
  unknown: UNKNOWN_AGE_OPACITY,
} as const;
