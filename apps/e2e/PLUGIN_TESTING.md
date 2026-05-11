# Plugin Test Surface Notes

## Current Automated Coverage

- `apps/e2e/src/plugin-chain-strip.spec.ts` and `apps/e2e/src/plugin-audio-routing.spec.ts` seed a fake scanned plugin library through the renderer test hook. This covers UI add/toggle/remove/reorder persistence and the empty/all-disabled bypass state, but it does not load a native plugin or process audible playback.
- `apps/electron/test/plugin-host-service.test.cjs` uses fake child processes for the `PluginHostService` protocol. The `mock-plugin-sidecar` fixture adds deterministic DSP coverage: enabled slots multiply a float32 interleaved buffer, disabled/empty chains pass through, and persisted state is applied before processing.
- `apps/electron/test/plugin-preset-library.test.cjs` covers preset library disk persistence. `apps/electron/test/state-service-plugin-chains.test.cjs` covers per-track plugin state storage.

## Mock Harness

Use `apps/electron/test/fixtures/mock-plugin-sidecar.cjs` for hermetic integration tests around the Electron-main plugin host wrapper:

- `makeMockPluginSidecar()` returns a ChildProcess-like object with the same newline JSON protocol as `pp-audio-host`.
- `load_plugin` creates a deterministic gain plugin from a path like `/mock/gain-2.vst3`.
- `process_block` decodes float32 interleaved base64, applies gain for enabled loaded slots, and re-encodes the buffer.
- `get_plugin_state` and `set_plugin_state` round-trip base64 JSON state such as `{"gain":0.5}`.

This is enough to prove plugin host protocol routing and buffer mutation without JUCE or installed VST3/AU plugins.

## Gaps And Blockers

- Renderer playback now exposes `PLUGIN_PROCESS_BLOCK` through preload and routes enabled inserted plugins through a live Web Audio `ScriptProcessorNode` before the downstream mastering processors. The automated gap is now native-plugin availability: CI can prove the IPC/state/audio-buffer path with mocks, but not a real installed VST3/AU editor.
- E2E cannot currently swap Electron main's real `PluginHostService` for the mock sidecar. Add an explicit test-only env hook if we want full Electron E2E coverage of native-like load/process/preset behavior.
- Save/load preset UI depends on `ensurePresetSidecarReady()`, which requires the sidecar to have loaded that instance. The current E2E fake library creates UI pills only, so preset save/recall will fail with "Plugin is still loading" rather than exercising the preset path.
- Real Pro-Q 3 or other commercial VST3/AU verification still needs a native/manual pass: build `pp-audio-host`, scan the real plugin folder, add the plugin, wait for the slot to become loaded, open the editor, change audible parameters, save a preset, change parameters, load the preset, and restart to verify persisted state rehydrates.

## UI Note

`0 smp` is the plugin-reported latency in samples. Zero means the plugin reported no processing latency.
