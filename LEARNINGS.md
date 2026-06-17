# Learnings

Per-repo institutional memory for fixes. Every entry below is a real bug we hit + how we solved it. Check this file BEFORE attempting a same-looking fix.

Maintained by the `learnings` skill — see `~/.claude/skills/learnings/skill.md`.

## Format

Each entry looks like:

```
---
**Date:** YYYY-MM-DDTHH:MM:SSZ
**Trigger:** <voice N / message snippet / null>
**Symptom:** <what was visible>
**Root cause:** <what we actually found>
**Fix:** <file:line + short prose + commit SHA>
**Guard:** <test / lint / watchdog / comment that prevents regression — or 'none'>
---
```

## Entries

(newest first)

---
**Date:** 2026-06-12T11:43:34Z
**Trigger:** voice 7426 (ship) / voice 7421 (diagnosis)
**Symptom:** Residual crackle when rapidly switching tracks (A<->B<->A) during playback or on long/large files, at v3.299 — after prior multi-threading fixes (worker analysis v3.240, 15ms crossfade, deferred kickoff) the LAST main-thread starvation source remained
**Root cause:** extractTransferableChannels (trackAnalysisClient.ts) did a full copy.set(source) memcpy of EVERY audio channel (~170MB for a 4-min stereo 44.1k track) on the RENDERER MAIN THREAD before transferring buffers to the analysis worker. That synchronous memcpy starved WebAudio's high-res render scheduling during the deferred analysis window -> crackle.
**Fix:** Zero-copy worker handoff: transfer getChannelData()'s underlying ArrayBuffer DIRECTLY (in the postMessage transfer list) instead of copy.set-ing into a fresh Float32Array. Detach-safety verified: the AudioBuffer + its AudioContext are discarded/close()'d immediately after analyzeAudioBufferInWorker returns (audioAnalysis.ts analyzeTrackFromUrl, sole caller; buffer is a function-local never read post-call, context.close in finally ~L226-231) so detaching the channel buffers is harmless. Correctness guard: zero-copy only when the channel view exactly spans its own ArrayBuffer (byteOffset 0, full length — always true in Chromium WebAudio); else per-channel copy fallback. Eliminates the ~170MB main-thread memcpy. Marks the (c) residual item from the voice-7421 diagnosis as RESOLVED.
**Commit:** b954f75-PR
**Guard:** trackAnalysisClient.test.ts: new 'zero-copy transfer safety (v3.300)' describe block — (1) source-inspection test asserting analyzeTrackFromUrl never reads the AudioBuffer after the worker call (fails if someone adds a post-analysis buffer.getChannelData/numberOfChannels/return buffer), (2) zero-copy correctness test. All 500 renderer tests + typecheck + full build green.
---

---
**Date:** 2026-06-11T22:03:43Z
**Trigger:** voice 7421
**Symptom:** Crackle/glitch in audio when switching tracks during playback (voice 7421, still reported at v3.299 — Ethan hypothesis: LUFS/stats loading competes with audio thread)
**Root cause:** Original root cause (his hypothesis) was CORRECT and already largely fixed across v3.225->v3.237->v3.240->v3.263->v3.296: renderer-main-thread CPU (per-sample analysis loops + decode) starved the audio engine's high-res scheduling during play-start. Already-fixed: (1) measured LUFS/true-peak/bit-depth run in MAIN PROCESS via ffmpeg IPC (window.producerPlayer.analyzeAudioFile) — fully off renderer thread; (2) per-sample JS loops (mono mixdown, peak/RMS, tonal balance, frame loudness, waveform peaks) moved into a dedicated Web Worker in v3.240 (trackAnalysisWorker.ts); (3) splice-click handled by 15ms gain.linearRampToValueAtTime crossfade around audio.src swap (App.tsx commitSourceSwitch ~L10152-10225); (4) analysis kickoff deferred 1250ms (preview) / 900ms (measured) past play-start via startDelayMs (App.tsx L900-902). RESIDUAL main-thread costs that survive on the renderer during the deferred window (can still crackle on rapid A<->B<->A switching or long/large files): (a) fetch(url)+response.arrayBuffer() reads whole file into renderer memory (audioAnalysis.ts L195-200); (b) AudioContext.decodeAudioData promise-resolution + large AudioBuffer alloc touches main (audioAnalysis.ts L207); (c) extractTransferableChannels does a full copy.set(source) memcpy of EVERY channel (~170MB for a 4-min stereo 44.1k track) on the renderer main thread before transferring to the worker (trackAnalysisClient.ts L152-167).
**Fix:** DIAGNOSIS ONLY this pass (no code shipped). Multi-threading is ALREADY the answer and is ALREADY implemented — Ethan hypothesis confirmed but the work is mostly done. Recommended residual fix (contained, low-risk): in trackAnalysisClient.ts extractTransferableChannels, transfer getChannelData()'s underlying ArrayBuffer ZERO-COPY instead of copy.set — the defensive copy exists only to avoid detaching the AudioBuffer, but the AudioBuffer + its AudioContext are discarded/closed immediately after the worker call (audioAnalysis.ts finally L229-231 context.close), so detach-safety is moot. Eliminates the ~170MB main-thread memcpy. Bigger optional win: move fetch+decode off renderer entirely (decode WAV/AIFF PCM in the main process or an OfflineAudioContext path), or skip the preview WebAudio decode for scalar readouts (LUFS already comes from ffmpeg IPC; preview decode only feeds waveform peaks + tonal balance + realtime graph).
**Commit:** n/a-diagnosis-only
**Guard:** Existing: trackAnalysisClient.test.ts (worker fallback), audioAnalysisQueue.test.ts. A zero-copy-transfer change must keep a regression test asserting the AudioBuffer is not read after analyzeAudioBufferInWorker returns.
---

---
**Date:** 2026-05-30T23:56:19Z
**Trigger:** voice 7230
**Symptom:** Bit-depth segment still missing in Inspector after v3.274 LUFS+cache-mirror fixes — Ethan voice 7230 reported it still wasn't showing
**Root cause:** Single-source bit-depth extraction in main.ts relied on ffprobe's bits_per_raw_sample OR bits_per_sample + float-only sample_fmt inference. When all three returned null/0 (edge codec paths, exotic WAV headers, transient ffprobe failures), bit depth was forever null. The v3.272 once-per-session refresh guard then marked the version as 'already-refreshed' so it never retried even on later launches — entire albums permanently capped at sample-rate-only display.
**Fix:** apps/electron/src/bit-depth-fallback.ts (NEW pure module) + apps/electron/src/main.ts (rewired analyzeAudioFile probe). Six-step fallback chain in confidence order: (1) ffprobe bits_per_raw_sample, (2) ffprobe bits_per_sample, (3) ffprobe sample_fmt inference EXTENDED to all int formats (u8/s16/s24/s32/s64 — was only float in v3.269), (4) ffprobe codec_name inference (NEW — pcm_s16le/s24le/s32le/f32le/f64le + alac=24), (5) direct WAV/AIFF/FLAC header parse from first ~64 KiB of file (NEW — non-destructive, metadata-only, single fs.read, no decode), (6) extension-hint short-circuit for known-lossy extensions returns clean null. Each step carries a source tag we log when ANY fallback fires (not when step 1 wins) so we can see in production logs which path is bearing load.
**Commit:** 66a6b90 (shipped as v3.275) + codex-review follow-ups 64aa687 (shipped as v3.276). Follow-ups: (1) reordered chain to make codec_name lossy-detection (step 2a) and PCM-name inference (step 2b) fire BEFORE sample_fmt — was reporting MP3/AAC as 32-bit because their decoders emit fltp frames; (2) added DEFERRED_CODEC_NAMES set with `flac` so codecs whose decoder output sample_fmt doesn't match source depth skip step 3 and drop straight to header parse; (3) WAV parser now requires fmt chunkSize≥16 + validates cbSize≥22 before trusting wValidBitsPerSample; (4) post-Promise.all cancellation check in analyzeAudioFile because readAudioFileHeader is an in-process fs.read with no SIGKILL hookup; (5) tightened telemetry log gate to also exclude 'ffprobe-bits-per-sample' (the common pcm_s16le case) so steady-state PCM doesn't spam logs.
**Guard:** 62 node:test cases in apps/electron/test/bit-depth-fallback.test.cjs covering every step + every header format + the orchestrator's full chain ordering + 8 dedicated codex-fix regressions (mp3/aac/opus with fltp, pcm_s24le with s32 sample_fmt, alac with fltp, flac defers to header, WAVE_FORMAT_EXTENSIBLE cbSize=0 fallback, fmt chunkSize<16 rejection). Tests include the Ethan thedrums case (s16/16-bit WAV via step 2), pure-codec_name resolution, header-only fallback when ffprobe fails entirely, and the lossy short-circuit. Synthetic WAV/AIFF/FLAC headers are byte-constructed in the test so we cover RIFX/RF64/WAVE_FORMAT_EXTENSIBLE/AIFC/FLAC-STREAMINFO edge cases without real fixtures. Telemetry log entry on every non-trivial fallback gives runtime visibility.
---

---
**Date:** 2026-05-30T21:38:23Z
**Trigger:** Ethan voice 7225 (2026-05-30)
**Symptom:** Every main-list-row LUFS column showed 'Loading' indefinitely after installing v3.270/v3.271; bit-depth still missing in inspector
**Root cause:** v3.270 tightened isMasteringCacheEntryFresh to invalidate entries with bitDepth=null on lossless sources. But the SAME freshness check gates LUFS display at App.tsx:18519 (activeSongIntegratedLufsStatus), so every fresh entry with missing bit-depth had its valid integratedLufs HIDDEN and flipped to status='loading'. With ~71 album entries needing re-analysis sequentially via NEIGHBOR-priority queue, LUFS appeared stuck. Worse: if any re-analysis returned bitDepth=null (ffprobe failure / weird WAV header), the new entry would immediately fail freshness again → infinite re-analysis loop.
**Fix:** Decoupled the two concerns. isMasteringCacheEntryFresh reverts to schema+cacheKey only (LUFS reads use cached value instantly). New isMasteringCacheEntryMissingBitDepth predicate flags entries needing bit-depth refresh — drives DISPATCH only, never gates READS. Inspector dispatch (App.tsx:7565) and warmup dispatch (App.tsx:8060) check both — full re-analysis when not fresh, background-only refresh when fresh-but-missing-bit-depth (keeps row at 'ready'/'fresh' state, no Loading flash). Two codex-review follow-ups: (b4fa5c8) inspector dispatch ALSO mirrors the fresh measured analysis into masteringCacheByVersionId via upsertMasteringCacheEntry so the sample-rate text formatter (which reads the global cache first and `continue`s on a hit) sees the filled-in bit-depth; added masteringCacheBitDepthRefreshedVersionIdsRef once-per-session guard to prevent infinite re-dispatch if ffprobe returns bitDepth=null again on retry. (c9c7ca3) inspector skip-when-ready-or-loading guard was widened to skip-when-loading OR (ready AND !isMissingBitDepth) so already-hydrated rows still get the bit-depth refresh; the once-per-session mark moved into a `probeYieldedResult` boolean set true ONLY on success or genuine error — AbortError returns leave it false so requeued retries still get a shot.
**Commit:** 220031d (+ follow-ups b4fa5c8, c9c7ca3 — shipped as v3.272 → v3.273 → v3.274)
**Guard:** 10 vitest cases in masteringAnalysisCache.test.ts asserting (a) bitDepth=null on PCM/lossless sources STAYS FRESH (so LUFS renders) and (b) the new isMasteringCacheEntryMissingBitDepth predicate flags exactly those cases for refresh. Also covers the non-fresh entry case where the bit-depth signal must NOT fire (would double-dispatch). Effect-level coverage of the cache-mirror upsert + once-per-session guard is gap — would need an App-render harness; lower priority because the unit predicates pin the load-bearing decisions.
---

---
**Date:** 2026-05-30T21:32:38Z
**Trigger:** Ethan voice 7223 (2026-05-30)
**Symptom:** PP Check for Updates returned no updates on v3.270 install
**Root cause:** PP IS on the latest published release (v3.270 is current). electron-updater correctly reports 'up to date'. The appcast.xml 404 on GitHub Pages is a red herring — PP uses electron-updater with provider='github' (reads latest-mac.yml from GH release directly), not Sparkle/appcast.
**Fix:** Patch-bumped 3.270.0 → 3.271.0 + pushed. Auto-release-on-push workflow then publishes v3.271, which the v3.270 install will see on next Check for Updates click.
**Commit:** 80f9972
**Guard:** n/a — this isn't a code bug, just user expectation of finding updates when already on latest. Doc note: PP DOES NOT use appcast.xml; provider is 'github' in apps/electron/src/main.ts:1605-1609.
---

---
**Date:** 2026-05-29T21:46:20Z
**Trigger:** Ethan voice 7213 (2026-05-29)
**Symptom:** Inspector bit-depth segment wrapped onto a new line below 'Sample rate:' instead of staying inline; cached entries with bitDepth=null at schemaVersion=2 never re-analysed
**Root cause:** 1) .version-row left column had no flex rules so the middle-dot · was a soft wrap point in the constrained intrinsic width. 2) isMasteringCacheEntryFresh only checked schemaVersion+cacheKey — entries written mid-install at schema=2 with bitDepth=null were trusted as fresh.
**Fix:** 1) .version-row > div:first-child { flex: 1 1 auto; min-width: 0 } + white-space: nowrap on the sample-rate/integrated-lufs <p>. 2) Tightened isMasteringCacheEntryFresh: if bitDepth is null AND sampleFormat is PCM (s16/s24/s32/flt/dbl) OR file extension is lossless (wav/aiff/flac/alac), force re-analysis. mp3/m4a with null bitDepth stays fresh.
**Commit:** 6a03a17
**Guard:** 6 vitest regression cases in masteringAnalysisCache.test.ts covering null-bitDepth × {PCM sampleFormat, planar fltp, null+lossless ext, null+lossy ext, concrete bitDepth}
---

---
**Date:** 2026-05-29T20:42:10Z
**Trigger:** Ethan voice 7199 (2026-05-29): floating selection → Add to chat feature
**Symptom:** Adding a portalled selection tooltip into a panel with overflow:auto needed a forwardRef handle on the existing composer
**Root cause:** AgentComposer owned its own text state; lifting all text up would touch mic/auto-resize/send paths
**Fix:** Convert AgentComposer to forwardRef<AgentComposerHandle, Props> + useImperativeHandle exposing only appendQuotedSelection(text). Parent calls handle.appendQuotedSelection on tooltip click. Pure-logic helpers (trim, blockquote, position math) live in agentChatSelection.ts with 27 vitest unit tests.
**Commit:** 97c2365
**Guard:** agentChatSelection.test.ts pins the helpers (truncate cap, blockquote format, append-no-overwrite, tooltip position math incl. viewport-edge + container clamp)
---
