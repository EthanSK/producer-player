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
 * v3.42 Phase 3 — per-slot "Edit" button opens the plugin's native editor
 * window (owned by the JUCE sidecar). Repeated open requests bring the
 * window to the front. When the user closes the window via the OS close
 * button the sidecar pushes an `editor_closed` event back through IPC, and
 * App.tsx clears the id from `openEditorInstanceIds` so the button visually
 * toggles off. The button is disabled for slots that have no loaded sidecar
 * instance yet (e.g. during an in-flight reconcile, or when the sidecar
 * binary isn't built).
 */

import { useMemo, useState, type CSSProperties } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type {
  PluginChainItem,
  PluginInfo,
  PluginPresetEntry,
  PluginScanSettings,
  PluginScanProgress,
  ScannedPluginLibrary,
  TrackPluginChain,
} from '@producer-player/contracts';

import { PluginBrowserDialog } from './PluginBrowserDialog';
import { clampPluginChainOutputGainLinear } from '../pluginAudioPipeline';

export interface PluginChainStripProps {
  chain: TrackPluginChain;
  library: ScannedPluginLibrary | null;
  layout: 'fullscreen' | 'compact';
  scanning?: boolean;
  /**
   * v3.171 — latest `scan_progress` event surfaced from the sidecar so the
   * plugin browser dialog can render live progress in its empty placeholder.
   */
  scanProgress?: PluginScanProgress | null;
  scanSettings?: PluginScanSettings;
  onAdd: (pluginId: string) => void;
  onRemove: (instanceId: string) => void;
  onToggle: (instanceId: string) => void;
  onReorder: (orderedInstanceIds: string[]) => void;
  onOpenEditor: (instanceId: string) => void;
  onOutputGainChange?: (outputGainLinear: number) => void;
  onSavePreset?: (instanceId: string, name: string) => void;
  onRecallPreset?: (instanceId: string, name: string) => void;
  onDeletePreset?: (pluginId: string, name: string) => void;
  onScan: (paths?: string[]) => void;
  onSetScanPaths?: (paths: string[]) => void;
  onPickScanPaths?: () => void;
  presetsByPluginId?: Record<string, PluginPresetEntry[]>;
  hideHeader?: boolean;
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
  instanceLatencies?: Record<string, number>;
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

interface SortablePluginPillProps {
  item: PluginChainItem;
  index: number;
  orderedItemsLength: number;
  layout: 'fullscreen' | 'compact';
  info: PluginInfo | null;
  editorOpen: boolean;
  editDisabled: boolean;
  latencySamples: number | undefined;
  presetMenuOpen: boolean;
  savedPresets: PluginPresetEntry[];
  onMove: (instanceId: string, direction: -1 | 1) => void;
  onOpenEditor: (instanceId: string) => void;
  onRemove: (instanceId: string) => void;
  onToggle: (instanceId: string) => void;
  onSavePreset?: (instanceId: string, name: string) => void;
  onRecallPreset?: (instanceId: string, name: string) => void;
  onDeletePreset?: (pluginId: string, name: string) => void;
  onPresetMenuChange: (instanceId: string | null) => void;
}

function PluginPillDragGhost({
  item,
  info,
  latencySamples,
}: {
  item: PluginChainItem;
  info: PluginInfo | null;
  latencySamples: number | undefined;
}): JSX.Element {
  const displayName = info?.name ?? 'Unknown plugin';
  const latencyText =
    typeof latencySamples === 'number' && Number.isFinite(latencySamples)
      ? `${latencySamples} samples`
      : null;
  const latencyTitle = 'Plugin-reported latency in samples. 0 means this plugin reported no added delay.';

  return (
    <div
      className={`plugin-pill plugin-pill--drag-overlay${item.enabled ? '' : ' plugin-pill--disabled'}`}
      aria-hidden="true"
    >
      <span className="plugin-pill__grab">
        <span aria-hidden="true">⋮⋮</span>
      </span>
      <span className="plugin-pill__name">
        <span className="plugin-pill__label">{displayName}</span>
        {latencyText ? (
          <span className="plugin-pill__latency" title={latencyTitle}>
            {latencyText}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function SortablePluginPill({
  item,
  index,
  orderedItemsLength,
  layout,
  info,
  editorOpen,
  editDisabled,
  latencySamples,
  presetMenuOpen,
  savedPresets,
  onMove,
  onOpenEditor,
  onRemove,
  onToggle,
  onSavePreset,
  onRecallPreset,
  onDeletePreset,
  onPresetMenuChange,
}: SortablePluginPillProps): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.instanceId });
  const displayName = info?.name ?? 'Unknown plugin';
  const vendor = info?.vendor ?? '';
  const latencyText =
    typeof latencySamples === 'number' && Number.isFinite(latencySamples)
      ? `${latencySamples} samples`
      : null;
  const latencyTitle = 'Plugin-reported latency in samples. 0 means this plugin reported no added delay.';
  const loadingText = editDisabled && item.enabled ? 'loading' : null;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="listitem"
      className={`plugin-pill${item.enabled ? '' : ' plugin-pill--disabled'}${
        isDragging ? ' plugin-pill--dragging' : ''
      }`}
      data-testid="plugin-pill"
      data-instance-id={item.instanceId}
      data-enabled={item.enabled ? 'true' : 'false'}
      title={vendor ? `${displayName} — ${vendor}` : displayName}
    >
      <button
        type="button"
        className="plugin-pill__grab"
        aria-label={`Drag ${displayName} to reorder`}
        {...attributes}
        {...listeners}
        tabIndex={-1}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>

      <button
        type="button"
        className="plugin-pill__name"
        onClick={() => onOpenEditor(item.instanceId)}
        data-testid="plugin-pill-name"
        disabled={editDisabled}
        aria-label={`Open editor for ${displayName}`}
        title={editDisabled ? 'Plugin audio is loading before the native editor can open.' : undefined}
      >
        <span className="plugin-pill__label">{displayName}</span>
        {latencyText ? (
          <span className="plugin-pill__latency" title={latencyTitle}>
            {latencyText}
          </span>
        ) : null}
        {loadingText ? (
          <span className="plugin-pill__latency" title="Plugin audio is loading.">
            {loadingText}
          </span>
        ) : null}
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

      {orderedItemsLength > 1 ? (
        <span className="plugin-pill__reorder" aria-hidden={index === 0 && orderedItemsLength === 1}>
          <button
            type="button"
            className="plugin-pill__arrow"
            onClick={() => onMove(item.instanceId, -1)}
            disabled={index === 0}
            aria-label={`Move ${displayName} earlier in chain`}
            data-testid="plugin-pill-move-up"
          >
            {layout === 'compact' ? '↑' : '←'}
          </button>
          <button
            type="button"
            className="plugin-pill__arrow"
            onClick={() => onMove(item.instanceId, 1)}
            disabled={index === orderedItemsLength - 1}
            aria-label={`Move ${displayName} later in chain`}
            data-testid="plugin-pill-move-down"
          >
            {layout === 'compact' ? '↓' : '→'}
          </button>
        </span>
      ) : null}

      <button
        type="button"
        className={`plugin-pill__edit${editorOpen ? ' plugin-pill__edit--open' : ''}`}
        onClick={() => onOpenEditor(item.instanceId)}
        disabled={editDisabled}
        aria-pressed={editorOpen}
        aria-label={
          editorOpen
            ? `Bring plugin editor to front for ${displayName}`
            : `Open plugin editor for ${displayName}`
        }
        title={editDisabled ? 'Plugin is loading…' : editorOpen ? 'Bring editor to front' : 'Edit plugin'}
        data-testid="plugin-pill-edit"
        data-open={editorOpen ? 'true' : 'false'}
      >
        <span aria-hidden="true">✎</span>
      </button>

      <div className="plugin-pill__preset-wrap">
        <button
          type="button"
          className="plugin-pill__preset"
          onClick={() =>
            onPresetMenuChange(presetMenuOpen ? null : item.instanceId)
          }
          aria-haspopup="menu"
          aria-expanded={presetMenuOpen}
          aria-label={`Preset menu for ${displayName}`}
          title="Plugin presets"
          data-testid="plugin-pill-preset-menu"
        >
          <span aria-hidden="true">⋯</span>
        </button>
        {presetMenuOpen ? (
          <div
            className="plugin-preset-menu"
            role="menu"
            aria-label={`Presets for ${displayName}`}
          >
            <button
              type="button"
              className="plugin-preset-menu__item"
              role="menuitem"
              onClick={() => {
                const name = window.prompt('Save preset as:');
                if (!name) return;
                onSavePreset?.(item.instanceId, name);
                onPresetMenuChange(null);
              }}
              disabled={!onSavePreset}
            >
              Save preset…
            </button>

            <div className="plugin-preset-menu__section" aria-label="Load preset">
              <span className="plugin-preset-menu__heading">Load preset</span>
              {savedPresets.length > 0 ? (
                savedPresets.map((preset) => (
                  <button
                    type="button"
                    className="plugin-preset-menu__item"
                    role="menuitem"
                    key={`load-${preset.name}`}
                    onClick={() => {
                      onRecallPreset?.(item.instanceId, preset.name);
                      onPresetMenuChange(null);
                    }}
                    disabled={!onRecallPreset}
                  >
                    {preset.name}
                  </button>
                ))
              ) : (
                <span className="plugin-preset-menu__empty">No saved presets</span>
              )}
            </div>

            {onDeletePreset ? (
              <div className="plugin-preset-menu__section" aria-label="Delete preset">
                <span className="plugin-preset-menu__heading">Delete preset</span>
                {savedPresets.length > 0 ? (
                  savedPresets.map((preset) => (
                    <button
                      type="button"
                      className="plugin-preset-menu__item plugin-preset-menu__item--danger"
                      role="menuitem"
                      key={`delete-${preset.name}`}
                      onClick={() => {
                        onDeletePreset(item.pluginId, preset.name);
                        onPresetMenuChange(null);
                      }}
                    >
                      {preset.name}
                    </button>
                  ))
                ) : (
                  <span className="plugin-preset-menu__empty">No saved presets</span>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

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
}

export function PluginChainStrip(props: PluginChainStripProps): JSX.Element {
  const {
    chain,
    library,
    layout,
    scanning = false,
    scanProgress = null,
    scanSettings,
    onAdd,
    onRemove,
    onToggle,
    onReorder,
    onOpenEditor,
    onOutputGainChange,
    onSavePreset,
    onRecallPreset,
    onDeletePreset,
    onScan,
    onSetScanPaths,
    onPickScanPaths,
    presetsByPluginId,
    hideHeader = false,
    openEditorInstanceIds,
    loadedInstanceIds,
    instanceLatencies,
  } = props;

  const [browserOpen, setBrowserOpen] = useState(false);
  const [presetMenuInstanceId, setPresetMenuInstanceId] = useState<string | null>(null);
  const [activeDragInstanceId, setActiveDragInstanceId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

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

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragInstanceId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragInstanceId(null);

    if (!over || active.id === over.id) {
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);
    const oldIndex = orderedItems.findIndex((item) => item.instanceId === activeId);
    const newIndex = orderedItems.findIndex((item) => item.instanceId === overId);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    onReorder(arrayMove(orderedItems, oldIndex, newIndex).map((item) => item.instanceId));
  };

  const isEmpty = orderedItems.length === 0;
  const outputGainLinear = clampPluginChainOutputGainLinear(chain.outputGainLinear);
  const outputGainPercent = Math.round(outputGainLinear * 100);
  const activeDragItem =
    activeDragInstanceId
      ? orderedItems.find((item) => item.instanceId === activeDragInstanceId) ?? null
      : null;
  const activeDragInfo = activeDragItem ? findPluginInfo(library, activeDragItem.pluginId) : null;

  return (
    <section
      className={`plugin-chain-strip plugin-chain-strip--${layout}${
        hideHeader ? ' plugin-chain-strip--embedded' : ''
      }`}
      data-testid={
        layout === 'fullscreen'
          ? 'plugin-chain-strip-fullscreen'
          : 'plugin-chain-strip-compact'
      }
      aria-label="Plugin insert chain"
    >
      {!hideHeader ? (
        <header className="plugin-chain-strip__header">
          <h3 className="plugin-chain-strip__title">Plugins</h3>
          <span className="plugin-chain-strip__muted">
            {isEmpty ? 'No plugins' : `${orderedItems.length} in chain`}
          </span>
        </header>
      ) : null}

      <div
        className="plugin-chain-strip__gain"
        data-testid="plugin-chain-output-gain"
      >
        <label
          className="plugin-chain-strip__gain-label"
          htmlFor={`plugin-chain-output-gain-${layout}`}
        >
          Plugin Vol
        </label>
        <input
          id={`plugin-chain-output-gain-${layout}`}
          className="plugin-chain-strip__gain-slider"
          data-testid="plugin-chain-output-gain-slider"
          type="range"
          min={0}
          max={200}
          step={1}
          value={outputGainPercent}
          disabled={isEmpty || !onOutputGainChange}
          onChange={(event) => {
            onOutputGainChange?.(
              clampPluginChainOutputGainLinear(Number(event.currentTarget.value) / 100),
            );
          }}
          aria-label="Plugin chain output volume"
          title="Output volume after this track's plugin chain. 100% is unity."
        />
        <span
          className="plugin-chain-strip__gain-value"
          data-testid="plugin-chain-output-gain-value"
          aria-live="polite"
        >
          {outputGainPercent}%
        </span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDragInstanceId(null)}
      >
        <SortableContext
          items={orderedItems.map((item) => item.instanceId)}
          strategy={layout === 'compact' ? verticalListSortingStrategy : horizontalListSortingStrategy}
        >
          <div
            className="plugin-chain-strip__rail"
            role="list"
            aria-label="Plugin chain"
            data-testid="plugin-chain-strip-rail"
          >
            {orderedItems.map((item, index) => {
              const info = findPluginInfo(library, item.pluginId);
              const editorOpen = openEditorInstanceIds?.has(item.instanceId) ?? false;
              // When `loadedInstanceIds` is undefined the parent hasn't opted
              // in to sidecar-state tracking, so we don't disable the button
              // (legacy behavior: still call onOpenEditor and let the IPC
              // layer surface errors). When provided, we honor it strictly.
              const editDisabled = loadedInstanceIds ? !loadedInstanceIds.has(item.instanceId) : false;
              return (
                <SortablePluginPill
                  key={item.instanceId}
                  item={item}
                  index={index}
                  orderedItemsLength={orderedItems.length}
                  layout={layout}
                  info={info}
                  editorOpen={editorOpen}
                  editDisabled={editDisabled}
                  latencySamples={instanceLatencies?.[item.instanceId]}
                  presetMenuOpen={presetMenuInstanceId === item.instanceId}
                  savedPresets={presetsByPluginId?.[item.pluginId] ?? []}
                  onMove={handleMove}
                  onOpenEditor={onOpenEditor}
                  onRemove={onRemove}
                  onToggle={onToggle}
                  onSavePreset={onSavePreset}
                  onRecallPreset={onRecallPreset}
                  onDeletePreset={onDeletePreset}
                  onPresetMenuChange={setPresetMenuInstanceId}
                />
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
        </SortableContext>
        <DragOverlay>
          {activeDragItem ? (
            <PluginPillDragGhost
              item={activeDragItem}
              info={activeDragInfo}
              latencySamples={instanceLatencies?.[activeDragItem.instanceId]}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {browserOpen ? (
        <PluginBrowserDialog
          library={library}
          scanning={scanning}
          scanProgress={scanProgress}
          scanSettings={scanSettings}
          onClose={() => setBrowserOpen(false)}
          onPick={(pluginId) => {
            onAdd(pluginId);
            setBrowserOpen(false);
          }}
          onScan={onScan}
          onSetScanPaths={onSetScanPaths}
          onPickScanPaths={onPickScanPaths}
        />
      ) : null}
    </section>
  );
}
