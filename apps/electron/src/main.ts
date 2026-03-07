import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LibrarySnapshot } from '@producer-player/contracts';
import { IPC_CHANNELS } from '@producer-player/contracts';
import { FileLibraryService } from '@producer-player/domain';

const DEFAULT_RENDERER_DEV_URL =
  process.env.RENDERER_DEV_URL ?? 'http://127.0.0.1:4207';
const STATE_FILE_NAME = 'producer-player-electron-state.json';
const IS_TEST_MODE =
  process.env.APP_TEST_MODE === 'true' ||
  typeof process.env.PRODUCER_PLAYER_TEST_ID === 'string';

const customUserDataDirectory = process.env.PRODUCER_PLAYER_USER_DATA_DIR;
if (customUserDataDirectory) {
  app.setPath('userData', customUserDataDirectory);
}

app.setName('Producer Player');

let mainWindow: BrowserWindow | null = null;
let libraryService: FileLibraryService | null = null;

function isDevelopment(): boolean {
  return process.env.ELECTRON_DEV === 'true';
}

function getStateFilePath(): string {
  return join(app.getPath('userData'), STATE_FILE_NAME);
}

interface PersistedState {
  linkedFolderPaths: string[];
}

async function readPersistedState(): Promise<PersistedState> {
  try {
    const raw = await fs.readFile(getStateFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedState>;

    if (!Array.isArray(parsed.linkedFolderPaths)) {
      return { linkedFolderPaths: [] };
    }

    return {
      linkedFolderPaths: parsed.linkedFolderPaths.filter(
        (folderPath): folderPath is string => typeof folderPath === 'string'
      ),
    };
  } catch {
    return { linkedFolderPaths: [] };
  }
}

async function writePersistedState(snapshot: LibrarySnapshot): Promise<void> {
  const payload: PersistedState = {
    linkedFolderPaths: snapshot.linkedFolders.map((folder) => folder.path),
  };

  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(getStateFilePath(), JSON.stringify(payload, null, 2), 'utf8');
}

function findProductionIndexPath(): string | null {
  const candidates = [
    join(__dirname, '../../renderer/dist/index.html'),
    join(process.cwd(), 'apps/renderer/dist/index.html'),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function validateRendererDevUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`RENDERER_DEV_URL is invalid: ${url}`);
  }

  const allowedHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const allowedProtocol = parsed.protocol === 'http:' || parsed.protocol === 'https:';

  if (!allowedHost || !allowedProtocol) {
    throw new Error(
      `RENDERER_DEV_URL must be http(s)://localhost or http(s)://127.0.0.1. Received: ${url}`
    );
  }
}

async function createMainWindow(): Promise<void> {
  const productionIndexPath = findProductionIndexPath();
  const developmentMode = isDevelopment();

  let allowedOrigin: string | null = null;
  let allowFileProtocol = false;

  if (developmentMode) {
    validateRendererDevUrl(DEFAULT_RENDERER_DEV_URL);
    allowedOrigin = new URL(DEFAULT_RENDERER_DEV_URL).origin;
  } else if (productionIndexPath) {
    allowFileProtocol = true;
  }

  mainWindow = new BrowserWindow({
    title: 'Producer Player',
    width: 1380,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    center: true,
    backgroundColor: '#0a0f14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
    show: IS_TEST_MODE,
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    let allowed = false;

    try {
      const parsed = new URL(targetUrl);
      if (allowFileProtocol && parsed.protocol === 'file:') {
        allowed = true;
      } else if (allowedOrigin !== null && parsed.origin === allowedOrigin) {
        allowed = true;
      }
    } catch {
      // Invalid target URL, keep blocked.
    }

    if (!allowed) {
      event.preventDefault();
    }
  });

  if (!IS_TEST_MODE) {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show();
    });
  }

  if (developmentMode) {
    await mainWindow.loadURL(DEFAULT_RENDERER_DEV_URL);
    if (process.env.ELECTRON_OPEN_DEVTOOLS === 'true') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    return;
  }

  if (productionIndexPath) {
    await mainWindow.loadFile(productionIndexPath);
    return;
  }

  throw new Error(
    'Could not find renderer index.html. Build renderer first or run with ELECTRON_DEV=true.'
  );
}

async function ensureLibraryService(): Promise<FileLibraryService> {
  if (libraryService) {
    return libraryService;
  }

  const service = new FileLibraryService();
  const persistedState = await readPersistedState();
  await service.hydrateLinkedFolders(persistedState.linkedFolderPaths);

  service.subscribe((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.SNAPSHOT_UPDATED, snapshot);
    }

    void writePersistedState(snapshot);
  });

  libraryService = service;
  return service;
}

function registerIpcHandlers(service: FileLibraryService): void {
  ipcMain.handle(IPC_CHANNELS.GET_LIBRARY_SNAPSHOT, async () => service.getSnapshot());

  ipcMain.handle(IPC_CHANNELS.LINK_FOLDER_DIALOG, async () => {
    const dialogOptions: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Link Producer Folder',
      message: 'Choose a folder to watch for exports.',
    };

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return service.getSnapshot();
    }

    let snapshot = service.getSnapshot();
    for (const selectedPath of result.filePaths) {
      snapshot = await service.linkFolder(selectedPath);
    }

    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.LINK_FOLDER_PATH, async (_event, folderPath: string) => {
    return service.linkFolder(folderPath);
  });

  ipcMain.handle(IPC_CHANNELS.UNLINK_FOLDER, async (_event, folderId: string) => {
    return service.unlinkFolder(folderId);
  });

  ipcMain.handle(IPC_CHANNELS.RESCAN_LIBRARY, async () => service.rescanLibrary());

  ipcMain.handle(IPC_CHANNELS.OPEN_IN_FINDER, async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.TO_FILE_URL, async (_event, filePath: string) => {
    return pathToFileURL(filePath).toString();
  });
}

app.whenReady().then(async () => {
  const service = await ensureLibraryService();
  registerIpcHandlers(service);
  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  if (libraryService) {
    void libraryService.dispose();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
