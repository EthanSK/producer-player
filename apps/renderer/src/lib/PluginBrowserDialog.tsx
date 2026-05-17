/**
 * PluginBrowserDialog (v3.40, Phase 1b — UI only)
 * ---------------------------------------------------------------------------
 * Modal overlay that lets the user pick a plugin to append to the chain.
 *
 * - Search filters by plugin name + vendor (case-insensitive substring).
 * - Empty / stale library surfaces an explicit scan action (no auto-scan).
 * - Scan roots are user-controlled: choose folders or type a path, then scan.
 * - Keyboard: Esc → close, `/` → focus search, Enter → add highlighted.
 * - Styling uses the existing dark-theme tokens only (see styles.css).
 *
 * The dialog is unaware of IPC — parents pass callbacks; actual persistence,
 * folder-picking, and scan calls happen in App.tsx/Electron main.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  PluginInfo,
  PluginScanProgress,
  PluginScanSettings,
  ScannedPluginLibrary,
} from '@producer-player/contracts';

import { InstantTooltipPopover } from '../InstantTooltip';
export interface PluginBrowserDialogProps {
  library: ScannedPluginLibrary | null;
  scanning: boolean;
  /**
   * v3.171 — latest `scan_progress` event from the sidecar. Used to render
   * "Scanning plugins (k/n): name" inline in the empty-state placeholder
   * while a long catalogue walk is in flight, instead of leaving the user
   * staring at a static "Scanning standard VST3/AU folders…" message for
   * the full ~90 s duration.
   */
  scanProgress?: PluginScanProgress | null;
  scanSettings?: PluginScanSettings;
  onClose: () => void;
  onPick: (pluginId: string) => void;
  onScan: (paths?: string[]) => void;
  onSetScanPaths?: (paths: string[]) => void;
  onPickScanPaths?: () => void;
}

function formatTypeBadge(format: PluginInfo['format']): string {
  switch (format) {
    case 'vst3':
      return 'VST3';
    case 'au':
      return 'AU';
    case 'clap':
      return 'CLAP';
    default:
      return String(format).toUpperCase();
  }
}

function mergePathList(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function formatPathLabel(path: string): string {
  return path.replace(/^\/Users\/[^/]+\//, '~/');
}

export function PluginBrowserDialog(props: PluginBrowserDialogProps): JSX.Element {
  const {
    library,
    scanning,
    scanProgress = null,
    scanSettings,
    onClose,
    onPick,
    onScan,
    onSetScanPaths,
    onPickScanPaths,
  } = props;
  const [query, setQuery] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const allPlugins = useMemo<PluginInfo[]>(() => library?.plugins ?? [], [library]);

  const filteredPlugins = useMemo<PluginInfo[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allPlugins;
    return allPlugins.filter((plugin) => {
      return (
        plugin.name.toLowerCase().includes(needle) ||
        plugin.vendor.toLowerCase().includes(needle)
      );
    });
  }, [allPlugins, query]);

  const customPaths = scanSettings?.customPaths ?? [];
  const effectivePaths = scanSettings?.effectivePaths ?? [];
  const usingDefaultPaths = scanSettings?.usingDefaultPaths ?? (customPaths.length === 0);
  const scanButtonLabel = scanning
    ? 'Scanning…'
    : usingDefaultPaths
      ? 'Scan standard folders'
      : 'Scan selected paths';

  // Keep highlight in range as the filter narrows.
  useEffect(() => {
    if (filteredPlugins.length === 0) {
      setHighlightedIndex(0);
      return;
    }
    setHighlightedIndex((current) => {
      if (current < 0) return 0;
      if (current >= filteredPlugins.length) return filteredPlugins.length - 1;
      return current;
    });
  }, [filteredPlugins.length]);

  // Autofocus search on mount. Scanning is intentionally explicit: opening
  // the plugin browser should not spawn the sidecar or crawl plugin folders.
  useEffect(() => {
    const input = searchInputRef.current;
    if (input) input.focus();
  }, []);

  const handleAddManualPath = useCallback(() => {
    const trimmed = manualPath.trim();
    if (!trimmed) return;
    onSetScanPaths?.(mergePathList([...customPaths, trimmed]));
    setManualPath('');
  }, [customPaths, manualPath, onSetScanPaths]);

  const handleRemovePath = useCallback(
    (pathToRemove: string) => {
      onSetScanPaths?.(customPaths.filter((path) => path !== pathToRemove));
    },
    [customPaths, onSetScanPaths],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === '/') {
        // `/` = jump to search. Only intercept if the user isn't already in a
        // text input (otherwise they can type a literal slash).
        const target = event.target as HTMLElement | null;
        if (target && target.tagName !== 'INPUT') {
          event.preventDefault();
          searchInputRef.current?.focus();
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedIndex((i) =>
          Math.min(filteredPlugins.length - 1, Math.max(0, i + 1)),
        );
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (event.key === 'Enter') {
        const target = event.target as HTMLElement | null;
        if (target === searchInputRef.current) {
          const candidate = filteredPlugins[highlightedIndex];
          if (candidate?.isSupported) {
            event.preventDefault();
            onPick(candidate.id);
          }
        }
      }
    },
    [filteredPlugins, highlightedIndex, onClose, onPick],
  );

  const libraryIsEmpty = !library || library.plugins.length === 0;

  return (
    <div
      className="plugin-browser-dialog__backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid="plugin-browser-dialog-backdrop"
    >
      <div
        className="plugin-browser-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Plugin browser"
        data-testid="plugin-browser-dialog"
        onKeyDown={handleKeyDown}
      >
        <header className="plugin-browser-dialog__header">
          <h2 className="plugin-browser-dialog__title">Add plugin</h2>
          <button
            type="button"
            className="plugin-browser-dialog__close"
            onClick={onClose}
            aria-label="Close plugin browser"
            data-testid="plugin-browser-dialog-close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="plugin-browser-dialog__search-row">
          <input
            ref={searchInputRef}
            type="search"
            className="plugin-browser-dialog__search"
            placeholder="Search by name or vendor…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search plugins"
            data-testid="plugin-browser-dialog-search"
          />
          <button
            type="button"
            className="plugin-browser-dialog__scan ghost instant-tooltip-host instant-tooltip-host--inline-flex"
            onClick={() => onScan(customPaths)}
            disabled={scanning}
            data-testid="plugin-browser-dialog-scan"
          >
            {scanButtonLabel}
          <InstantTooltipPopover content="Scan the listed plugin paths" /></button>
        </div>

        <section className="plugin-browser-dialog__paths" aria-label="Plugin scan paths">
          <div className="plugin-browser-dialog__paths-header">
            <div>
              <h3>Scan paths</h3>
              <p>
                {usingDefaultPaths
                  ? 'Using standard macOS VST3/AU folders until you add custom paths.'
                  : 'Scanning only the paths listed below.'}
              </p>
            </div>
            <div className="plugin-browser-dialog__paths-actions">
              <button
                type="button"
                className="plugin-browser-dialog__path-action ghost"
                onClick={onPickScanPaths}
                disabled={!onPickScanPaths}
                data-testid="plugin-browser-dialog-pick-path"
              >
                Choose folder…
              </button>
              <button
                type="button"
                className="plugin-browser-dialog__path-action ghost"
                onClick={() => onSetScanPaths?.([])}
                disabled={customPaths.length === 0 || !onSetScanPaths}
                data-testid="plugin-browser-dialog-reset-paths"
              >
                Reset to standard
              </button>
            </div>
          </div>

          <div className="plugin-browser-dialog__manual-path-row">
            <input
              type="text"
              className="plugin-browser-dialog__manual-path"
              placeholder="Paste or type a plugin folder path…"
              value={manualPath}
              onChange={(event) => setManualPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleAddManualPath();
                }
              }}
              data-testid="plugin-browser-dialog-manual-path"
            />
            <button
              type="button"
              className="plugin-browser-dialog__path-action ghost"
              onClick={handleAddManualPath}
              disabled={!manualPath.trim() || !onSetScanPaths}
              data-testid="plugin-browser-dialog-add-path"
            >
              Add path
            </button>
          </div>

          <div className="plugin-browser-dialog__path-list" data-testid="plugin-browser-dialog-path-list">
            {customPaths.length > 0 ? (
              customPaths.map((path) => (
                <span className="plugin-browser-dialog__path-chip" key={path}>
                  <span className="instant-tooltip-host instant-tooltip-host--inline-flex">{formatPathLabel(path)}<InstantTooltipPopover content={path} /></span>
                  <button
                    type="button"
                    aria-label={`Remove ${path} from plugin scan paths`}
                    onClick={() => handleRemovePath(path)}
                    disabled={!onSetScanPaths}
                  >
                    ×
                  </button>
                </span>
              ))
            ) : effectivePaths.length > 0 ? (
              effectivePaths.map((path) => (
                <span className="plugin-browser-dialog__path-chip plugin-browser-dialog__path-chip--default" key={path}>
                  <span className="instant-tooltip-host instant-tooltip-host--inline-flex">{formatPathLabel(path)}<InstantTooltipPopover content={path} /></span>
                </span>
              ))
            ) : (
              <span className="plugin-browser-dialog__path-note">Default plugin paths will be used.</span>
            )}
          </div>
        </section>

        {libraryIsEmpty ? (
          <div
            className="plugin-browser-dialog__empty"
            data-testid="plugin-browser-dialog-empty"
          >
            {scanning ? (
              <>
                <p data-testid="plugin-browser-dialog-empty-status">
                  {usingDefaultPaths
                    ? 'Scanning standard VST3/AU folders…'
                    : 'Scanning the selected plugin paths…'}
                </p>
                {scanProgress && scanProgress.total > 0 ? (
                  <p
                    className="plugin-browser-dialog__progress"
                    data-testid="plugin-browser-dialog-empty-progress"
                  >
                    {(() => {
                      const m = scanProgress.current.match(/[^/\\]+$/);
                      const base = m ? m[0] : scanProgress.current;
                      const name = base.replace(/\.(vst3|component|clap)$/i, '');
                      return `Scanned ${scanProgress.done} of ${scanProgress.total}: ${name}`;
                    })()}
                  </p>
                ) : null}
              </>
            ) : (
              <p>No plugins loaded yet. Set paths if needed, then click the scan button when you want to search.</p>
            )}
          </div>
        ) : (
          <div
            ref={listRef}
            className="plugin-browser-dialog__list"
            role="listbox"
            aria-label="Available plugins"
            data-testid="plugin-browser-dialog-list"
          >
            {filteredPlugins.length === 0 ? (
              <p className="plugin-browser-dialog__no-results" data-testid="plugin-browser-dialog-no-results">
                No plugins match “{query}”.
              </p>
            ) : (
              filteredPlugins.map((plugin, index) => {
                const highlighted = index === highlightedIndex;
                return (
                  <button
                    key={plugin.id}
                    type="button"
                    role="option"
                    aria-selected={highlighted}
                    className={`${`plugin-browser-dialog__row${
                      highlighted ? ' plugin-browser-dialog__row--highlighted' : ''
                    }`} instant-tooltip-host instant-tooltip-host--inline-flex`}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => onPick(plugin.id)}
                    data-testid="plugin-browser-dialog-row"
                    data-plugin-id={plugin.id}
                    disabled={!plugin.isSupported}
                  >
                    <span className="plugin-browser-dialog__row-name">{plugin.name}</span>
                    <span className="plugin-browser-dialog__row-vendor">{plugin.vendor || '—'}</span>
                    <span
                      className="plugin-browser-dialog__row-format"
                      data-format={plugin.format}
                    >
                      {formatTypeBadge(plugin.format)}
                    </span>
                    <span className="plugin-browser-dialog__row-add" aria-hidden="true">
                      Add
                    </span>
                  <InstantTooltipPopover content={plugin.isSupported
                        ? `${plugin.name} — ${plugin.vendor}`
                        : plugin.failureReason ?? 'Unsupported plugin'} /></button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
