import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AgentEvent,
  type AgentEventListener,
  type AgentProviderId,
  type AgentRespondApprovalPayload,
  type AgentSendTurnPayload,
  type AgentStartSessionPayload,
  type ICloudBackupData,
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

  async exportLatestVersionsInOrder(payload: PlaylistOrderExportV1) {
    return ipcRenderer.invoke(IPC_CHANNELS.EXPORT_LATEST_VERSIONS_IN_ORDER, payload);
  },

  async revealFile(filePath: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.OPEN_IN_FINDER, filePath);
  },

  async openFolder(folderPath: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.OPEN_FOLDER, folderPath);
  },

  async openExternalUrl(url: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL_URL, url);
  },

  async copyTextToClipboard(text: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.COPY_TEXT_TO_CLIPBOARD, text);
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

  async pickProjectFile(initialPath?: string | null) {
    return ipcRenderer.invoke(IPC_CHANNELS.PICK_PROJECT_FILE, initialPath ?? null);
  },

  async getSharedUserState() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_SHARED_USER_STATE);
  },

  async setSharedUserState(state) {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_SHARED_USER_STATE, state);
  },

  async syncToICloud(data: ICloudBackupData) {
    return ipcRenderer.invoke(IPC_CHANNELS.SYNC_TO_ICLOUD, data);
  },

  async loadFromICloud() {
    return ipcRenderer.invoke(IPC_CHANNELS.LOAD_FROM_ICLOUD);
  },

  async checkICloudAvailable() {
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_ICLOUD_AVAILABLE);
  },

  async checkForUpdates() {
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_FOR_UPDATES);
  },

  async openUpdateDownload(url?: string | null) {
    await ipcRenderer.invoke(IPC_CHANNELS.OPEN_UPDATE_DOWNLOAD, url);
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

  async agentStartSession(payload: AgentStartSessionPayload) {
    await ipcRenderer.invoke(IPC_CHANNELS.AGENT_START_SESSION, payload);
  },

  async agentSendTurn(payload: AgentSendTurnPayload) {
    await ipcRenderer.invoke(IPC_CHANNELS.AGENT_SEND_TURN, payload);
  },

  async agentInterrupt() {
    await ipcRenderer.invoke(IPC_CHANNELS.AGENT_INTERRUPT);
  },

  async agentRespondApproval(payload: AgentRespondApprovalPayload) {
    await ipcRenderer.invoke(IPC_CHANNELS.AGENT_RESPOND_APPROVAL, payload);
  },

  async agentDestroySession() {
    await ipcRenderer.invoke(IPC_CHANNELS.AGENT_DESTROY_SESSION);
  },

  async agentCheckProvider(provider: AgentProviderId) {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_CHECK_PROVIDER, provider);
  },

  async agentStoreDeepgramKey(key: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.AGENT_STORE_DEEPGRAM_KEY, key);
  },

  async agentGetDeepgramKey() {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_DEEPGRAM_KEY);
  },

  async agentClearDeepgramKey() {
    await ipcRenderer.invoke(IPC_CHANNELS.AGENT_CLEAR_DEEPGRAM_KEY);
  },

  onAgentEvent(listener: AgentEventListener) {
    const wrappedListener = (_event: unknown, agentEvent: unknown) => {
      listener(agentEvent as AgentEvent);
    };

    ipcRenderer.on(IPC_CHANNELS.AGENT_EVENT, wrappedListener);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AGENT_EVENT, wrappedListener);
    };
  },
};

contextBridge.exposeInMainWorld('producerPlayer', bridge);
