import type {
  PluginFormat,
  PluginInfo,
  ScannedPluginLibrary,
  TrackPluginChain,
} from '@producer-player/contracts';

export type TrackPluginDisplayStatus = 'enabled' | 'bypassed' | 'unavailable';

export interface TrackPluginDisplayItem {
  instanceId: string;
  name: string;
  formatLabel: string;
  status: TrackPluginDisplayStatus;
  statusLabel: string;
}

export interface TrackPluginDisplayModel {
  totalCount: number;
  enabledCount: number;
  bypassedCount: number;
  unavailableCount: number;
  items: TrackPluginDisplayItem[];
  summary: string;
  hasAttention: boolean;
}

const FORMAT_LABELS: Record<PluginFormat, string> = {
  au: 'AU',
  vst3: 'V3',
  clap: 'CL',
};

/**
 * Keep the list useful even when the cached scanner library is unavailable.
 * A chain slot only persists the stable plugin id, so the final id segment is
 * the most honest fallback label we can show without inventing a plugin name.
 */
function getFallbackPluginName(pluginId: string): string {
  const tail = pluginId.split(/[\\/:]/).filter(Boolean).at(-1)?.trim();
  return tail || 'Saved plugin';
}

function getPluginStatus(
  enabled: boolean,
  plugin: PluginInfo | undefined,
  libraryKnown: boolean,
): { status: TrackPluginDisplayStatus; label: string } {
  // A completed scan that cannot resolve a saved id (or explicitly marks the
  // entry unsupported) is an availability warning. This wins over bypass so a
  // missing insert can never hide behind a merely-greyed-out state.
  if (libraryKnown && (!plugin || !plugin.isSupported)) {
    return {
      status: 'unavailable',
      label: enabled ? 'Unavailable' : 'Unavailable and bypassed',
    };
  }

  // "Enabled" describes saved configuration only. The indicator deliberately
  // avoids "active" / "processing", which would over-promise before native
  // loading and audio-route reconciliation have completed.
  return enabled
    ? { status: 'enabled', label: 'Enabled' }
    : { status: 'bypassed', label: 'Bypassed' };
}

/** Build one accessibility-friendly, exclusive status model for a saved chain. */
export function getTrackPluginDisplayModel(
  chain: TrackPluginChain | undefined,
  library: ScannedPluginLibrary | null,
): TrackPluginDisplayModel | null {
  if (!chain || chain.items.length === 0) return null;

  const pluginById = new Map((library?.plugins ?? []).map((plugin) => [plugin.id, plugin] as const));
  const libraryKnown = library !== null;
  const items = [...chain.items]
    .sort((a, b) => a.order - b.order)
    .map((item): TrackPluginDisplayItem => {
      const plugin = pluginById.get(item.pluginId);
      const status = getPluginStatus(item.enabled, plugin, libraryKnown);
      return {
        instanceId: item.instanceId,
        name: plugin?.name ?? getFallbackPluginName(item.pluginId),
        formatLabel: plugin ? FORMAT_LABELS[plugin.format] : 'FX',
        status: status.status,
        statusLabel: status.label,
      };
    });

  const enabledCount = items.filter((item) => item.status === 'enabled').length;
  const bypassedCount = items.filter((item) => item.status === 'bypassed').length;
  const unavailableCount = items.filter((item) => item.status === 'unavailable').length;
  const totalCount = items.length;
  const stateParts = [
    enabledCount > 0 ? `${enabledCount} enabled` : null,
    bypassedCount > 0 ? `${bypassedCount} bypassed` : null,
    unavailableCount > 0 ? `${unavailableCount} unavailable` : null,
  ].filter((part): part is string => part !== null);

  return {
    totalCount,
    enabledCount,
    bypassedCount,
    unavailableCount,
    items,
    summary: `${totalCount} ${totalCount === 1 ? 'plugin' : 'plugins'}: ${stateParts.join(', ')}`,
    // All-bypassed chains deserve the amber attention treatment too: there is
    // still saved processing on the track, but none is currently enabled.
    hasAttention: unavailableCount > 0 || enabledCount === 0,
  };
}

export interface TrackPluginIndicatorProps {
  chain: TrackPluginChain | undefined;
  library: ScannedPluginLibrary | null;
  compact?: boolean;
}

/**
 * Persistent non-colour-only warning shown anywhere a song can be selected.
 * The text count is the primary cue; tint, border, and per-slot state icons
 * reinforce it for quick scanning without carrying the meaning alone.
 */
export function TrackPluginIndicator({
  chain,
  library,
  compact = false,
}: TrackPluginIndicatorProps): JSX.Element | null {
  const model = getTrackPluginDisplayModel(chain, library);
  if (!model) return null;

  const maxVisibleItems = compact ? 3 : 4;
  const visibleItems = model.items.slice(0, maxVisibleItems);
  const hiddenCount = model.items.length - visibleItems.length;

  return (
    <span
      className={`track-plugin-indicator${compact ? ' track-plugin-indicator--compact' : ''}${
        model.hasAttention ? ' has-attention' : ''
      }`}
      data-testid={compact ? 'quick-switcher-plugin-indicator' : 'track-plugin-indicator'}
      data-plugin-count={model.totalCount}
      data-enabled-count={model.enabledCount}
      data-bypassed-count={model.bypassedCount}
      data-unavailable-count={model.unavailableCount}
      aria-label={model.summary}
      title={model.summary}
    >
      <span className="track-plugin-count-badge">
        <span className="track-plugin-count-badge-icon" aria-hidden="true">FX</span>
        <span>Plugins {model.totalCount}</span>
      </span>
      <span className="track-plugin-icons" aria-hidden="true">
        {visibleItems.map((item) => (
          <span
            key={item.instanceId}
            className={`track-plugin-icon is-${item.status}`}
            title={`${item.name} (${item.formatLabel}) — ${item.statusLabel}`}
          >
            <span className="track-plugin-icon-format">{item.formatLabel}</span>
            {!compact ? <span className="track-plugin-icon-name">{item.name}</span> : null}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span className="track-plugin-icon track-plugin-icon--overflow" title={`${hiddenCount} more plugins`}>
            +{hiddenCount}
          </span>
        ) : null}
      </span>
    </span>
  );
}
