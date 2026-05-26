import {
  PUBLIC_RELEASES_URL,
  getReleaseAssetNameCandidates,
} from './release-assets';

export const GITHUB_RELEASES_API_URL =
  'https://api.github.com/repos/EthanSK/producer-player/releases?per_page=30';

export interface DowngradeReleaseAsset {
  name: string;
  browserDownloadUrl: string;
}

export interface DowngradeReleaseCandidate {
  tagName: string;
  htmlUrl: string;
  name: string | null;
  publishedAt: string | null;
  draft: boolean;
  prerelease: boolean;
  assets: DowngradeReleaseAsset[];
}

export interface DowngradeCurrentVersion {
  semanticVersion: string;
  buildNumber: number | null;
  displayVersion: string;
}

export interface ParsedDowngradeVersion {
  semanticVersion: string;
  buildNumber: number | null;
}

export type PreviousDowngradeReleaseResolution =
  | {
      status: 'available';
      release: DowngradeReleaseCandidate;
      parsedVersion: ParsedDowngradeVersion;
      displayVersion: string;
      downloadUrl: string;
      metadataAssetName: string;
      feedUrl: string;
    }
  | {
      status: 'no-previous-version';
      currentVersion: string;
      message: string;
    };

export type TargetReleaseDirection = 'upgrade' | 'downgrade';

export type TargetReleaseResolution =
  | {
      status: 'available';
      direction: TargetReleaseDirection;
      release: DowngradeReleaseCandidate;
      parsedVersion: ParsedDowngradeVersion;
      displayVersion: string;
      downloadUrl: string;
      metadataAssetName: string;
      feedUrl: string;
    }
  | {
      status: 'no-target-version';
      requestedVersion: string;
      currentVersion: string;
      message: string;
    };

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
}

function parseSemverToken(token: string): number | string {
  if (/^\d+$/.test(token)) {
    return Number(token);
  }

  return token;
}

function parseSemver(value: string): ParsedSemver | null {
  const normalized = value.trim().replace(/^v/i, '');
  const matched = normalized.match(
    /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );

  if (!matched) {
    return null;
  }

  const major = Number(matched[1]);
  const minor = Number(matched[2]);
  const patch = matched[3] !== undefined ? Number(matched[3]) : 0;

  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }

  return {
    major,
    minor,
    patch,
    prerelease:
      matched[4]?.split('.').filter((token) => token.length > 0).map(parseSemverToken) ?? [],
  };
}

function comparePrereleaseIdentifier(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  if (typeof left === 'number') {
    return -1;
  }

  if (typeof right === 'number') {
    return 1;
  }

  if (left === right) {
    return 0;
  }

  return left > right ? 1 : -1;
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  const leftHasPrerelease = left.prerelease.length > 0;
  const rightHasPrerelease = right.prerelease.length > 0;

  if (!leftHasPrerelease && !rightHasPrerelease) return 0;
  if (!leftHasPrerelease) return 1;
  if (!rightHasPrerelease) return -1;

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftToken = left.prerelease[index];
    const rightToken = right.prerelease[index];

    if (leftToken === undefined) return -1;
    if (rightToken === undefined) return 1;

    const tokenDelta = comparePrereleaseIdentifier(leftToken, rightToken);
    if (tokenDelta !== 0) return tokenDelta;
  }

  return 0;
}

function normalizeBuildNumber(value: string | undefined): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

export function parseDowngradeReleaseVersion(value: string): ParsedDowngradeVersion {
  const normalized = value.trim().replace(/^v/i, '');
  const buildMatch = normalized.match(/^(.*)-build\.(\d+)$/i);

  if (!buildMatch) {
    return {
      semanticVersion: normalized,
      buildNumber: null,
    };
  }

  return {
    semanticVersion: (buildMatch[1] ?? normalized).trim(),
    buildNumber: normalizeBuildNumber(buildMatch[2]),
  };
}

export function toDowngradeDisplayVersion(semver: string): string {
  const match = semver.match(/^(\d+\.\d+)\.0$/);
  return match ? match[1] : semver;
}

export function compareDowngradeVersions(
  left: ParsedDowngradeVersion,
  right: ParsedDowngradeVersion,
): number {
  const leftComparable = parseSemver(left.semanticVersion);
  const rightComparable = parseSemver(right.semanticVersion);

  if (!leftComparable || !rightComparable) {
    return left.semanticVersion.localeCompare(right.semanticVersion);
  }

  const semanticDelta = compareSemver(leftComparable, rightComparable);
  if (semanticDelta !== 0) {
    return semanticDelta;
  }

  // Build-number tags are rare, but this keeps downgrade ordering safe when
  // two releases share the same semantic version. Missing build metadata is
  // treated as build zero, matching the existing updater comparison behavior.
  return (left.buildNumber ?? 0) - (right.buildNumber ?? 0);
}

function compareReleaseVersionToInstalledVersion(
  releaseVersion: ParsedDowngradeVersion,
  installedVersion: ParsedDowngradeVersion,
): number {
  const releaseComparable = parseSemver(releaseVersion.semanticVersion);
  const installedComparable = parseSemver(installedVersion.semanticVersion);

  if (!releaseComparable || !installedComparable) {
    return releaseVersion.semanticVersion.localeCompare(installedVersion.semanticVersion);
  }

  const semanticDelta = compareSemver(releaseComparable, installedComparable);
  if (semanticDelta !== 0) {
    return semanticDelta;
  }

  // The installed app embeds CI build metadata even when the public release
  // tag is only vX.Y.Z. A same-semver tag without explicit build metadata is
  // therefore the current release, not the previous version. Only compare
  // build numbers when the release tag itself opted into -build.N semantics.
  if (releaseVersion.buildNumber === null) {
    return 0;
  }

  return releaseVersion.buildNumber - (installedVersion.buildNumber ?? 0);
}

export function getUpdaterMetadataAssetName(platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') return 'latest-mac.yml';
  if (platform === 'linux') return 'latest-linux.yml';
  if (platform === 'win32') return 'latest.yml';
  return null;
}

function getVersionedDowngradeAssetPatterns(
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

export function resolveDowngradeDownloadUrl(
  release: DowngradeReleaseCandidate,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string | null {
  for (const assetName of getReleaseAssetNameCandidates(platform, arch)) {
    const matchedAsset = release.assets.find((asset) => asset.name === assetName);
    if (matchedAsset) {
      return matchedAsset.browserDownloadUrl;
    }
  }

  for (const pattern of getVersionedDowngradeAssetPatterns(platform, arch)) {
    const matchedAsset = release.assets.find((asset) => pattern.test(asset.name));
    if (matchedAsset) {
      return matchedAsset.browserDownloadUrl;
    }
  }

  // Deliberately no fallback to /releases/latest/download here. The downgrade
  // button must never accidentally fetch the newest build when an older release
  // is missing the platform asset we need.
  return null;
}

export function buildDowngradeFeedUrl(tagName: string): string {
  return `${PUBLIC_RELEASES_URL}/download/${encodeURIComponent(tagName)}/`;
}

function normalizeRequestedReleaseVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

function versionsReferToSameRelease(
  releaseVersion: ParsedDowngradeVersion,
  requestedVersion: ParsedDowngradeVersion,
): boolean {
  const releaseComparable = parseSemver(releaseVersion.semanticVersion);
  const requestedComparable = parseSemver(requestedVersion.semanticVersion);

  if (!releaseComparable || !requestedComparable) {
    return releaseVersion.semanticVersion.toLowerCase() ===
      requestedVersion.semanticVersion.toLowerCase();
  }

  if (compareSemver(releaseComparable, requestedComparable) !== 0) {
    return false;
  }

  // Build-tagged releases are exact-addressable. Plain public tags such as
  // v3.264.0 should still match a user/agent request for "3.264" or "3.264.0".
  if (requestedVersion.buildNumber !== null) {
    return releaseVersion.buildNumber === requestedVersion.buildNumber;
  }

  return releaseVersion.buildNumber === null;
}

export function parseGithubReleaseListPayload(payload: unknown): DowngradeReleaseCandidate[] {
  if (!Array.isArray(payload)) {
    throw new Error('GitHub releases payload is not an array.');
  }

  return payload.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return [];
    }

    const candidate = entry as {
      tag_name?: unknown;
      html_url?: unknown;
      name?: unknown;
      published_at?: unknown;
      draft?: unknown;
      prerelease?: unknown;
      assets?: unknown;
    };

    if (
      typeof candidate.tag_name !== 'string' ||
      candidate.tag_name.trim().length === 0 ||
      typeof candidate.html_url !== 'string' ||
      candidate.html_url.trim().length === 0
    ) {
      return [];
    }

    const assetsRaw = Array.isArray(candidate.assets) ? candidate.assets : [];
    const assets = assetsRaw.flatMap((assetEntry) => {
      if (typeof assetEntry !== 'object' || assetEntry === null || Array.isArray(assetEntry)) {
        return [];
      }

      const asset = assetEntry as { name?: unknown; browser_download_url?: unknown };
      if (
        typeof asset.name !== 'string' ||
        asset.name.length === 0 ||
        typeof asset.browser_download_url !== 'string' ||
        asset.browser_download_url.length === 0
      ) {
        return [];
      }

      return [
        {
          name: asset.name,
          browserDownloadUrl: asset.browser_download_url,
        },
      ];
    });

    return [
      {
        tagName: candidate.tag_name,
        htmlUrl: candidate.html_url,
        name: typeof candidate.name === 'string' ? candidate.name : null,
        publishedAt: typeof candidate.published_at === 'string' ? candidate.published_at : null,
        draft: candidate.draft === true,
        prerelease: candidate.prerelease === true,
        assets,
      },
    ];
  });
}

export function resolvePreviousDowngradeRelease(options: {
  releases: DowngradeReleaseCandidate[];
  currentVersion: DowngradeCurrentVersion;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
}): PreviousDowngradeReleaseResolution {
  const currentParsed: ParsedDowngradeVersion = {
    semanticVersion: options.currentVersion.semanticVersion,
    buildNumber: options.currentVersion.buildNumber,
  };
  const metadataAssetName = getUpdaterMetadataAssetName(options.platform);

  if (!metadataAssetName) {
    return {
      status: 'no-previous-version',
      currentVersion: options.currentVersion.displayVersion,
      message: 'Downgrade is not available on this platform.',
    };
  }

  const compatibleOlderReleases = options.releases
    .flatMap((release) => {
      // Draft/prerelease builds are skipped on purpose: the downgrade button is
      // an emergency safety rail for stable users, not a path into test builds.
      if (release.draft || release.prerelease) return [];

      const parsedVersion = parseDowngradeReleaseVersion(release.tagName);
      if (compareReleaseVersionToInstalledVersion(parsedVersion, currentParsed) >= 0) return [];

      const metadataAsset = release.assets.find((asset) => asset.name === metadataAssetName);
      const downloadUrl = resolveDowngradeDownloadUrl(release, options.platform, options.arch);
      if (!metadataAsset || !downloadUrl) return [];

      return [
        {
          release,
          parsedVersion,
          displayVersion: toDowngradeDisplayVersion(parsedVersion.semanticVersion),
          downloadUrl,
          metadataAssetName,
          feedUrl: buildDowngradeFeedUrl(release.tagName),
        },
      ];
    })
    .sort((left, right) => compareDowngradeVersions(right.parsedVersion, left.parsedVersion));

  const previousRelease = compatibleOlderReleases[0];
  if (!previousRelease) {
    return {
      status: 'no-previous-version',
      currentVersion: options.currentVersion.displayVersion,
      message: `No older Producer Player release is available for v${options.currentVersion.displayVersion}.`,
    };
  }

  return {
    status: 'available',
    ...previousRelease,
  };
}

export function resolveTargetRelease(options: {
  releases: DowngradeReleaseCandidate[];
  currentVersion: DowngradeCurrentVersion;
  requestedVersion: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
}): TargetReleaseResolution {
  const requested = normalizeRequestedReleaseVersion(options.requestedVersion);
  const requestedParsed = parseDowngradeReleaseVersion(requested);
  const currentParsed: ParsedDowngradeVersion = {
    semanticVersion: options.currentVersion.semanticVersion,
    buildNumber: options.currentVersion.buildNumber,
  };
  const metadataAssetName = getUpdaterMetadataAssetName(options.platform);

  if (!metadataAssetName) {
    return {
      status: 'no-target-version',
      requestedVersion: options.requestedVersion,
      currentVersion: options.currentVersion.displayVersion,
      message: 'Specific-version installs are not available on this platform.',
    };
  }

  for (const release of options.releases) {
    // Keep the agent-facing install rail stable-only by default. Drafts and
    // prereleases can have missing or experimental updater metadata, so letting
    // MCP select them would be a footgun for emergency rollback workflows.
    if (release.draft || release.prerelease) {
      continue;
    }

    const parsedVersion = parseDowngradeReleaseVersion(release.tagName);
    const normalizedTag = normalizeRequestedReleaseVersion(release.tagName).toLowerCase();
    const isExactTagMatch = normalizedTag === requested.toLowerCase();
    const isVersionMatch = versionsReferToSameRelease(parsedVersion, requestedParsed);
    if (!isExactTagMatch && !isVersionMatch) {
      continue;
    }

    const metadataAsset = release.assets.find((asset) => asset.name === metadataAssetName);
    const downloadUrl = resolveDowngradeDownloadUrl(release, options.platform, options.arch);
    if (!metadataAsset || !downloadUrl) {
      continue;
    }

    const comparison = compareReleaseVersionToInstalledVersion(parsedVersion, currentParsed);
    if (comparison === 0) {
      return {
        status: 'no-target-version',
        requestedVersion: options.requestedVersion,
        currentVersion: options.currentVersion.displayVersion,
        message: `Producer Player is already on v${toDowngradeDisplayVersion(parsedVersion.semanticVersion)}.`,
      };
    }

    return {
      status: 'available',
      direction: comparison > 0 ? 'upgrade' : 'downgrade',
      release,
      parsedVersion,
      displayVersion: toDowngradeDisplayVersion(parsedVersion.semanticVersion),
      downloadUrl,
      metadataAssetName,
      feedUrl: buildDowngradeFeedUrl(release.tagName),
    };
  }

  return {
    status: 'no-target-version',
    requestedVersion: options.requestedVersion,
    currentVersion: options.currentVersion.displayVersion,
    message: `No installable Producer Player release was found for "${options.requestedVersion}".`,
  };
}
