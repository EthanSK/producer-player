# Plugin Hosting Plan — Producer Player

Status: **DRAFT / planning only** — not committed, not implemented.
Author: Claude (Opus 4.7), cross-referenced with Codex research.
Date: 2026-04-18.

---

## 1. Goals

- Per-track (= per-song) **insert chain** of audio plugins, DAW-style, applied to the active playback source (mix or reference).
- Support real commercial plugins: **VST3**, **AU** (macOS), **CLAP** — the formats a mastering engineer would expect.
- **Plugin scanner** similar to Ableton's plugin browser: scans standard OS plugin folders, caches results, de-duplicates by UID, surfaces errors per plugin.
- **Search dialog** for adding plugins to a track (fuzzy by name, vendor, category).
- **Enable/disable** toggle per plugin slot, per track (bypass).
- **Save/restore plugin state** per track — parameter blobs stored as part of the unified user state, keyed by song ID × slot index × plugin UID.
- **Reusable "plugin chain strip" container** rendered in two layout contexts:
  - Fullscreen mastering view — full-width, roomy, one row per insert.
  - Small mastering preview (bottom-left compact panel) — condensed, single-line or vertically stacked with minimal chrome.
- Per-plugin **editor window** that can be opened/closed on demand (they have native GUIs — see §6 for docking story).

## 2. Non-goals

- **MIDI plugin hosting** (instruments). Producer Player is a playback/mastering tool; only effect plugins are in scope.
- **Sidechaining / bus routing / send buses.** Insert chain only, mono source in → stereo out.
- **Parameter automation / lanes.** Plugins hold static state per track; no time-based parameter automation in v1.
- **Tempo sync / transport sync.** Producer Player has no timeline grid.
- **VST2.** End-of-life format, Steinberg SDK licensing dead.
- **Windows / Linux support in v1.** macOS-only for the first ship (matches current PP primary target). Cross-platform follows.
- **Sample-accurate plugin delay compensation.** Acceptable tradeoff v1: report/display reported latency, don't auto-compensate.
- **Mac App Store build** with plugin hosting. AU hosting inside the MAS sandbox requires the `com.apple.security.temporary-exception.audio-unit-host` entitlement which effectively disables sandboxing — see §7. MAS build will ship **without** plugin hosting (feature-flagged off); direct-distribution DMG build is the one with plugins.

## 3. Architecture decision

**Decision: Option 2 — native plugin host sidecar, Electron as UI.**

A standalone native helper process (C++ with JUCE) owns the audio engine AND the plugin graph AND the system audio output. Electron's renderer becomes pure UI + control surface. Audio buffers never cross the Electron IPC boundary.

### Rationale

- Producer Player's current WebAudio graph (`HTMLAudioElement → MediaElementSource → Analyser → Gain → destination`) is excellent for visualisation but **cannot host VST3/AU/CLAP** — none of the three formats have a WebAudio shim with meaningful commercial plugin support.
- The only credible path to real plugins is a native host. JUCE is industry-standard, has `AudioPluginFormatManager` / `AudioPluginInstance` built in, and handles VST3 + AU + CLAP + LV2 uniformly.
- Option 3 (hybrid — AudioWorklet bridge to native host over SharedArrayBuffer) was considered and rejected: adds round-trip IPC per audio buffer, doubles buffering, creates clock-drift and underrun bugs we don't need. WAM 2.0 and vst-js both attempt this; neither is production-grade.
- Option 1 (WebAudio-only, WASM effects) is a nice-to-have but doesn't satisfy "host VST/AU/CLAP like a DAW".
- Ownership split cleanly: **native process = audio-thread-safe concerns**, **Electron = UI, persistence, file browsing, library, IPC orchestration**.

### Bird's-eye view

```
┌──────────────────────────────────────────────────────────────────┐
│ Electron main process (Node)                                     │
│   - Launches / monitors pp-audio-host sidecar                    │
│   - Relays IPC between renderer ↔ sidecar                        │
│   - Exposes plugin chain API on existing IPC channel pattern     │
└──────────────────────────────────────────────────────────────────┘
           ▲            ▲
           │ stdio JSON │ (control)                 ┌────────────┐
           │ + unix     │                           │ Renderer   │
           │ socket for │◀────── existing preload ──│ (React)    │
           │ metering   │                                          │
┌──────────▼────────────▼──────────────────────────┐  PluginChain │
│ pp-audio-host (native C++, JUCE)                 │  components  │
│   - Plugin scan + cache                          │              │
│   - Audio file decode (libsndfile / JUCE)        │              │
│   - Insert chain per active track                │              │
│   - Native audio output (CoreAudio)              │              │
│   - Reports meters / levels back at ~30 Hz       │              │
│   - Owns plugin GUI windows (native, floating)   │              │
└──────────────────────────────────────────────────┘              │
                                                                  │
         ▲         stdio JSON control channel ────────────────────┘
```

## 4. Native helper spec (pp-audio-host)

### 4.1 Process model

- **One long-lived sidecar** spawned on app launch, killed on quit.
- Launched by Electron main via `child_process.spawn`, binary bundled in `apps/electron/dist/bin/pp-audio-host` (follows existing `ffmpeg` unpacked-asar pattern — see `package.json` `asarUnpack`).
- **One sidecar instance, not one per track.** Insert chains are per-track data inside the sidecar's state.
- **Crash recovery:** if sidecar dies, Electron main logs, notifies renderer (banner), auto-respawns. Renderer replays the current track's chain config on reconnect.

### 4.2 IPC protocol

Two channels:

**Control channel — stdin/stdout JSON-RPC lines** (newline-delimited). Low frequency, high latency tolerant.

```jsonc
// Electron → sidecar
{"id":42,"method":"scan","params":{"paths":["/Library/Audio/Plug-Ins/VST3", "~/Library/Audio/Plug-Ins/Components"]}}
{"id":43,"method":"load","params":{"trackId":"song-123","slot":0,"pluginUid":"xyz","state":"<base64>"}}
{"id":44,"method":"setParam","params":{"trackId":"song-123","slot":0,"paramId":17,"value":0.72}}
{"id":45,"method":"setBypass","params":{"trackId":"song-123","slot":0,"bypass":true}}
{"id":46,"method":"reorder","params":{"trackId":"song-123","order":[1,0,2]}}
{"id":47,"method":"getState","params":{"trackId":"song-123","slot":0}}
{"id":48,"method":"openEditor","params":{"trackId":"song-123","slot":0}}
{"id":49,"method":"play","params":{"filePath":"/tmp/track.flac","trackId":"song-123","positionSec":0}}

// Sidecar → Electron
{"id":42,"result":{"plugins":[{"uid":"xyz","name":"Pro-Q 3","vendor":"FabFilter","format":"VST3",...}]}}
{"event":"scanProgress","current":12,"total":128,"currentPlugin":"..."}
{"event":"pluginCrashed","trackId":"song-123","slot":0,"pluginUid":"xyz","error":"..."}
{"event":"stateChanged","trackId":"song-123","slot":0,"state":"<base64>"}
```

**Metering channel — Unix domain socket**, binary frames, ~30 Hz.

```
[header: 8 bytes][float32 peakL][float32 peakR][float32 rmsL][float32 rmsR]...
```

This stays out of the JSON channel because it's high-frequency and we don't want GC pressure on the renderer from JSON parsing 30×/sec.

### 4.3 Audio buffer sizes + format

- Default buffer: **512 frames @ 44.1 kHz / 48 kHz** (configurable later).
- Format: **stereo float32 interleaved** end-to-end.
- Sample rate follows the source file; plugins that need a fixed rate are resampled at chain entry.
- Latency reporting: plugin-reported latency samples surfaced per slot in UI, no auto-PDC in v1.

### 4.4 Thread model

- **Audio thread** (CoreAudio callback) — runs plugin graph. Real-time-safe, no allocation, no logging, no file I/O.
- **Control thread** (main) — handles JSON-RPC, plugin scan, file decode scheduling, parameter-change queueing.
- **Scan thread pool** — plugin scanner runs in a worker pool (scanning buggy plugins must never stall the audio thread or the control channel).
- Parameter changes are pushed into a lock-free SPSC ring buffer consumed by the audio thread at the top of each callback.

### 4.5 Lifecycle

```
app launch → spawn sidecar → handshake → idle
  user picks song → Electron sends "play" → sidecar opens file, sets up chain, streams to CoreAudio
  user adds plugin → Electron sends "load" with pluginUid → sidecar instantiates, splices into chain, sends state event
  user drags parameter → Electron sends "setParam" (debounced 60Hz) → sidecar queues change
  user closes app → Electron sends "shutdown" → sidecar drains, exits
  sidecar crashes → Electron main auto-respawns → renderer replays current state on reconnect event
```

## 5. Plugin-chain data model

Lives in the existing unified state file (`producer-player-user-state.json`, `ProducerPlayerUserState` in `packages/contracts/src/index.ts`). Added under a new `pluginChainsBySongId` map per AGENTS.md rule §"Critical: User Data Storage Rule".

```ts
// packages/contracts/src/index.ts additions
export interface PluginChainSlot {
  slotId: string;              // stable UUID, survives reorders
  pluginUid: string;           // cross-format stable identifier (format + UID)
  pluginName: string;          // cached display name, for offline UI
  format: 'VST3' | 'AU' | 'CLAP';
  enabled: boolean;            // bypass flag
  stateBase64: string;         // opaque plugin state blob (preset data)
  reportedLatencySamples: number | null;  // last known latency
  lastSavedAt: number;
}

export interface PluginChain {
  songId: string;
  slots: PluginChainSlot[];    // ordered
}

// Added to ProducerPlayerUserState:
// pluginChainsBySongId: Record<string, PluginChain>;
```

- Per-song scope (consistent with existing per-song EQ, ratings, checklists).
- Ordered array; reorder = rewrite array.
- Plugin state is opaque base64 — we don't try to parse it, plugins serialize themselves.
- Scanner cache (list of installed plugins with metadata) lives in a **separate** file, `producer-player-plugin-scan.json`, not user state — it's a cache of the host system, not user data.

## 6. UI components

### 6.1 Reusable `PluginChainStrip` container

A single React component with two layout variants driven by a `variant` prop:

```tsx
<PluginChainStrip
  songId={songId}
  variant={isFullscreenMastering ? 'expanded' : 'compact'}
  onPluginGuiOpen={...}
/>
```

- `'expanded'` (fullscreen mastering): large row per slot, plugin name + vendor + inline parameter macros (2–4 exposed params), bypass toggle, drag handle, remove button, "open editor" button.
- `'compact'` (small bottom-left mastering preview): stacked vertical chips, icon-only bypass, tiny name, overflow popover if > 3 plugins.
- Uses same data source (`pluginChainsBySongId[songId]`), same event handlers, just different CSS + density.

### 6.2 Plugin browser / scan dialog

Modal. Tabs: `Installed` · `Recent` · `Favorites`.

- Scan button → sends `scan` to sidecar, shows progress bar driven by `scanProgress` events.
- List with virtualised rendering (1000+ plugins is realistic), grouped by vendor.
- Fuzzy search input (name, vendor, category).
- Error badge on plugins that failed to scan (with error detail on hover).
- "Add to chain" button adds to the currently-focused track at the end of its chain.

### 6.3 "Add plugin" button placement

**Per Ethan's final decision: NOT in the header.**

Placement:
- **Fullscreen mastering view:** a dedicated "Inserts" panel section that contains the `PluginChainStrip` (expanded variant) with a `+ Add plugin` button at the end of the chain.
- **Small mastering preview (bottom-left compact panel):** the `PluginChainStrip` (compact variant) is rendered in its own sub-container with a small `+` icon button at the end of the strip.
- Both routes open the plugin browser dialog (§6.2) scoped to the current song.

### 6.4 Plugin editors

Plugins have native GUIs (NSView on macOS for AU/VST3). JUCE sidecar creates a native floating window per editor. Docking options considered:

- **v1 — native floating window only.** Sidecar owns an `NSWindow` per open editor. Electron doesn't try to embed it. Window position/size is remembered per plugin UID.
- **Future — embed via window re-parenting.** Use `NSWindow` child-window or `child_window` on Win32 to visually nest into Electron's BrowserWindow. Non-trivial; defer.

Renderer shows a "plugin editor" button per slot. Click → sidecar opens native window → button becomes highlighted. Click again → sidecar closes window.

## 7. Build / license implications

### 7.1 JUCE licensing

- JUCE Indie: **$50/mo** (JUCE 8 pricing) for studios with < $500k revenue. Closed-source distribution allowed.
- JUCE Personal (free) allows commercial sales only under strict conditions (revenue < $50k). Could be viable for initial v1 ship.
- PP is closed-source (PolyForm-Noncommercial license on the app itself, but packaged binary ship), so we need at minimum JUCE Personal compliance, and Indie once meaningful revenue.
- **Decision for v1:** start on JUCE Personal, upgrade to Indie when PP revenue crosses $50k.

### 7.2 VST3 SDK

- As of **VST 3.8 (Oct 2025)**, Steinberg relicensed the SDK under **MIT**. Before that it was dual GPLv3/proprietary. This is the single biggest licensing win for v1 — we can link statically without paying Steinberg.
- Pin SDK to ≥ 3.8. Keep the license file bundled.

### 7.3 CLAP

- MIT. No concerns.

### 7.4 AU

- Apple AudioUnit SDK is free to use via AudioToolbox. No separate licensing.
- AU plugin hosting **inside a sandboxed app** requires `com.apple.security.temporary-exception.audio-unit-host` which Apple warns "effectively disables the sandbox". This is the main reason Logic Pro is exempted.
- **Consequence:** direct-distribution build (DMG) gets plugin hosting. MAS build does NOT — feature flag `SHOW_PLUGIN_HOSTING` off for MAS, on for DMG. Align with existing feature-flag pattern in `apps/renderer/src/featureFlags.ts`.

### 7.5 Code signing + notarization

- Sidecar binary must be Developer-ID-signed and included in notarization (existing flow in `scripts/notarize.js`).
- Loaded third-party plugins are NOT our signing responsibility — Gatekeeper handles them at load time. If a plugin is unsigned, AU/VST3 load may fail; surface that error cleanly.
- Hardened runtime entitlements need `com.apple.security.cs.disable-library-validation` to load third-party dylibs (VST3 and CLAP are dylibs). Add to `build/entitlements.mac.plist`.

## 8. Phased delivery plan

### Phase 1 — Scaffold (UI + data model, no actual plugin loading)

- Add `PluginChain` types to contracts, state-service migration, IPC channels.
- Build `PluginChainStrip` React component with both variants, mocked plugin list.
- Wire add/remove/bypass/reorder to state, with persistence.
- Plugin browser dialog UI with a mock plugin list (hardcoded 20 entries) for design iteration.
- No sidecar yet; all actions are pure UI + state.
- **Ships behind feature flag `ENABLE_PLUGIN_HOSTING=false`.**

### Phase 2 — Sidecar skeleton + smoke-test plugin

- New npm workspace: `apps/audio-host` (C++ JUCE project).
- Build pipeline: CMake → Developer-ID-signed binary → bundled in `dist/bin/`.
- stdio JSON-RPC control channel, handshake roundtrip.
- Load a single bundled smoke-test plugin (e.g. a JUCE tone generator or bypass plugin) on demand to prove the audio path end-to-end.
- Sidecar takes over final audio output: WebAudio `destination` is replaced by a silent/analysis-only graph; sidecar plays via CoreAudio directly. Analyser nodes stay in renderer fed by metering channel.
- **Still behind feature flag.**

### Phase 3 — Real VST3 / AU / CLAP scan + load

- Full JUCE `AudioPluginFormatManager` integration.
- Async plugin scanner with per-plugin timeout (3 sec default), blocklist for crashers.
- `producer-player-plugin-scan.json` cache with invalidation on plugin folder mtime.
- Plugin browser dialog connected to live scan results.
- Add + load a real plugin, verify audio passes through.

### Phase 4 — Per-track persistence + native editors

- `getState` / `setState` round-trip on save/load/track-switch.
- Native editor window open/close wired through sidecar.
- Multiple plugins in chain, reorder, bypass all working.
- Parameter change debouncing.

### Phase 5 — Polish + preset save/recall

- Preset save/load (file-backed, `.fxp`-style).
- Latency display.
- Graceful plugin crash handling (plugin X dies → slot marked failed, chain continues).
- Feature flag flips to `true` for DMG build; remains off for MAS build.
- Screenshots + docs + Remotion video update.

**Estimated time-to-ship: 3 phases pre-real-plugins (~2-3 weeks), 2 phases with real plugins (~4-6 weeks), so ~6-9 weeks end-to-end for a disciplined solo build. Parallelisable if we split sidecar vs UI work.**

## 9. Top 5 risks

1. **JUCE licensing cost trajectory.** $50/mo is fine for a solo dev, but if JUCE 9 changes terms (or adds per-install royalties), we're exposed. Mitigation: CLAP is MIT — worst case we drop VST3/AU and go CLAP-only, but ecosystem shrinks.
2. **Mac App Store exclusion.** AU hosting inside the sandbox is effectively impossible. We lose the MAS distribution channel for the plugin-hosting feature. Mitigation: feature-flag MAS build, keep DMG as primary distribution path (already is).
3. **Plugin crash blast radius.** A single buggy plugin can crash the sidecar and take audio with it. Mitigation: sub-process isolation per plugin is the "correct" answer but 10x the engineering cost; v1 accepts sidecar-level crashes, auto-respawns, shows a toast. v2 can add per-plugin sub-process isolation.
4. **Latency from extra buffering layer.** Sidecar adds one buffer of audio output latency vs current WebAudio direct output (~10ms at 512 frames). Measurable but acceptable for mastering preview. Mitigation: tune buffer size, warn users if they're A/B-comparing timing-sensitive material.
5. **Cross-platform parity.** Linux CLAP is easy, Windows VST3 is easy, but plugin-folder discovery paths differ on every OS, code-signing differs on every OS, native window embedding differs on every OS. V1 is macOS-only; cross-platform becomes a phase 6+ effort. Mitigation: keep format/platform matrix explicit and punt.

## 10. Codex's alternative opinion (verbatim)

> ### Architectural Options
>
> **Option 1: WebAudio-Only Inserts** — Keep the current WebAudio graph and add per-track insert slots backed by WebAudio nodes, AudioWorklet processors, and/or WASM DSP. Smallest implementation, no native build pipeline. Cons: Not VST3/AU/CLAP hosting. Best for a fast MVP.
>
> **Option 2: Native Plugin Host Sidecar, Electron As UI** — Add a native audio engine process, likely JUCE-based, that owns playback and plugin chains. Electron controls it over IPC/WebSocket/gRPC. Simplest credible path to real VST3/AU/CLAP inserts. Low latency because plugins run in the native audio callback. JUCE gives plugin scanning, AudioPluginFormatManager, AudioPluginInstance, VST3/AU/LV2 hosting primitives.
>
> **Option 3: Hybrid WebAudio Playback With Native Plugin Processing Bridge** — Keep WebAudio as transport/output, route PCM blocks through a native plugin host via AudioWorklet plus shared memory/ring buffers. Preserves much of the existing renderer graph. Cons: Hardest real-time engineering path, added buffering both ways, clock drift and underruns become your problem.
>
> ### Practical Recommendation
>
> Build this in two phases:
> 1. **Short-term MVP:** implement per-track WebAudio insert slots for built-in effects. Move the existing ScriptProcessor mid/side path to AudioWorklet while touching the graph.
> 2. **Real plugin hosting:** create a native JUCE sidecar host and move final playback into it. Keep React/Electron for library, insert UI, parameter panels, preset state, and analysis display. Use IPC only for commands, state, and metering.
>
> For Producer Player specifically, the native sidecar should start as **VST3-only + macOS AU optional**, not all formats at once. Add CLAP once the insert-chain abstraction is stable.
>
> ### Top 3 References
>
> 1. **JUCE AudioPluginHost / JUCE plugin hosting APIs.**
> 2. **Element by Kushview** — Modular AU/LV2/VST/VST3/CLAP host with node/rack concepts close to "insert chains".
> 3. **Carla** — Mature multi-format plugin host with audio/MIDI routing, native drivers, bridge concepts, and plugin isolation lessons. License makes direct embedding unlikely, but architecture is valuable.
>
> ### Licensing note
>
> Steinberg VST3 SDK is now available under MIT as of VST 3.8 (Oct 2025), allowing commercial use with attribution. Older VST3 SDK versions were GPLv3/proprietary dual-licensed.

### 10.1 Agreement / disagreement

- **Agree:** JUCE sidecar architecture (Option 2) is the right primary bet. Everything Codex says about Option 3 being the hardest real-time path matches my read.
- **Agree:** VST 3.8 MIT relicense is a material licensing win.
- **Agree:** migrate `ScriptProcessorNode` mid/side work to `AudioWorkletNode` opportunistically.
- **Partial disagreement — two-phase "WebAudio MVP then native":** Codex suggests shipping a WebAudio-only insert MVP first, then layering native hosting later. I prefer to skip the WebAudio-only MVP because (a) Ethan explicitly asked for VST/AU/CLAP hosting (the whole point), (b) the data model + UI will be redesigned anyway when native hosting arrives, (c) two migrations > one. My plan replaces the interim WebAudio MVP with "Phase 1 scaffold = UI + data model only, no audio changes" which is lower-risk than a WebAudio insert engine we'll throw away.
- **Disagreement — format scope:** Codex says start VST3-only. I'd include **VST3 + AU** from phase 3 because JUCE gives them uniformly and AU is macOS-native (we're macOS-first anyway). CLAP is trivial to add once the framework is there. Starting VST3-only saves ~2 days and loses half the plugin ecosystem on Mac. Not worth the saving.
- **Agreement on reference projects:** JUCE AudioPluginHost, Kushview Element, Carla. I'd add `atsushieno/uapmd` (MIT, VST3/AU/CLAP/LV2) as a lean reference.

## 11. Open questions for Ethan

Answered before implementation dispatch:

1. Are you OK with JUCE Personal → Indie ($50/mo once revenue crosses $50k) as the license path?
2. Is ~10ms added output latency acceptable? (One extra buffer in the sidecar output path vs current direct WebAudio out.)
3. macOS-only for the v1 plugin-hosting ship? (Windows/Linux as phase 6+.)
4. MAS build drops plugin hosting (feature-flagged off) — confirm this is acceptable.
5. Per-plugin editor = native floating window v1, embedded later — confirm.
6. Hard drop of VST2 — confirm.
7. Scope: insert effects only, no instruments, no MIDI plugins — confirm.
