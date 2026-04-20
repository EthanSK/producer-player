# Plugin Hosting Plan Audit (HEAD v3.44)

- §1 per-track insert chain: DONE — `perTrackPluginChains` keyed by song and chain IPC exist: `packages/contracts/src/index.ts:621`, `apps/electron/src/state-service.ts:1593`.
- §1 VST3/AU/CLAP commercial plugin support: PARTIAL — contract allows all three, sidecar registers VST3/AU only and says CLAP later: `packages/contracts/src/index.ts:338`, `native/pp-audio-host/CMakeLists.txt:40`.
- §1 Ableton-style scanner/cache/errors: PARTIAL — scans VST3/AU default folders and returns failures, but no CLAP/dedupe/progress UI and cache is in user state: `native/pp-audio-host/src/main.cpp:372`, `packages/contracts/src/index.ts:631`.
- §1 search dialog fuzzy by name/vendor/category: PARTIAL — dialog filters substring by name/vendor only: `apps/renderer/src/lib/PluginBrowserDialog.tsx:57`.
- §1 per-slot enable/disable bypass: DONE — persisted toggle API and UI switch: `apps/electron/src/state-service.ts:1714`, `apps/renderer/src/lib/PluginChainStrip.tsx:348`.
- §1 save/restore plugin state per track: PARTIAL — `state` base64 persists per chain item, but not the spec’s songId × slot index × plugin UID shape: `packages/contracts/src/index.ts:369`, `apps/electron/src/state-service.ts:1742`.
- §1 reusable chain strip in fullscreen + compact contexts: DONE — one component rendered with `layout="compact"` and `layout="fullscreen"`: `apps/renderer/src/App.tsx:12931`, `apps/renderer/src/App.tsx:15809`.
- §1 per-plugin native editor window: DONE — renderer opens/closes editor, sidecar owns JUCE `DocumentWindow`: `apps/renderer/src/App.tsx:9566`, `native/pp-audio-host/src/main.cpp:186`.

- §3 Option 2 native sidecar, Electron UI: PARTIAL — sidecar exists, but renderer still owns output and sidecar is an on-demand DSP slave: `native/pp-audio-host/src/main.cpp:30`.
- §3 native process owns audio engine/plugin graph/system output: PARTIAL — plugins process blocks, but no CoreAudio/system output ownership: `native/pp-audio-host/src/main.cpp:24`, `native/pp-audio-host/src/main.cpp:30`.
- §3 audio buffers never cross Electron IPC: MISSING — audio buffers cross stdio JSON as base64 in `process_block`: `native/pp-audio-host/src/main.cpp:32`, `apps/electron/src/plugin-host-service.ts:624`.
- §3 main launches/monitors sidecar and relays IPC: PARTIAL — lazy spawn/forwarders exist, but not app-launch long-lived behavior: `apps/electron/src/plugin-host-service.ts:261`, `apps/electron/src/main.ts:4975`.
- §3 stdio control + Unix socket metering: PARTIAL — stdio JSON exists; Unix-domain metering socket not implemented: `apps/electron/src/plugin-host-service.ts:27`.

- §4.1 long-lived sidecar spawned on app launch/killed on quit: PARTIAL — sidecar is lazy-started, not launch-started: `apps/electron/src/plugin-host-service.ts:7`, `apps/electron/src/plugin-host-service.ts:261`.
- §4.1 bundled binary in `apps/electron/dist/bin/pp-audio-host`: PARTIAL — resolver and `asarUnpack` expect it, but build script only copies ffmpeg: `apps/electron/src/plugin-host-service.ts:76`, `apps/electron/scripts/build-main.mjs:151`.
- §4.1 one sidecar instance, not one per track: DONE — singleton `pluginHostService` and per-instance registry: `apps/electron/src/main.ts:420`, `native/pp-audio-host/src/main.cpp:99`.
- §4.1 crash recovery auto-respawn + renderer replay: PARTIAL — exit events notify renderer, but no automatic respawn/replay until next action: `apps/electron/src/plugin-host-service.ts:284`, `apps/renderer/src/App.tsx:9661`.
- §4.2 JSON-RPC stdin/stdout control channel: PARTIAL — newline JSON exists but methods are named `scan_plugins`/`load_plugin` etc., not spec names: `apps/electron/src/plugin-host-service.ts:27`, `native/pp-audio-host/src/main.cpp:781`.
- §4.2 scan/load/setParam/bypass/reorder/getState/openEditor/play protocol: PARTIAL — scan/load/param/state/editor exist; bypass/reorder are renderer state flags and `play` is not implemented: `apps/electron/src/plugin-host-service.ts:461`, `apps/electron/src/plugin-host-service.ts:648`.
- §4.2 scanProgress/pluginCrashed/stateChanged events: MISSING — not implemented.
- §4.2 Unix-domain socket binary metering at ~30 Hz: MISSING — not implemented.
- §4.3 default 512-frame buffer: DONE — load defaults blockSize to 512: `native/pp-audio-host/src/main.cpp:495`.
- §4.3 stereo float32 interleaved end-to-end: PARTIAL — `process_block` accepts stereo/interleaved base64 but converts into JUCE buffers over JSON: `native/pp-audio-host/src/main.cpp:49`, `native/pp-audio-host/src/main.cpp:592`.
- §4.3 sample rate follows source/resample at chain entry: MISSING — load defaults to 48000 if not supplied; no resampler implemented: `native/pp-audio-host/src/main.cpp:495`.
- §4.3 latency reporting surfaced per slot/no auto-PDC: DONE — sidecar returns latency and UI renders samples: `native/pp-audio-host/src/main.cpp:550`, `apps/renderer/src/lib/PluginChainStrip.tsx:157`.
- §4.4 audio thread CoreAudio callback RT-safe: MISSING — not implemented; sidecar comment says no audio callback/CoreAudio yet: `native/pp-audio-host/src/main.cpp:30`.
- §4.4 control thread handles JSON/plugin scan/decode/parameter queue: PARTIAL — JSON REPL and commands exist, but no decode scheduling/RT queue model: `native/pp-audio-host/src/main.cpp:761`.
- §4.4 scan thread pool: MISSING — scanner runs synchronously in `handleScanPlugins`: `native/pp-audio-host/src/main.cpp:372`.
- §4.4 lock-free SPSC parameter queue: MISSING — parameters call `setValueNotifyingHost` directly: `native/pp-audio-host/src/main.cpp:693`.
- §4.5 lifecycle handshake/idle: PARTIAL — ready handshake exists, but spawn is lazy: `apps/electron/src/plugin-host-service.ts:31`.
- §4.5 user picks song → sidecar `play` opens file/streams CoreAudio: MISSING — not implemented.
- §4.5 add plugin → `load` and splice chain: PARTIAL — load/reconcile exists; no native streaming graph splice: `apps/electron/src/plugin-host-service.ts:546`.
- §4.5 parameter changes debounced 60Hz into sidecar: MISSING — no renderer parameter UI/debounce found.
- §4.5 shutdown drains/exits: DONE — `shutdown`/stop path exists: `apps/electron/src/plugin-host-service.ts:740`, `native/pp-audio-host/src/main.cpp:258`.
- §4.5 crash respawn + replay current state: PARTIAL — crash is surfaced, reload happens on next action not automatic respawn: `apps/renderer/src/App.tsx:9661`.

- §5 `PluginChainSlot`/`PluginChain` schema exact fields: PARTIAL — implemented `PluginChainItem`/`TrackPluginChain` lacks cached name/format/lastSavedAt fields: `packages/contracts/src/index.ts:369`.
- §5 unified state `pluginChainsBySongId`: PARTIAL — implemented as optional `perTrackPluginChains`, split-to-disk: `packages/contracts/src/index.ts:627`.
- §5 per-song scope: DONE — chains keyed by songId: `apps/electron/src/state-service.ts:1593`.
- §5 ordered array/reorder rewrites array: DONE — `order` normalized and reorder rewrites items: `apps/electron/src/state-service.ts:1682`.
- §5 opaque base64 plugin state: DONE — `state` is opaque base64 and set/get sidecar state exists: `packages/contracts/src/index.ts:366`, `apps/electron/src/plugin-host-service.ts:661`.
- §5 scanner cache separate `producer-player-plugin-scan.json`: MISSING — scanner cache is `pluginLibrary` in unified user state: `packages/contracts/src/index.ts:621`.

- §6.1 reusable `PluginChainStrip` with variant prop: DONE — single component with `layout` prop and two CSS variants: `apps/renderer/src/lib/PluginChainStrip.tsx:39`, `apps/renderer/src/styles.css:5169`.
- §6.1 expanded row contents: PARTIAL — name/vendor, bypass, reorder, remove, editor exist; inline macro params are not implemented: `apps/renderer/src/lib/PluginChainStrip.tsx:147`.
- §6.1 compact stacked chips/overflow >3: PARTIAL — compact styling exists; no overflow popover limit: `apps/renderer/src/styles.css:5207`.
- §6.2 browser tabs Installed/Recent/Favorites: MISSING — not implemented.
- §6.2 scan button/progress: PARTIAL — scan button exists, no progress events/bar: `apps/renderer/src/lib/PluginBrowserDialog.tsx:170`.
- §6.2 virtualized grouped list: MISSING — maps all filtered plugins directly: `apps/renderer/src/lib/PluginBrowserDialog.tsx:206`.
- §6.2 fuzzy search name/vendor/category: PARTIAL — substring name/vendor only: `apps/renderer/src/lib/PluginBrowserDialog.tsx:57`.
- §6.2 scan error badge/detail hover: PARTIAL — unsupported rows use `failureReason` title but no error badge: `apps/renderer/src/lib/PluginBrowserDialog.tsx:221`.
- §6.2 add-to-chain button behavior: DONE — row click calls `onPick`, parent appends to current song: `apps/renderer/src/lib/PluginBrowserDialog.tsx:218`, `apps/renderer/src/App.tsx:9425`.
- §6.3 add plugin not in header: DONE — compact/fullscreen strips are placed in mastering panels, not header: `apps/renderer/src/App.tsx:12925`, `apps/renderer/src/App.tsx:15802`.
- §6.3 fullscreen Inserts panel with `+ Add plugin`: PARTIAL — fullscreen strip has add button but not a dedicated “Inserts” panel section: `apps/renderer/src/App.tsx:15802`, `apps/renderer/src/lib/PluginChainStrip.tsx:389`.
- §6.3 compact `+` button route: DONE — compact strip rendered in side panel and add button opens browser: `apps/renderer/src/App.tsx:12931`, `apps/renderer/src/lib/PluginChainStrip.tsx:389`.
- §6.4 v1 native floating plugin windows: DONE — sidecar creates top-level JUCE `DocumentWindow`: `native/pp-audio-host/src/main.cpp:132`.
- §6.4 remember editor window position/size: MISSING — not implemented.
- §6.4 renderer editor button toggles/highlights: DONE — edit button uses open state and open/close IPC: `apps/renderer/src/lib/PluginChainStrip.tsx:235`, `apps/renderer/src/App.tsx:9572`.

- §7.1 JUCE licensing decision: PARTIAL — JUCE 8.0.12 bootstrap exists, but Personal/Indie compliance decision is not codified: `native/pp-audio-host/scripts/build-sidecar.sh:21`.
- §7.2 VST3 SDK ≥3.8 and license bundled: PARTIAL — JUCE VST3 host enabled, but no explicit VST3 SDK pin/license bundle found: `native/pp-audio-host/CMakeLists.txt:40`.
- §7.3 CLAP MIT/no concerns: MISSING — CLAP hosting explicitly deferred: `native/pp-audio-host/CMakeLists.txt:43`.
- §7.4 AU hosting and MAS feature flag off: PARTIAL — AU enabled for macOS, but no `SHOW_PLUGIN_HOSTING` MAS/DMG flag exists: `native/pp-audio-host/CMakeLists.txt:42`, `apps/renderer/src/featureFlags.ts:15`.
- §7.5 sidecar signing/notarization inclusion: PARTIAL — notarization hook exists, but sidecar copy/bundling is incomplete: `package.json:83`, `apps/electron/scripts/build-main.mjs:151`.
- §7.5 loaded third-party plugin errors surfaced cleanly: PARTIAL — load errors are returned/reconcile logs failures; no user-facing per-plugin load error UI found: `native/pp-audio-host/src/main.cpp:532`, `apps/electron/src/main.ts:5040`.
- §7.5 hardened runtime `disable-library-validation`: MISSING — entitlement absent from direct Mac entitlements: `build/entitlements.mac.plist:4`.
tokens used
112,254
# Plugin Hosting Plan Audit (HEAD v3.44)

- §1 per-track insert chain: DONE — `perTrackPluginChains` keyed by song and chain IPC exist: `packages/contracts/src/index.ts:621`, `apps/electron/src/state-service.ts:1593`.
- §1 VST3/AU/CLAP commercial plugin support: PARTIAL — contract allows all three, sidecar registers VST3/AU only and says CLAP later: `packages/contracts/src/index.ts:338`, `native/pp-audio-host/CMakeLists.txt:40`.
- §1 Ableton-style scanner/cache/errors: PARTIAL — scans VST3/AU default folders and returns failures, but no CLAP/dedupe/progress UI and cache is in user state: `native/pp-audio-host/src/main.cpp:372`, `packages/contracts/src/index.ts:631`.
- §1 search dialog fuzzy by name/vendor/category: PARTIAL — dialog filters substring by name/vendor only: `apps/renderer/src/lib/PluginBrowserDialog.tsx:57`.
- §1 per-slot enable/disable bypass: DONE — persisted toggle API and UI switch: `apps/electron/src/state-service.ts:1714`, `apps/renderer/src/lib/PluginChainStrip.tsx:348`.
- §1 save/restore plugin state per track: PARTIAL — `state` base64 persists per chain item, but not the spec’s songId × slot index × plugin UID shape: `packages/contracts/src/index.ts:369`, `apps/electron/src/state-service.ts:1742`.
- §1 reusable chain strip in fullscreen + compact contexts: DONE — one component rendered with `layout="compact"` and `layout="fullscreen"`: `apps/renderer/src/App.tsx:12931`, `apps/renderer/src/App.tsx:15809`.
- §1 per-plugin native editor window: DONE — renderer opens/closes editor, sidecar owns JUCE `DocumentWindow`: `apps/renderer/src/App.tsx:9566`, `native/pp-audio-host/src/main.cpp:186`.

- §3 Option 2 native sidecar, Electron UI: PARTIAL — sidecar exists, but renderer still owns output and sidecar is an on-demand DSP slave: `native/pp-audio-host/src/main.cpp:30`.
- §3 native process owns audio engine/plugin graph/system output: PARTIAL — plugins process blocks, but no CoreAudio/system output ownership: `native/pp-audio-host/src/main.cpp:24`, `native/pp-audio-host/src/main.cpp:30`.
- §3 audio buffers never cross Electron IPC: MISSING — audio buffers cross stdio JSON as base64 in `process_block`: `native/pp-audio-host/src/main.cpp:32`, `apps/electron/src/plugin-host-service.ts:624`.
- §3 main launches/monitors sidecar and relays IPC: PARTIAL — lazy spawn/forwarders exist, but not app-launch long-lived behavior: `apps/electron/src/plugin-host-service.ts:261`, `apps/electron/src/main.ts:4975`.
- §3 stdio control + Unix socket metering: PARTIAL — stdio JSON exists; Unix-domain metering socket not implemented: `apps/electron/src/plugin-host-service.ts:27`.

- §4.1 long-lived sidecar spawned on app launch/killed on quit: PARTIAL — sidecar is lazy-started, not launch-started: `apps/electron/src/plugin-host-service.ts:7`, `apps/electron/src/plugin-host-service.ts:261`.
- §4.1 bundled binary in `apps/electron/dist/bin/pp-audio-host`: PARTIAL — resolver and `asarUnpack` expect it, but build script only copies ffmpeg: `apps/electron/src/plugin-host-service.ts:76`, `apps/electron/scripts/build-main.mjs:151`.
- §4.1 one sidecar instance, not one per track: DONE — singleton `pluginHostService` and per-instance registry: `apps/electron/src/main.ts:420`, `native/pp-audio-host/src/main.cpp:99`.
- §4.1 crash recovery auto-respawn + renderer replay: PARTIAL — exit events notify renderer, but no automatic respawn/replay until next action: `apps/electron/src/plugin-host-service.ts:284`, `apps/renderer/src/App.tsx:9661`.
- §4.2 JSON-RPC stdin/stdout control channel: PARTIAL — newline JSON exists but methods are named `scan_plugins`/`load_plugin` etc., not spec names: `apps/electron/src/plugin-host-service.ts:27`, `native/pp-audio-host/src/main.cpp:781`.
- §4.2 scan/load/setParam/bypass/reorder/getState/openEditor/play protocol: PARTIAL — scan/load/param/state/editor exist; bypass/reorder are renderer state flags and `play` is not implemented: `apps/electron/src/plugin-host-service.ts:461`, `apps/electron/src/plugin-host-service.ts:648`.
- §4.2 scanProgress/pluginCrashed/stateChanged events: MISSING — not implemented.
- §4.2 Unix-domain socket binary metering at ~30 Hz: MISSING — not implemented.
- §4.3 default 512-frame buffer: DONE — load defaults blockSize to 512: `native/pp-audio-host/src/main.cpp:495`.
- §4.3 stereo float32 interleaved end-to-end: PARTIAL — `process_block` accepts stereo/interleaved base64 but converts into JUCE buffers over JSON: `native/pp-audio-host/src/main.cpp:49`, `native/pp-audio-host/src/main.cpp:592`.
- §4.3 sample rate follows source/resample at chain entry: MISSING — load defaults to 48000 if not supplied; no resampler implemented: `native/pp-audio-host/src/main.cpp:495`.
- §4.3 latency reporting surfaced per slot/no auto-PDC: DONE — sidecar returns latency and UI renders samples: `native/pp-audio-host/src/main.cpp:550`, `apps/renderer/src/lib/PluginChainStrip.tsx:157`.
- §4.4 audio thread CoreAudio callback RT-safe: MISSING — not implemented; sidecar comment says no audio callback/CoreAudio yet: `native/pp-audio-host/src/main.cpp:30`.
- §4.4 control thread handles JSON/plugin scan/decode/parameter queue: PARTIAL — JSON REPL and commands exist, but no decode scheduling/RT queue model: `native/pp-audio-host/src/main.cpp:761`.
- §4.4 scan thread pool: MISSING — scanner runs synchronously in `handleScanPlugins`: `native/pp-audio-host/src/main.cpp:372`.
- §4.4 lock-free SPSC parameter queue: MISSING — parameters call `setValueNotifyingHost` directly: `native/pp-audio-host/src/main.cpp:693`.
- §4.5 lifecycle handshake/idle: PARTIAL — ready handshake exists, but spawn is lazy: `apps/electron/src/plugin-host-service.ts:31`.
- §4.5 user picks song → sidecar `play` opens file/streams CoreAudio: MISSING — not implemented.
- §4.5 add plugin → `load` and splice chain: PARTIAL — load/reconcile exists; no native streaming graph splice: `apps/electron/src/plugin-host-service.ts:546`.
- §4.5 parameter changes debounced 60Hz into sidecar: MISSING — no renderer parameter UI/debounce found.
- §4.5 shutdown drains/exits: DONE — `shutdown`/stop path exists: `apps/electron/src/plugin-host-service.ts:740`, `native/pp-audio-host/src/main.cpp:258`.
- §4.5 crash respawn + replay current state: PARTIAL — crash is surfaced, reload happens on next action not automatic respawn: `apps/renderer/src/App.tsx:9661`.

- §5 `PluginChainSlot`/`PluginChain` schema exact fields: PARTIAL — implemented `PluginChainItem`/`TrackPluginChain` lacks cached name/format/lastSavedAt fields: `packages/contracts/src/index.ts:369`.
- §5 unified state `pluginChainsBySongId`: PARTIAL — implemented as optional `perTrackPluginChains`, split-to-disk: `packages/contracts/src/index.ts:627`.
- §5 per-song scope: DONE — chains keyed by songId: `apps/electron/src/state-service.ts:1593`.
- §5 ordered array/reorder rewrites array: DONE — `order` normalized and reorder rewrites items: `apps/electron/src/state-service.ts:1682`.
- §5 opaque base64 plugin state: DONE — `state` is opaque base64 and set/get sidecar state exists: `packages/contracts/src/index.ts:366`, `apps/electron/src/plugin-host-service.ts:661`.
- §5 scanner cache separate `producer-player-plugin-scan.json`: MISSING — scanner cache is `pluginLibrary` in unified user state: `packages/contracts/src/index.ts:621`.

- §6.1 reusable `PluginChainStrip` with variant prop: DONE — single component with `layout` prop and two CSS variants: `apps/renderer/src/lib/PluginChainStrip.tsx:39`, `apps/renderer/src/styles.css:5169`.
- §6.1 expanded row contents: PARTIAL — name/vendor, bypass, reorder, remove, editor exist; inline macro params are not implemented: `apps/renderer/src/lib/PluginChainStrip.tsx:147`.
- §6.1 compact stacked chips/overflow >3: PARTIAL — compact styling exists; no overflow popover limit: `apps/renderer/src/styles.css:5207`.
- §6.2 browser tabs Installed/Recent/Favorites: MISSING — not implemented.
- §6.2 scan button/progress: PARTIAL — scan button exists, no progress events/bar: `apps/renderer/src/lib/PluginBrowserDialog.tsx:170`.
- §6.2 virtualized grouped list: MISSING — maps all filtered plugins directly: `apps/renderer/src/lib/PluginBrowserDialog.tsx:206`.
- §6.2 fuzzy search name/vendor/category: PARTIAL — substring name/vendor only: `apps/renderer/src/lib/PluginBrowserDialog.tsx:57`.
- §6.2 scan error badge/detail hover: PARTIAL — unsupported rows use `failureReason` title but no error badge: `apps/renderer/src/lib/PluginBrowserDialog.tsx:221`.
- §6.2 add-to-chain button behavior: DONE — row click calls `onPick`, parent appends to current song: `apps/renderer/src/lib/PluginBrowserDialog.tsx:218`, `apps/renderer/src/App.tsx:9425`.
- §6.3 add plugin not in header: DONE — compact/fullscreen strips are placed in mastering panels, not header: `apps/renderer/src/App.tsx:12925`, `apps/renderer/src/App.tsx:15802`.
- §6.3 fullscreen Inserts panel with `+ Add plugin`: PARTIAL — fullscreen strip has add button but not a dedicated “Inserts” panel section: `apps/renderer/src/App.tsx:15802`, `apps/renderer/src/lib/PluginChainStrip.tsx:389`.
- §6.3 compact `+` button route: DONE — compact strip rendered in side panel and add button opens browser: `apps/renderer/src/App.tsx:12931`, `apps/renderer/src/lib/PluginChainStrip.tsx:389`.
- §6.4 v1 native floating plugin windows: DONE — sidecar creates top-level JUCE `DocumentWindow`: `native/pp-audio-host/src/main.cpp:132`.
- §6.4 remember editor window position/size: MISSING — not implemented.
- §6.4 renderer editor button toggles/highlights: DONE — edit button uses open state and open/close IPC: `apps/renderer/src/lib/PluginChainStrip.tsx:235`, `apps/renderer/src/App.tsx:9572`.

- §7.1 JUCE licensing decision: PARTIAL — JUCE 8.0.12 bootstrap exists, but Personal/Indie compliance decision is not codified: `native/pp-audio-host/scripts/build-sidecar.sh:21`.
- §7.2 VST3 SDK ≥3.8 and license bundled: PARTIAL — JUCE VST3 host enabled, but no explicit VST3 SDK pin/license bundle found: `native/pp-audio-host/CMakeLists.txt:40`.
- §7.3 CLAP MIT/no concerns: MISSING — CLAP hosting explicitly deferred: `native/pp-audio-host/CMakeLists.txt:43`.
- §7.4 AU hosting and MAS feature flag off: PARTIAL — AU enabled for macOS, but no `SHOW_PLUGIN_HOSTING` MAS/DMG flag exists: `native/pp-audio-host/CMakeLists.txt:42`, `apps/renderer/src/featureFlags.ts:15`.
- §7.5 sidecar signing/notarization inclusion: PARTIAL — notarization hook exists, but sidecar copy/bundling is incomplete: `package.json:83`, `apps/electron/scripts/build-main.mjs:151`.
- §7.5 loaded third-party plugin errors surfaced cleanly: PARTIAL — load errors are returned/reconcile logs failures; no user-facing per-plugin load error UI found: `native/pp-audio-host/src/main.cpp:532`, `apps/electron/src/main.ts:5040`.
- §7.5 hardened runtime `disable-library-validation`: MISSING — entitlement absent from direct Mac entitlements: `build/entitlements.mac.plist:4`.
