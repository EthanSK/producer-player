import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import log from 'electron-log/main';
import type { PluginPresetEntry, PluginPresetLibrary } from '@producer-player/contracts';

export const PLUGIN_PRESET_LIBRARY_FILE_NAME = 'plugin-presets.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePresetEntry(value: unknown): PluginPresetEntry | null {
  if (!isRecord(value)) return null;
  const { pluginIdentifier, name, stateBase64, savedAt } = value;
  if (
    typeof pluginIdentifier !== 'string' ||
    typeof name !== 'string' ||
    typeof stateBase64 !== 'string' ||
    typeof savedAt !== 'string'
  ) {
    return null;
  }
  return { pluginIdentifier, name, stateBase64, savedAt };
}

function parseLibrary(value: unknown): PluginPresetLibrary | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.presets)) {
    return null;
  }
  return {
    version: 1,
    presets: value.presets.flatMap((entry) => {
      const parsed = parsePresetEntry(entry);
      return parsed ? [parsed] : [];
    }),
  };
}

export class PluginPresetLibraryStore {
  private readonly filePath: string;
  private readonly tmpPath: string;
  private cache: PluginPresetLibrary | null = null;
  private mutationTail: Promise<unknown> = Promise.resolve();

  constructor(private readonly userDataDir: string) {
    this.filePath = join(userDataDir, PLUGIN_PRESET_LIBRARY_FILE_NAME);
    this.tmpPath = `${this.filePath}.tmp`;
  }

  async listPresetsFor(pluginIdentifier: string): Promise<PluginPresetEntry[]> {
    const library = await this.load();
    return library.presets
      .filter((preset) => preset.pluginIdentifier === pluginIdentifier)
      .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
      .map((preset) => ({ ...preset }));
  }

  async savePreset(
    pluginIdentifier: string,
    name: string,
    stateBase64: string,
  ): Promise<PluginPresetEntry> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Preset name is required.');
    }
    if (!pluginIdentifier) {
      throw new Error('Plugin identifier is required.');
    }
    return this.enqueueMutation(async () => {
      const library = await this.load();
      const savedAt = new Date().toISOString();
      const nextEntry: PluginPresetEntry = {
        pluginIdentifier,
        name: trimmedName,
        stateBase64,
        savedAt,
      };
      const existingIndex = library.presets.findIndex(
        (preset) =>
          preset.pluginIdentifier === pluginIdentifier && preset.name === trimmedName,
      );
      if (existingIndex >= 0) {
        library.presets[existingIndex] = nextEntry;
      } else {
        library.presets.push(nextEntry);
      }
      await this.write(library);
      return { ...nextEntry };
    });
  }

  async getPreset(
    pluginIdentifier: string,
    name: string,
  ): Promise<PluginPresetEntry | null> {
    const trimmedName = name.trim();
    const library = await this.load();
    const preset =
      library.presets.find(
        (entry) =>
          entry.pluginIdentifier === pluginIdentifier && entry.name === trimmedName,
      ) ?? null;
    return preset ? { ...preset } : null;
  }

  async deletePreset(pluginIdentifier: string, name: string): Promise<void> {
    const trimmedName = name.trim();
    await this.enqueueMutation(async () => {
      const library = await this.load();
      const nextPresets = library.presets.filter(
        (preset) =>
          !(preset.pluginIdentifier === pluginIdentifier && preset.name === trimmedName),
      );
      if (nextPresets.length === library.presets.length) return;
      library.presets = nextPresets;
      await this.write(library);
    });
  }

  private async load(): Promise<PluginPresetLibrary> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = parseLibrary(JSON.parse(raw));
      if (!parsed) {
        log.warn('[plugin-presets] invalid plugin-presets.json; starting fresh');
        this.cache = { version: 1, presets: [] };
        return this.cache;
      }
      this.cache = parsed;
      return this.cache;
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        this.cache = { version: 1, presets: [] };
        return this.cache;
      }
      log.warn('[plugin-presets] failed to load plugin-presets.json; starting fresh', err);
      this.cache = { version: 1, presets: [] };
      return this.cache;
    }
  }

  private async write(library: PluginPresetLibrary): Promise<void> {
    await mkdir(this.userDataDir, { recursive: true });
    const payload = `${JSON.stringify(library, null, 2)}\n`;
    await writeFile(this.tmpPath, payload, 'utf8');
    await rename(this.tmpPath, this.filePath);
  }

  private enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
    const queued = this.mutationTail.then(fn, fn);
    this.mutationTail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }
}
