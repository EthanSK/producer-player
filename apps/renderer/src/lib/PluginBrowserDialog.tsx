/**
 * PluginBrowserDialog (v3.40, Phase 1b — UI only)
 * ---------------------------------------------------------------------------
 * Modal overlay that lets the user pick a plugin to append to the chain.
 *
 * - Search filters by plugin name + vendor (case-insensitive substring).
 * - Empty / stale library surfaces a "Scan installed plugins" call-to-action.
 * - Keyboard: Esc → close, `/` → focus search, Enter → add highlighted.
 * - Styling uses the existing dark-theme tokens only (see styles.css).
 *
 * The dialog is unaware of IPC — parents pass `onPick(pluginId)` and
 * `onScan()`; actual calls happen in App.tsx.
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
  ScannedPluginLibrary,
} from '@producer-player/contracts';

export interface PluginBrowserDialogProps {
  library: ScannedPluginLibrary | null;
  scanning: boolean;
  onClose: () => void;
  onPick: (pluginId: string) => void;
  onScan: () => void;
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

export function PluginBrowserDialog(props: PluginBrowserDialogProps): JSX.Element {
  const { library, scanning, onClose, onPick, onScan } = props;
  const [query, setQuery] = useState('');
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

  // v3.45 — lazy first-time scan.
  //
  // Startup no longer kicks off a background plugin scan (that triggered
  // macOS network-volume permission prompts at every launch — see
  // App.tsx `pluginLibraryBootstrappedRef` comment). Instead, the FIRST
  // time the user opens this dialog and finds the cached library empty,
  // we auto-start a scan here. Mounting the dialog == user clicked the
  // "+ Add plugin" button, so the permission prompt (if any) is now
  // contextual to a user action rather than firing out of nowhere.
  const autoScanAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoScanAttemptedRef.current) return;
    if (scanning) return;
    const isEmpty = !library || library.plugins.length === 0;
    if (!isEmpty) return;
    autoScanAttemptedRef.current = true;
    onScan();
  }, [library, scanning, onScan]);

  // Autofocus search on mount.
  useEffect(() => {
    const input = searchInputRef.current;
    if (input) input.focus();
  }, []);

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
        const candidate = filteredPlugins[highlightedIndex];
        if (candidate?.isSupported) {
          event.preventDefault();
          onPick(candidate.id);
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
            className="plugin-browser-dialog__scan ghost"
            onClick={onScan}
            disabled={scanning}
            data-testid="plugin-browser-dialog-scan"
            title="Re-scan installed VST3/AU plugins"
          >
            {scanning ? 'Scanning…' : 'Scan installed plugins'}
          </button>
        </div>

        {libraryIsEmpty ? (
          <div
            className="plugin-browser-dialog__empty"
            data-testid="plugin-browser-dialog-empty"
          >
            <p>
              {scanning
                ? 'Scanning installed VST3/AU plugins…'
                : 'No installed plugins found. Click “Scan installed plugins” to scan your Mac’s standard VST3/AU folders.'}
            </p>
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
                    className={`plugin-browser-dialog__row${
                      highlighted ? ' plugin-browser-dialog__row--highlighted' : ''
                    }`}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => onPick(plugin.id)}
                    data-testid="plugin-browser-dialog-row"
                    data-plugin-id={plugin.id}
                    disabled={!plugin.isSupported}
                    title={
                      plugin.isSupported
                        ? `${plugin.name} — ${plugin.vendor}`
                        : plugin.failureReason ?? 'Unsupported plugin'
                    }
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
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
