export const PUBLIC_REPOSITORY_ORIGIN = 'https://github.com';
export const PUBLIC_REPOSITORY_PATH = '/EthanSK/producer-player';
export const PUBLIC_RELEASES_URL = `${PUBLIC_REPOSITORY_ORIGIN}${PUBLIC_REPOSITORY_PATH}/releases`;
export const PUBLIC_RELEASES_LATEST_DOWNLOAD_BASE_URL =
  `${PUBLIC_REPOSITORY_ORIGIN}${PUBLIC_REPOSITORY_PATH}/releases/latest/download`;
export const GITHUB_RELEASES_LATEST_API_URL = 'https://api.github.com/repos/EthanSK/producer-player/releases/latest';

export interface ReleaseAssetLike {
  name: string;
  browserDownloadUrl: string;
}

export interface ReleaseAssetPayloadLike {
  assets: ReleaseAssetLike[];
}

export function getStableDownloadAssetName(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string | null {
  if (platform === 'darwin') {
    return 'Producer-Player-latest-mac-universal.zip';
  }

  if (platform === 'linux' && arch === 'x64') {
    // Linux auto-updates are only self-installable through the AppImage
    // updater path. Keep AppImage as the primary stable asset; .deb/.zip are
    // release-page fallback formats, not the in-app update target.
    return 'Producer-Player-latest-linux-x64.AppImage';
  }

  if (platform === 'win32' && arch === 'x64') {
    return 'Producer-Player-latest-win-x64.exe';
  }

  return null;
}

export function getStableDownloadUrl(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string | null {
  const assetName = getStableDownloadAssetName(platform, arch);
  if (!assetName) {
    return null;
  }

  return `${PUBLIC_RELEASES_LATEST_DOWNLOAD_BASE_URL}/${assetName}`;
}

export function getReleaseAssetNameCandidates(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string[] {
  const stableAssetName = getStableDownloadAssetName(platform, arch);
  const candidates = stableAssetName ? [stableAssetName] : [];

  if (platform === 'darwin') {
    candidates.push(
      'Producer-Player-latest-mac-arm64.zip',
      'Producer-Player-latest-mac-x64.zip',
    );
    return candidates;
  }

  if (platform === 'linux' && arch === 'x64') {
    candidates.push(
      'Producer-Player-latest-linux-x64.deb',
      'Producer-Player-latest-linux-x64.zip',
    );
    return candidates;
  }

  if (platform === 'win32' && arch === 'x64') {
    candidates.push('Producer-Player-latest-win-x64.zip');
    return candidates;
  }

  return candidates;
}

function getVersionedAssetPatterns(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): RegExp[] {
  if (platform === 'darwin') {
    return [/Producer-Player-.*-mac-(?:universal|arm64|x64)\.zip$/i];
  }

  if (platform === 'linux' && arch === 'x64') {
    return [
      /Producer-Player-.*-linux-x64\.AppImage$/i,
      /Producer-Player-.*-linux-x64\.deb$/i,
      /Producer-Player-.*-linux-x64\.zip$/i,
    ];
  }

  if (platform === 'win32' && arch === 'x64') {
    return [/Producer-Player-.*-win-x64\.(?:exe|zip)$/i];
  }

  return [];
}

export function resolveReleaseDownloadUrl(
  release: ReleaseAssetPayloadLike,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string | null {
  const candidateAssetNames = getReleaseAssetNameCandidates(platform, arch);

  for (const assetName of candidateAssetNames) {
    const matchedAsset = release.assets.find((asset) => asset.name === assetName);
    if (matchedAsset) {
      return matchedAsset.browserDownloadUrl;
    }
  }

  for (const pattern of getVersionedAssetPatterns(platform, arch)) {
    const matchedAsset = release.assets.find((asset) => pattern.test(asset.name));
    if (matchedAsset) {
      return matchedAsset.browserDownloadUrl;
    }
  }

  return getStableDownloadUrl(platform, arch);
}
