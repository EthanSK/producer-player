import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AgentAttachment,
  type AgentEvent,
  type AgentEventListener,
  type AgentProviderId,
  type AgentRespondApprovalPayload,
  type AgentSaveAttachmentPayload,
  type AgentSendTurnPayload,
  type AgentStartSessionPayload,
  type AiRecommendation,
  type AutoUpdateState,
  type AutoUpdateStateListener,
  type ICloudBackupData,
  type PlaylistOrderExportV1,
  type ProducerPlayerBridge,
  type ProducerPlayerUserState,
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

  async openFile(filePath: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.OPEN_FILE, filePath);
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

  async getMasteringAnalysisCache() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_MASTERING_ANALYSIS_CACHE);
  },

  async writeMasteringAnalysisCache(payload) {
    return ipcRenderer.invoke(IPC_CHANNELS.WRITE_MASTERING_ANALYSIS_CACHE, payload);
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

  async autoUpdateCheck() {
    await ipcRenderer.invoke(IPC_CHANNELS.AUTO_UPDATE_CHECK);
  },

  async autoUpdateDownload() {
    await ipcRenderer.invoke(IPC_CHANNELS.AUTO_UPDATE_DOWNLOAD);
  },

  async autoUpdateInstall() {
    await ipcRenderer.invoke(IPC_CHANNELS.AUTO_UPDATE_INSTALL);
  },

  async setAutoUpdateEnabled(enabled: boolean) {
    await ipcRenderer.invoke(IPC_CHANNELS.AUTO_UPDATE_SET_ENABLED, enabled);
  },

  onAutoUpdateStateChanged(listener: AutoUpdateStateListener) {
    const wrappedListener = (_event: unknown, state: unknown) => {
      listener(state as AutoUpdateState);
    };

    ipcRenderer.on(IPC_CHANNELS.AUTO_UPDATE_STATE_CHANGED, wrappedListener);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AUTO_UPDATE_STATE_CHANGED, wrappedListener);
    };
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
        command === 'previous-track' ||
        command === 'seek-forward' ||
        command === 'seek-backward'
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

  async agentSaveAttachment(payload: AgentSaveAttachmentPayload): Promise<AgentAttachment> {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_SAVE_ATTACHMENT, payload);
  },

  async agentClearAttachments(paths: string[]): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNELS.AGENT_CLEAR_ATTACHMENTS, paths);
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

  async agentStoreAssemblyAiKey(key: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.AGENT_STORE_ASSEMBLYAI_KEY, key);
  },

  async agentGetAssemblyAiKey() {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_ASSEMBLYAI_KEY);
  },

  async agentClearAssemblyAiKey() {
    await ipcRenderer.invoke(IPC_CHANNELS.AGENT_CLEAR_ASSEMBLYAI_KEY);
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

  async openLogFolder() {
    await ipcRenderer.invoke(IPC_CHANNELS.OPEN_LOG_FOLDER);
  },

  async getLogPath() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_LOG_PATH);
  },

  async rendererLog(level: 'error' | 'warn' | 'info', message: string, meta?: Record<string, unknown>) {
    await ipcRenderer.invoke(IPC_CHANNELS.RENDERER_LOG, level, message, meta);
  },

  async getUserState() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_USER_STATE);
  },

  async setUserState(state: ProducerPlayerUserState) {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_USER_STATE, state);
  },

  async exportUserState() {
    return ipcRenderer.invoke(IPC_CHANNELS.EXPORT_USER_STATE);
  },

  async importUserState() {
    return ipcRenderer.invoke(IPC_CHANNELS.IMPORT_USER_STATE);
  },

  onUserStateChanged(listener: (state: ProducerPlayerUserState) => void) {
    const wrappedListener = (_event: unknown, state: unknown) => {
      listener(state as ProducerPlayerUserState);
    };

    ipcRenderer.on(IPC_CHANNELS.USER_STATE_CHANGED, wrappedListener);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.USER_STATE_CHANGED, wrappedListener);
    };
  },

  // v3.30 — AI mastering recommendations (storage-only; no UI consumer yet).
  async getAiRecommendations(songId: string, versionNumber: number) {
    return ipcRenderer.invoke(IPC_CHANNELS.AI_RECOMMENDATIONS_GET, songId, versionNumber);
  },

  async setAiRecommendation(
    songId: string,
    versionNumber: number,
    metricId: string,
    recommendation: AiRecommendation,
  ) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.AI_RECOMMENDATIONS_SET,
      songId,
      versionNumber,
      metricId,
      recommendation,
    );
  },

  async clearAiRecommendations(songId: string, versionNumber?: number) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.AI_RECOMMENDATIONS_CLEAR,
      songId,
      versionNumber ?? null,
    );
  },

  async markAiRecommendationsStale(
    songId: string,
    versionNumber: number,
    newAnalysisVersion: string,
  ) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.AI_RECOMMENDATIONS_MARK_STALE,
      songId,
      versionNumber,
      newAnalysisVersion,
    );
  },

  // v3.39 Phase 1a — plugin hosting (data model + sidecar scaffold; UI 1b).
  async scanPluginLibrary() {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_SCAN_LIBRARY);
  },
  async getPluginLibrary() {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_GET_LIBRARY);
  },
  async getTrackPluginChain(songId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_GET_TRACK_CHAIN, songId);
  },
  async setTrackPluginChain(songId, chain) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_SET_TRACK_CHAIN, songId, chain);
  },
  async addPluginToChain(songId, pluginId) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_ADD_TO_CHAIN, songId, pluginId);
  },
  async removePluginFromChain(songId, instanceId) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_REMOVE_FROM_CHAIN, songId, instanceId);
  },
  async reorderPluginChain(songId, orderedInstanceIds) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_REORDER_CHAIN, songId, orderedInstanceIds);
  },
  async togglePluginEnabled(songId, instanceId, enabled) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_TOGGLE_ENABLED, songId, instanceId, enabled);
  },
  async setPluginState(songId, instanceId, stateBase64) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_SET_STATE, songId, instanceId, stateBase64);
  },
  async savePluginPreset(songId, instanceId, name) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_PRESET_SAVE, { songId, instanceId, name });
  },
  async recallPluginPreset(songId, instanceId, name) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_PRESET_RECALL, { songId, instanceId, name });
  },
  async listPluginPresets(pluginIdentifier) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_PRESET_LIST, { pluginIdentifier });
  },
  async deletePluginPreset(pluginIdentifier, name) {
    await ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_PRESET_DELETE, { pluginIdentifier, name });
  },

  // v3.42 Phase 3 — native plugin editor windows.
  async openPluginEditor(instanceId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_EDITOR_OPEN, instanceId);
  },

  async closePluginEditor(instanceId: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_EDITOR_CLOSE, instanceId);
  },

  onPluginEditorClosed(listener: (instanceId: string) => void) {
    const wrappedListener = (_event: unknown, instanceId: unknown) => {
      if (typeof instanceId === 'string' && instanceId.length > 0) {
        listener(instanceId);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.PLUGIN_EDITOR_CLOSED_EVENT, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.PLUGIN_EDITOR_CLOSED_EVENT, wrappedListener);
    };
  },
};

contextBridge.exposeInMainWorld('producerPlayer', bridge);
