import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type ProducerPlayerBridge,
  type SnapshotListener,
} from '@producer-player/contracts';

const bridge: ProducerPlayerBridge = {
  async getLibrarySnapshot() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_LIBRARY_SNAPSHOT);
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

  async revealFile(filePath: string) {
    await ipcRenderer.invoke(IPC_CHANNELS.OPEN_IN_FINDER, filePath);
  },

  async toFileUrl(filePath: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.TO_FILE_URL, filePath);
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
};

contextBridge.exposeInMainWorld('producerPlayer', bridge);
