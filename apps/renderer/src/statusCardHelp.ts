import type { ICloudAvailabilityResult, LinkedFolder, ProducerPlayerEnvironment } from '@producer-player/contracts';

const ORDER_SIDECAR_DIRECTORY = '.producer-player';
const ORDER_SIDECAR_FILE = 'order-state.json';
const STATE_DIRECTORY_SYMLINK_NAME = 'state';
const ICLOUD_CHECKLISTS_FILE = 'checklists.json';
const ICLOUD_RATINGS_FILE = 'ratings.json';
const ICLOUD_STATE_FILE = 'state.json';

function detectPathSeparator(basePath: string): '/' | '\\' {
  return basePath.includes('\\') && !basePath.includes('/') ? '\\' : '/';
}

function joinDisplayPath(basePath: string, relativePath: string): string {
  const separator = detectPathSeparator(basePath);
  const normalizedRelativePath = relativePath.replace(/[\\/]+/g, separator);
  const trimmedBasePath = basePath.replace(/[\\/]+$/, '');
  return `${trimmedBasePath}${separator}${normalizedRelativePath}`;
}

function formatPathList(
  linkedFolders: LinkedFolder[],
  mapPath: (folder: LinkedFolder) => string,
  fallbackLine: string,
): string {
  if (linkedFolders.length === 0) {
    return fallbackLine;
  }

  return linkedFolders.map((folder) => `• ${mapPath(folder)}`).join('\n');
}

function buildICloudSection(iCloudAvailability: ICloudAvailabilityResult | null): string {
  if (iCloudAvailability?.path) {
    const backupDirectory = iCloudAvailability.path;
    return [
      `• iCloud backup folder: ${backupDirectory}`,
      '• Files inside that backup folder:',
      `  • ${joinDisplayPath(backupDirectory, ICLOUD_CHECKLISTS_FILE)}`,
      `  • ${joinDisplayPath(backupDirectory, ICLOUD_RATINGS_FILE)}`,
      `  • ${joinDisplayPath(backupDirectory, ICLOUD_STATE_FILE)}`,
    ].join('\n');
  }

  if (iCloudAvailability !== null && !iCloudAvailability.available) {
    return [
      `• iCloud backup folder: unavailable (${iCloudAvailability.reason ?? 'iCloud Drive is not available on this machine.'})`,
      `• Backup file names when available: ${ICLOUD_CHECKLISTS_FILE}, ${ICLOUD_RATINGS_FILE}, ${ICLOUD_STATE_FILE}`,
    ].join('\n');
  }

  return [
    '• iCloud backup folder: shown here once iCloud Drive is available.',
    `• Backup file names: ${ICLOUD_CHECKLISTS_FILE}, ${ICLOUD_RATINGS_FILE}, ${ICLOUD_STATE_FILE}`,
  ].join('\n');
}

function fileManagerLabel(platform: string): string {
  if (platform === 'win32') return 'Explorer';
  if (platform === 'linux') return 'File Manager';
  return 'Finder';
}

export function buildStatusCardHelpText(
  linkedFolders: LinkedFolder[],
  iCloudAvailability: ICloudAvailabilityResult | null,
  environment?: Pick<ProducerPlayerEnvironment, 'platform'> | null,
): string {
  const fmLabel = fileManagerLabel(environment?.platform ?? 'darwin');
  const linkedFolderPathLines =
    linkedFolders.length > 0
      ? linkedFolders.map((folder) => `• ${folder.name}: ${folder.path}`).join('\n')
      : '• No linked folders yet. Use Add Folder… above to start tracking exports.';

  const autoOrganizeArchiveLines = formatPathList(
    linkedFolders,
    (folder) => joinDisplayPath(folder.path, 'old'),
    '• Archive paths appear after you link at least one folder.',
  );

  const orderMetadataLines = formatPathList(
    linkedFolders,
    (folder) => joinDisplayPath(folder.path, `${ORDER_SIDECAR_DIRECTORY}/${ORDER_SIDECAR_FILE}`),
    '• Order metadata paths appear after you link at least one folder.',
  );

  const folderStateMirrorLines = formatPathList(
    linkedFolders,
    (folder) => joinDisplayPath(folder.path, `${ORDER_SIDECAR_DIRECTORY}/${STATE_DIRECTORY_SYMLINK_NAME}`),
    '• Folder state mirror paths appear after you link at least one folder.',
  );

  return `What this card shows:
• Status tells you whether Producer Player is idle, actively scanning, watching your folders for changes, or reporting an error.
• Last scan is the timestamp of the most recent completed library refresh.

Auto-organize old versions:
• ON: older non-archived versions are moved into each linked folder's old/ subfolder while the newest version stays in the main export folder.
• OFF: no automatic moves happen; every version stays where you exported it until you run Organize manually.

Watched folder paths:
${linkedFolderPathLines}

Auto-organize archive paths:
${autoOrganizeArchiveLines}

Per-folder order metadata:
${orderMetadataLines}

Per-folder state mirror:
${folderStateMirrorLines}
• These .producer-player paths hold playlist-order metadata and a shortcut to the app state folder for ${fmLabel}-level backup/debugging.

iCloud backup:
${buildICloudSection(iCloudAvailability)}
• "Back up to iCloud" syncs checklists, ratings, and app preferences only (not audio files).
• Use the Show button beside iCloud backup to open the exact backup folder in ${fmLabel}.`;
}
