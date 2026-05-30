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
**Date:** 2026-05-30T21:38:23Z
**Trigger:** Ethan voice 7225 (2026-05-30)
**Symptom:** Every main-list-row LUFS column showed 'Loading' indefinitely after installing v3.270/v3.271; bit-depth still missing in inspector
**Root cause:** v3.270 tightened isMasteringCacheEntryFresh to invalidate entries with bitDepth=null on lossless sources. But the SAME freshness check gates LUFS display at App.tsx:18519 (activeSongIntegratedLufsStatus), so every fresh entry with missing bit-depth had its valid integratedLufs HIDDEN and flipped to status='loading'. With ~71 album entries needing re-analysis sequentially via NEIGHBOR-priority queue, LUFS appeared stuck. Worse: if any re-analysis returned bitDepth=null (ffprobe failure / weird WAV header), the new entry would immediately fail freshness again → infinite re-analysis loop.
**Fix:** Decoupled the two concerns. isMasteringCacheEntryFresh reverts to schema+cacheKey only (LUFS reads use cached value instantly). New isMasteringCacheEntryMissingBitDepth predicate flags entries needing bit-depth refresh — drives DISPATCH only, never gates READS. Inspector dispatch (App.tsx:7565) and warmup dispatch (App.tsx:8060) check both — full re-analysis when not fresh, background-only refresh when fresh-but-missing-bit-depth (keeps row at 'ready'/'fresh' state, no Loading flash).
**Commit:** PENDING
**Guard:** 10 vitest cases in masteringAnalysisCache.test.ts asserting (a) bitDepth=null on PCM/lossless sources STAYS FRESH (so LUFS renders) and (b) the new isMasteringCacheEntryMissingBitDepth predicate flags exactly those cases for refresh. Also covers the non-fresh entry case where the bit-depth signal must NOT fire (would double-dispatch).
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

