# Audio output integrity diagnostics

This is the acceptance harness for audible playback defects. Renderer events
can prove that the media element did or did not seek, but they cannot prove what
the operating system actually sent to the output device. This tooling records
Producer Player's **application audio only** through macOS ScreenCaptureKit and
compares its time progression with the source file.

Keep this harness in the repository. A playback-stutter fix is not considered
verified when only UI state, timers, or media events pass. For an audible defect,
the final gate is a clean external capture report.

## Safety and scope

- The capture is filtered to the Producer Player bundle id. It does not record
  a microphone and does not record other applications' audio.
- It does not click, focus, launch, stop, or send transport commands to Producer
  Player. The listener performs the reproduction manually while capture runs.
- Raw captures and reports belong in `diagnostics/audio-output/`, which is
  intentionally ignored by Git.
- macOS attributes the required **Screen & System Audio Recording** permission
  to the terminal/agent host. Check it without prompting:

  ```sh
  npm run diagnose:audio:capture -- --preflight
  ```

## Café Lool transition procedure

1. Warm/compile the standalone recorder before playback:

   ```sh
   npm run diagnose:audio:capture -- --preflight
   ```

2. In Producer Player, prepare the natural album transition from `the amazone`
   to `cafe lool`. Do not use a synthetic seek as a substitute for the normal
   handoff.

3. Start an eight-second application-only capture just before the transition:

   ```sh
   npm run diagnose:audio:capture -- \
     --duration 8 \
     --output diagnostics/audio-output/cafe-lool-transition.caf
   ```

4. Compare the capture against the beginning of the exact source version:

   ```sh
   npm run diagnose:audio:compare -- \
     --source "/Users/ethansarif-kattan/Documents/MusicOutput/cafe lool v17.wav" \
     --capture diagnostics/audio-output/cafe-lool-transition.caf \
     --source-search-seconds 12 \
     --json-out diagnostics/audio-output/cafe-lool-transition.json
   ```

The comparator is gain-, device-, resampling-, and moderate-EQ-tolerant. It
aligns short output windows to the source clock and fails when the output moves
backward, skips forward, loses timing continuity, or drops to unexplained
silence. Exit status `0` is `PASS`; exit status `2` is a detected integrity
failure.

## Regression-test the detector

```sh
npm run diagnose:audio:test
```

The detector's own tests cover a clean gain-changed capture, an inserted repeat,
and a 100 ms dropout. This prevents the litmus test from silently becoming too
weak to catch the original class of defect.

## Investigation notes (2026-07-12)

The 3.330 production trace of the remaining Café Lool failure contains no seek,
`waiting`, or second `playing` event after Café begins. The track does, however,
activate one native Audio Unit insert while the preceding track has no insert.
The existing renderer bridge submits block N asynchronously and may later emit
that processed block during callback N+1 or later. That is a literal replay of
older samples and can sound like a restart even while the media element's clock
is perfectly monotonic. Any repair to that bridge must keep dry fallbacks and
processed results tied to the same source block, and this external capture is
the final proof.

## Normal-track startup guard

Native plug-in prewarming is song-scoped. If a plug-in constructor is already
running for song B while the listener starts ordinary song A, A must not await
B's prewarm. Compare `canplay` with `play` in the playback event log when
investigating a slow start: a ready zero-plug-in track should proceed
immediately, while only the exact song that owns an enabled plug-in may wait for
its native instance. The renderer regression helper is
`shouldWaitForPluginNativePrewarm`.

The fixed plug-in output timeline is intentionally continuous across song
generations. Do not clear it at a normal album boundary: that would discard its
queued tail and shorten the outgoing track. The unit test named “preserves the
exact block count and boundary across an album handoff” protects this invariant.
