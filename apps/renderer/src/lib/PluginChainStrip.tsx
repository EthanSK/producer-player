/**
 * PluginChainStrip (v3.40 Phase 1b UI; v3.42 Phase 3 edit button)
 * ---------------------------------------------------------------------------
 * Renders the ordered insert chain for the currently selected song.
 *
 * Purely presentational: chain mutations are forwarded to the parent via
 * callbacks, which fan out to IPC (`window.producerPlayer.addPluginToChain`,
 * etc.) in App.tsx.
 *
 * Layout modes:
 *   - 'fullscreen' → horizontal pill row. Mounts as a row inside the
 *                    Mastering overlay grid, above Platform Normalization.
 *   - 'compact'    → vertical stack. Mounts at the bottom of the small
 *                    (docked) mastering preview.
 *
 * Reorder uses arrow buttons for the MVP (drag-drop is Phase 1c polish).
 *
 * v3.42 Phase 3 — per-slot "Edit" button opens the plugin's native editor
 * window (owned by the JUCE sidecar). Clicking Edit toggles the window open
 * or brings it to the front. When the user closes the window via the OS
 * close button the sidecar pushes an `editor_closed` event back through
 * IPC, and App.tsx clears the id from `openEditorInstanceIds` so the
 * button visually toggles off. The button is disabled for slots that have
 * no loaded sidecar instance yet (e.g. during an in-flight reconcile, or
 * when the sidecar binary isn't built).
 */

import { useMemo, useState } from 'react';
import type {
  PluginChainItem,
  PluginInfo,
  ScannedPluginLibrary,
  TrackPluginChain,
} from '@producer-player/contracts';

import { PluginBrowserDialog } from './PluginBrowserDialog';

export interface PluginChainStripProps {
  chain: TrackPluginChain;
  library: ScannedPluginLibrary | null;
  layout: 'fullscreen' | 'compact';
  scanning?: boolean;
  onAdd: (pluginId: string) => void;
  onRemove: (instanceId: string) => void;
  onToggle: (instanceId: string) => void;
  onReorder: (orderedInstanceIds: string[]) => void;
  onOpenEditor: (instanceId: string) => void;
  onScan: () => void;
  /**
   * v3.42 Phase 3 — set of instanceIds whose native editor window is
   * currently open. Used to visually highlight the Edit button.
   */
  openEditorInstanceIds?: ReadonlySet<string>;
  /**
   * v3.42 Phase 3 — set of instanceIds the sidecar currently has loaded.
   * When an item's id is NOT in this set, the Edit button is disabled
   * (nothing to edit until the sidecar instantiates the plugin).
   */
  loadedInstanceIds?: ReadonlySet<string>;
}

function findPluginInfo(
  library: ScannedPluginLibrary | null,
  pluginId: string,
): PluginInfo | null {
  if (!library) return null;
  return library.plugins.find((plugin) => plugin.id === pluginId) ?? null;
}

function reorderInstanceIds(items: PluginChainItem[], fromIndex: number, toIndex: number): string[] {
  const copy = [...items];
  const [moved] = copy.splice(fromIndex, 1);
  if (!moved) return items.map((item) => item.instanceId);
  copy.splice(toIndex, 0, moved);
  return copy.map((item) => item.instanceId);
}

export function PluginChainStrip(props: PluginChainStripProps): JSX.Element {
  const {
    chain,
    library,
    layout,
    scanning = false,
    onAdd,
    onRemove,
    onToggle,
    onReorder,
    onOpenEditor,
    onScan,
    openEditorInstanceIds,
    loadedInstanceIds,
  } = props;

  const [browserOpen, setBrowserOpen] = useState(false);

  // Chain items are stored as an unordered array in state, but must render in
  // `order` — the IPC layer guarantees `order` is a 0-based stable sequence.
  const orderedItems = useMemo(() => {
    return [...chain.items].sort((a, b) => a.order - b.order);
  }, [chain.items]);

  const handleMove = (instanceId: string, direction: -1 | 1) => {
    const index = orderedItems.findIndex((item) => item.instanceId === instanceId);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= orderedItems.length) return;
    onReorder(reorderInstanceIds(orderedItems, index, target));
  };

  const isEmpty = orderedItems.length === 0;

  return (
    <section
      className={`plugin-chain-strip plugin-chain-strip--${layout}`}
      data-testid={
        layout === 'fullscreen'
          ? 'plugin-chain-strip-fullscreen'
          : 'plugin-chain-strip-compact'
      }
      aria-label="Plugin insert chain"
    >
      <header className="plugin-chain-strip__header">
        <h3 className="plugin-chain-strip__title">Plugins</h3>
        <span className="plugin-chain-strip__muted">
          {isEmpty ? 'No plugins' : `${orderedItems.length} in chain`}
        </span>
      </header>

      <div
        className="plugin-chain-strip__rail"
        role="list"
        aria-label="Plugin chain"
        data-testid="plugin-chain-strip-rail"
      >
        {orderedItems.map((item, index) => {
          const info = findPluginInfo(library, item.pluginId);
          const displayName = info?.name ?? 'Unknown plugin';
          const vendor = info?.vendor ?? '';
          const editorOpen = openEditorInstanceIds?.has(item.instanceId) ?? false;
          // When `loadedInstanceIds` is undefined the parent hasn't opted
          // in to sidecar-state tracking, so we don't disable the button
          // (legacy behavior: still call onOpenEditor and let the IPC
          // layer surface errors). When provided, we honor it strictly.
          const editDisabled = loadedInstanceIds ? !loadedInstanceIds.has(item.instanceId) : false;
          return (
            <div
              key={item.instanceId}
              role="listitem"
              className={`plugin-pill${item.enabled ? '' : ' plugin-pill--disabled'}`}
              data-testid="plugin-pill"
              data-instance-id={item.instanceId}
              data-enabled={item.enabled ? 'true' : 'false'}
              title={vendor ? `${displayName} — ${vendor}` : displayName}
            >
              <button
                type="button"
                className="plugin-pill__grab"
                aria-label={`Drag ${displayName} to reorder`}
                tabIndex={-1}
              >
                <span aria-hidden="true">⋮⋮</span>
              </button>

              <button
                type="button"
                className="plugin-pill__name"
                onClick={() => onOpenEditor(item.instanceId)}
                data-testid="plugin-pill-name"
                aria-label={`Open editor for ${displayName}`}
              >
                <span className="plugin-pill__label">{displayName}</span>
                {!item.enabled ? (
                  <span
                    className="plugin-pill__bypass-badge"
                    aria-hidden="true"
                    title="Bypassed"
                  >
                    ⏻
                  </span>
                ) : null}
              </button>

              {/* Arrow reorder (MVP — drag-drop is Phase 1c) */}
              {orderedItems.length > 1 ? (
                <span className="plugin-pill__reorder" aria-hidden={index === 0 && orderedItems.length === 1}>
                  <button
                    type="button"
                    className="plugin-pill__arrow"
                    onClick={() => handleMove(item.instanceId, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${displayName} earlier in chain`}
                    data-testid="plugin-pill-move-up"
                  >
                    {layout === 'compact' ? '↑' : '←'}
                  </button>
                  <button
                    type="button"
                    className="plugin-pill__arrow"
                    onClick={() => handleMove(item.instanceId, 1)}
                    disabled={index === orderedItems.length - 1}
                    aria-label={`Move ${displayName} later in chain`}
                    data-testid="plugin-pill-move-down"
                  >
                    {layout === 'compact' ? '↓' : '→'}
                  </button>
                </span>
              ) : null}

              {/* v3.42 Phase 3 — dedicated Edit button. Opens the plugin's
                   native editor window (owned by the sidecar). */}
              <button
                type="button"
                className={`plugin-pill__edit${editorOpen ? ' plugin-pill__edit--open' : ''}`}
                onClick={() => onOpenEditor(item.instanceId)}
                disabled={editDisabled}
                aria-pressed={editorOpen}
                aria-label={
                  editorOpen
                    ? `Plugin editor open for ${displayName}`
                    : `Open plugin editor for ${displayName}`
                }
                title={editDisabled ? 'Plugin is loading…' : 'Edit plugin'}
                data-testid="plugin-pill-edit"
                data-open={editorOpen ? 'true' : 'false'}
              >
                <span aria-hidden="true">✎</span>
              </button>

              <button
                type="button"
                className="plugin-pill__toggle"
                role="switch"
                aria-checked={item.enabled}
                aria-label={`${item.enabled ? 'Disable' : 'Enable'} ${displayName}`}
                onClick={() => onToggle(item.instanceId)}
                data-testid="plugin-pill-toggle"
              >
                <span className="plugin-pill__toggle-knob" aria-hidden="true" />
              </button>

              <button
                type="button"
                className="plugin-pill__close"
                onClick={() => onRemove(item.instanceId)}
                aria-label={`Remove ${displayName} from chain`}
                data-testid="plugin-pill-remove"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          );
        })}

        {isEmpty ? (
          <p
            className="plugin-chain-strip__empty"
            data-testid="plugin-chain-strip-empty"
          >
            No plugins. Click + to add.
          </p>
        ) : null}

        <button
          type="button"
          className="plugin-chain-strip__add"
          onClick={() => setBrowserOpen(true)}
          aria-label="Add plugin to chain"
          data-testid="plugin-chain-strip-add"
        >
          <span aria-hidden="true">+</span>
          <span className="plugin-chain-strip__add-label">Add</span>
        </button>
      </div>

      {browserOpen ? (
        <PluginBrowserDialog
          library={library}
          scanning={scanning}
          onClose={() => setBrowserOpen(false)}
          onPick={(pluginId) => {
            onAdd(pluginId);
            setBrowserOpen(false);
          }}
          onScan={onScan}
        />
      ) : null}
    </section>
  );
}
