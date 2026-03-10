import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type PlaylistOrderExportV1,
  type ProducerPlayerBridge,
  type SnapshotListener,
  type TransportCommand,
  type TransportCommandListener,
} from '@producer-player/contracts';

const bridge: ProducerPlayerBridge = {
  async getLibrarySnapshot() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_LIBRARY_SNAPSHOT);
  },

  async getEnvironment() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_ENVIRONMENT);
  },

  async linkFolderWithDialog() {
    return ipcRenderer.invoke(IPC_CHANNELS.LINK_FOLDER_DIALOG);
  },

  async linkFolder(folderPath: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.LINK_FOLDER_PATH, folderPath);
  },

  async unlinkFolder(folderId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.UNLINK_FOLDER, folderId);
  },

  async rescanLibrary() {
    return ipcRenderer.invoke(IPC_CHANNELS.RESCAN_LIBRARY);
  },

  async organizeOldVersions() {
    return ipcRenderer.invoke(IPC_CHANNELS.ORGANIZE_OLD_VERSIONS);
  },

  async setAutoMoveOld(enabled: boolean) {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_AUTO_MOVE_OLD, enabled);
  },

  async reorderSongs(songIds: string[]) {
    return ipcRenderer.invoke(IPC_CHANNELS.REORDER_SONGS, songIds);
  },

  async exportPlaylistOrder(payload: PlaylistOrderExportV1) {
    return ipcRenderer.invoke(IPC_CHANNELS.EXPORT_PLAYLIST_ORDER, payload);
  },

  async importPlaylistOrder() {
    return ipcRenderer.invoke(IPC_CHANNELS.IMPORT_PLAYLIST_ORDER);
  },

  async revealFile(filePath: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.OPEN_IN_FINDER, filePath);
  },

  async openFolder(folderPath: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.OPEN_FOLDER, folderPath);
  },

  async toFileUrl(filePath: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.TO_FILE_URL, filePath);
  },

  async resolvePlaybackSource(filePath: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.RESOLVE_PLAYBACK_SOURCE, filePath);
  },

  async analyzeAudioFile(filePath: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.ANALYZE_AUDIO_FILE, filePath);
  },

  async pickReferenceTrack() {
    return ipcRenderer.invoke(IPC_CHANNELS.PICK_REFERENCE_TRACK);
  },

  onSnapshotUpdated(listener: SnapshotListener) {
    const wrappedListener = (_event: unknown, snapshot: unknown) => {
      listener(snapshot as Parameters<SnapshotListener>[0]);
    };

    ipcRenderer.on(IPC_CHANNELS.SNAPSHOT_UPDATED, wrappedListener);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SNAPSHOT_UPDATED, wrappedListener);
    };
  },

  onTransportCommand(listener: TransportCommandListener) {
    const wrappedListener = (_event: unknown, command: unknown) => {
      if (
        command === 'play-pause' ||
        command === 'next-track' ||
        command === 'previous-track'
      ) {
        listener(command as TransportCommand);
      }
    };

    ipcRenderer.on(IPC_CHANNELS.TRANSPORT_COMMAND, wrappedListener);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TRANSPORT_COMMAND, wrappedListener);
    };
  },
};

contextBridge.exposeInMainWorld('producerPlayer', bridge);
