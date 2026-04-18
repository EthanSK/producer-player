# Mastering Checklist — Audit and Expansion Plan

Status: research + design, not yet implemented. Ethan reviews, approves scope,
then a separate build subagent implements. No code changes are made in this
document.

## 1. Context

Today the Mastering Checklist renders inline at
`apps/renderer/src/App.tsx` around line 13922 as a summary of four pass/warn/fail
rows. There is no separate rule engine — the four checks are hard-coded in JSX
against two analysis sources:

- `measuredAnalysis: AudioFileAnalysis` — authoritative ffmpeg `ebur128` +
  `volumedetect` result produced in `apps/electron/src/main.ts`
  (`analyzeAudioFile`). Contains proper ITU-R BS.1770 values:
  `integratedLufs`, `loudnessRangeLufs`, `truePeakDbfs`, `samplePeakDbfs`,
  `meanVolumeDbfs`, `maxMomentaryLufs`, `maxShortTermLufs`, `sampleRateHz`.
- `analysis: TrackAnalysisResult` — client-side Web Audio result produced in
  `apps/renderer/src/audioAnalysis.ts`. Contains `peakDbfs`,
  `integratedLufsEstimate` (NB: actually raw RMS in dBFS, not K-weighted LUFS —
  the field name is misleading), `rmsDbfs`, `crestFactorDb`, `dcOffset`,
  `clipCount`, `tonalBalance` (3-band low/mid/high energy ratio), plus framed
  loudness/waveform peaks.

Platform-normalization targets (Spotify, Apple Music, YouTube, Tidal, Amazon)
live in `apps/renderer/src/platformNormalization.ts` and are already
reference-grade (cited, verified March 2026). The checklist itself, however,
uses a generic safe range, not per-platform targets — which aligns with
Ethan's guidance ("one master for multiple streaming platforms").

## 2. Existing 4 checks — audit

| # | Check | Current rule | Verdict | Notes |
|---|---|---|---|---|
| 1 | **LUFS** | pass if `-16 ≤ integratedLufs ≤ -6`, else warn | Mostly correct; range is too wide on the loud side | Spotify/YouTube/Tidal/Amazon normalize to -14 LUFS. Apple Music at -16. Below -20 LUFS is unambiguously too quiet for commercial distribution (Apple will upgain but you lose headroom); above -7 LUFS is crushed. A better platform-agnostic *recommended* band is **-16 to -8 LUFS** (warn below -20 or above -7, acceptable -16..-8, ideal -14..-9). The current `>= -6` upper limit lets -7 LUFS pass silently which is already obviously over-limited. |
| 2 | **True Peak** | pass if `truePeakDbfs < -1`; warn if `-1 ≤ x < 0`; fail if `≥ 0` | Correct; target is the universal safe value | -1 dBTP covers Spotify, Apple Music, YouTube, Tidal. Amazon recommends -2 dBTP but -1 is still accepted. **Minor bug:** the icon render is `'\u2713'` (check) for pass *or* `'\u26a0'` (warn) for anything else, which means the `fail` class fires but the icon stays a warning triangle — there is no distinct fail icon. Same applies to DC Offset and Clipping rows. |
| 3 | **DC Offset** | pass if `abs(dcOffset) ≤ 0.001`; else warn | Correct threshold, but sourced from Web Audio decoded float — see caveat | 0.001 ≈ 0.1% FS ≈ -60 dBFS mean, which is the standard consumer-audible threshold. Note the value is computed from `AudioContext.decodeAudioData` output, which on some browsers/platforms silently applies a high-pass or normalises clip-protection, so occasional false negatives are possible. If reliability matters, reuse ffmpeg's `mean_volume` from volumedetect as a cross-check. |
| 4 | **Clipping** | pass if `clipCount === 0`; else fail | Too strict at the per-sample level; misses inter-sample peaks | `countClips` counts samples where `|x| >= 1.0` in the decoded float. That's correct for hard digital clipping in the decoded PCM, but: (a) one or two count=1/2 clips can happen in legitimate masters after resampling and flagging as an outright fail is aggressive; (b) inter-sample peaks (ISPs) that would clip after lossy encoding are invisible here — that's what true peak (check 2) catches. Recommend softening to warn at 1–3 samples, fail at ≥4 consecutive or >0.005% of samples, and rely on check 2 for ISP. |

**Summary of existing-check bugs:**

1. **Icon regression on fail rows** — fail-state rows use the warning glyph
   `⚠` instead of a distinct fail glyph (e.g. `✗` or red circle).
   Cosmetic but misleading.
2. **LUFS upper bound too permissive** — -6 LUFS allows visibly crushed
   masters to show a pass. Tighten to -8 for pass, warn -8..-7, fail >-7.
3. **Clipping binary pass/fail is too strict** — a single post-resample sample
   at -0.01 dBFS reads as a fail today. Graduate to warn/fail tiers.
4. **Field-name confusion** — `integratedLufsEstimate` in `TrackAnalysisResult`
   is raw RMS dBFS, not K-weighted LUFS. Not a checklist bug (checklist uses
   the ffmpeg value), but rename or document to prevent future misuse.
5. **No handling of `null` measuredAnalysis values** — if ffmpeg fails to emit
   a True Peak line, `truePeakDbfs` is `null` and the row shows "Not measured"
   in the value but still renders a pass/warn class because `null < -1` is
   falsy in JS. The class falls through to `fail`. Render a neutral
   "unavailable" state instead.

## 3. Proposed additions

Target: 10–15 new checks, platform-agnostic. Priority tiers:

- **must-have** — universally useful, low compute, high catch rate
- **should-have** — useful, moderate cost or some false-positive risk
- **nice-to-have** — genre/context-dependent, only flag when values are
  egregious

Computation cost is measured relative to *reusing existing analysis we already
run* (ffmpeg ebur128 + Web Audio decoded floats + frame loudness). "Cheap"
means it falls out of fields already on `AudioFileAnalysis` or
`TrackAnalysisResult`; "medium" means we need another single-pass loop over
the decoded samples; "extra pass" means a new ffmpeg filter or FFT pass.

| # | New check | Rule / threshold | Source | Compute cost | Priority |
|---|---|---|---|---|---|
| A1 | **Loudness Range (LRA)** | warn if `loudnessRangeLufs < 4 LU` (over-compressed) or `> 15 LU` (too dynamic for streaming without normalisation pumping); fail if `< 2 LU` | `measuredAnalysis.loudnessRangeLufs` | cheap (already measured) | must-have |
| A2 | **Short-term vs integrated gap** | warn if `maxShortTermLufs - integratedLufs > 6 LU`; fail if `> 10 LU`. Big gap = limiter pumping or huge transients | `measuredAnalysis.maxShortTermLufs - integratedLufs` | cheap (already measured) | must-have |
| A3 | **Momentary peak loudness** | warn if `maxMomentaryLufs > -5 LUFS` (momentary overshoot that will trigger platform limiting); fail if `> -3 LUFS` | `measuredAnalysis.maxMomentaryLufs` | cheap (already measured) | should-have |
| A4 | **Crest factor / PLR** | warn if `crestFactorDb < 8 dB` (heavily limited); fail if `< 6 dB` (crushed). Nice-to-have for EDM but universally poor below 6. | `analysis.crestFactorDb` | cheap (already measured) | must-have |
| A5 | **Sample peak vs true peak delta (ISP risk)** | warn if `truePeakDbfs - samplePeakDbfs > 0.5 dB` AND `truePeakDbfs > -1 dBTP`. High inter-sample overshoot = AAC/MP3 clipping risk | `measuredAnalysis.truePeakDbfs - samplePeakDbfs` | cheap (already measured) | should-have |
| A6 | **Subsonic rumble / DC-adjacent energy** | warn if tonalBalance.low band spans most of the headroom and significant energy sits <30 Hz. Practical proxy: warn if `tonalBalance.low > 0.55` | `analysis.tonalBalance.low` (proxy) or new HPF-split pass for <30 Hz | cheap (proxy) / medium (true <30 Hz band) | should-have |
| A7 | **Spectral balance — bass-heavy** | warn if `tonalBalance.low > 0.50` (muddy) or `tonalBalance.low < 0.15` (thin) | `analysis.tonalBalance` | cheap (already measured) | should-have |
| A8 | **Spectral balance — harsh / dull** | warn if `tonalBalance.high > 0.25` (harsh/brittle) or `tonalBalance.high < 0.03` (dull/dark) | `analysis.tonalBalance` | cheap (already measured) | should-have |
| A9 | **Leading/trailing silence trim** | warn if leading silence > 1 s *or* > 3 s, warn if trailing silence > 3 s before -60 dBFS decay. Auto-detect via first/last frame loudness below -60 dBFS | `analysis.frameLoudnessDbfs` scan from both ends | cheap (already computed) | must-have |
| A10 | **Sample rate conformance** | warn if `sampleRateHz` not in `{44100, 48000, 88200, 96000}`; info if in 88.2/96 (fine, but note downsample for distribution) | `measuredAnalysis.sampleRateHz` | cheap (already measured) | must-have |
| A11 | **Clip count tiers** (replace existing binary) | pass 0; warn 1–3; fail ≥4 *or* any 3+ consecutive samples at ±1.0 | `analysis.clipCount` today; consecutive-run detection adds one extra pass | cheap (already mostly computed) | must-have |
| A12 | **Mono compatibility (L+R sum loss)** | warn if summed-mono integrated loudness drops more than 3 dB vs stereo; fail if > 6 dB | new ffmpeg pass with `pan=mono\|c0=0.5*c0+0.5*c1,ebur128` or renderer-side L+R sum loop | extra pass (ffmpeg filter or client loop) | should-have |
| A13 | **Phase correlation (mean)** | warn if sustained correlation < 0.3 over > 10% of track; fail if mean < 0 | new pass: correlate per-frame L vs R, sliding window | extra pass | should-have |
| A14 | **Stereo width / side energy** | warn if mid/side ratio flips (|side| > |mid|) for >5% of track, especially <300 Hz | needs M/S split; could share the mono-compat pass | extra pass | nice-to-have |
| A15 | **Noise floor between quiet sections** | warn if lowest 1% of frame loudness > -60 dBFS (suggests tape hiss, bus noise, reverb tails with bleed) | `analysis.frameLoudnessDbfs` percentile | cheap (already computed) | nice-to-have |
| A16 | **Over-limiting duration** | warn if >50% of short-term windows within 1 LU of `maxShortTermLufs` (indicates limiter riding the ceiling); fail at >75% | iterate `frameLoudnessDbfs` with threshold | cheap (already computed) | nice-to-have |
| A17 | **Bit depth / dithering hint** | info if project SR > 48 kHz or source-is-float and export path shows 16-bit target: "remember to dither for 16-bit distribution" | not currently measured — requires source container metadata via ffprobe | medium (new ffprobe field) | nice-to-have |
| A18 | **Truncated tail** | warn if the last 100 ms has energy > -40 dBFS and the file ends without a smooth decay | `analysis.frameLoudnessDbfs` tail scan | cheap (already computed) | should-have |

Total: 18 candidate additions. With A11 replacing the existing clipping rule
and A6 folding into A7 if we keep the 3-band proxy, the practical delivered
set lands around 12–15 checks.

### Platform handling

All proposed rules are platform-agnostic. Where a single platform matters
most for a threshold choice (e.g. True Peak -1 dBTP vs Amazon's -2), we pick
the **safer/tighter** value — -1 dBTP is universal across Spotify/Apple/YT/Tidal
and close enough to Amazon that the delta is a separate, optional hint. The
checklist row can include a short inline platform note when the target
differs, e.g. "below -1 dBTP — safe across Spotify/Apple/YouTube/Tidal; use
-2 dBTP if targeting Amazon Music specifically."

## 4. Phased rollout

### Phase 1 — reuse existing analysis (no new compute)

Ship these first. Every value is already on `measuredAnalysis` or
`TrackAnalysisResult`. This alone roughly triples the checklist's coverage.

- Fix existing-check bugs: icon regression, LUFS upper bound, clipping tiers,
  null-value handling.
- A1 Loudness Range
- A2 Short-term vs integrated gap
- A3 Momentary peak loudness
- A4 Crest factor / PLR
- A5 Sample peak vs true peak delta
- A7 Spectral balance — bass
- A8 Spectral balance — treble
- A9 Leading/trailing silence
- A10 Sample rate conformance
- A11 Clip count tiers (replacement)
- A15 Noise floor (optional)
- A16 Over-limiting duration (optional)
- A18 Truncated tail

Also: extract the rule logic out of inline JSX into a single
`masteringChecklistRules.ts` module (one function per rule, one array of
`{ id, label, evaluate(input): { status, message } }`), with a test file.
Covers the "8–15 additional items" scope and fixes maintainability.

### Phase 2 — new analysis passes

Requires touching `analyzeAudioFile` in `apps/electron/src/main.ts` or adding
a renderer-side L/R pass before mono-folding.

- A6 Subsonic rumble <30 Hz (new highpass + energy ratio, or additional
  tonalBalance band)
- A12 Mono compatibility (L+R sum ebur128 pass)
- A13 Phase correlation
- A14 Stereo width / side energy
- A17 Bit depth / dither hint (extra ffprobe field)

Suggested order: A12 → A13 → A14 share the L/R analysis machinery, so add
them together. A17 is trivial but low-value until a bit-depth export flow
exists.

## 5. UX notes (non-blocking)

- Keep the checklist inline-on-mastering-panel as today. Don't move to a modal.
- Once rule count doubles, group rows by category: Loudness · Peaks · Dynamics
  · Stereo · Spectrum · Housekeeping. Default all groups expanded; allow
  collapsing.
- Per-row icons: `✓` pass, `⚠` warn, `✗` fail, `–` unavailable.
- Each row already has the data for a one-line "why this matters / how to
  fix"; reuse the existing `HelpTooltip` pattern rather than invent new copy.

## 6. Codex opinion (verbatim)

> | # | Check | Suggested Threshold / Rule | Why It Matters | Compute Expense |
> |---:|---|---|---|---|
> | 1 | **True peak ceiling** | Max true peak ≤ **-1.0 dBTP**; safer: **-1.5 dBTP** for loud/bright masters | Reduces codec clipping after AAC/Opus/MP3 encoding | Low |
> | 2 | **Integrated loudness** | Target range: **-16 to -9 LUFS-I**; flag below **-20** or above **-7 LUFS-I** | Ensures the master is not extremely quiet or crushed before platform normalization | Low |
> | 3 | **Short-term loudness spikes** | Flag sustained sections above **-6 LUFS-S** or sudden jumps > **6 LU** | Catches overly aggressive drops, choruses, or transitions | Low |
> | 4 | **Loudness range / dynamics** | Typical flag: **LRA < 3 LU** or **LRA > 18 LU** | Detects over-compression or uncontrolled dynamic swings | Low |
> | 5 | **Peak-to-loudness ratio** | PLR / crest factor: flag **< 6 dB** for most music; **< 4 dB** severe | Good proxy for excessive limiting and distortion risk | Low |
> | 6 | **Inter-sample peak / codec headroom simulation** | Encode-preview or oversampled true peak should stay ≤ **0 dBTP**, ideally ≤ **-1 dBTP** | Finds clipping that appears only after lossy encoding | Medium |
> | 7 | **Digital clipping** | Flag consecutive full-scale samples, flat-tops, or sample peaks ≥ **0 dBFS** | Catches hard clipping, export errors, or limiter overs | Low |
> | 8 | **DC offset** | Mean amplitude should be near **0**; flag offset > **-60 dBFS** or > **0.1% FS** | Prevents wasted headroom and asymmetric clipping | Low |
> | 9 | **Low-frequency mono compatibility** | Below **100-150 Hz**, side energy should be controlled; flag side/mid ratio > **-12 dB** | Helps translation on clubs, vinyl-adjacent systems, phones, and mono playback | Medium |
> | 10 | **Mono collapse correlation** | Correlation should generally stay **> 0**; flag sustained **< -0.2** | Detects phase cancellation and disappearing elements in mono | Low |
> | 11 | **Stereo width extremes** | Flag sustained side energy > mid energy, especially below **300 Hz** | Finds unstable or exaggerated stereo imaging | Medium |
> | 12 | **Spectral balance** | Compare against genre-agnostic reference bands; flag strong deviations: e.g. bass/low-mid/treble bands ± **6 dB** from expected slope | Catches dull, harsh, boomy, or thin masters | Medium |
> | 13 | **Sub-bass / infrasonic energy** | Flag excessive energy below **20-30 Hz**, e.g. RMS within **12 dB** of 40-80 Hz band | Prevents wasted headroom and limiter pumping | Low |
> | 14 | **Silence, fades, and tails** | Start silence < **500 ms** unless intentional; end tail should decay below **-60 dBFS** before cutoff | Catches truncated reverb, accidental silence, bad fades | Low |
> | 15 | **Export format integrity** | Verify sample rate, bit depth, channel count, duration, no NaNs/infs; common delivery: **24-bit WAV/AIFF**, **44.1 or 48 kHz**, stereo | Catches broken bounces and metadata/export mismatches | Low |
>
> **Practical default gate:** fail on true peak above **-1.0 dBTP**, digital clipping, DC offset, broken export, truncated tail, or serious mono cancellation. Treat loudness, dynamics, spectral balance, and stereo width as warnings unless the app has genre/context awareness.

### Where Codex agrees with this plan

- -1 dBTP as universal True Peak ceiling (this plan keeps existing threshold).
- LRA bounds, PLR bounds, DC threshold, silence/tails, sample rate / export
  integrity — all match Phase 1 here.
- Short-term loudness spikes ≈ A2 (short-term vs integrated gap) + A3
  (momentary peak).
- Fail-vs-warn default gate matches the bug-fix item about clipping tiers.

### Where Codex goes further or disagrees

- **Codex #6** splits True Peak into "current TP" and "encode-preview TP".
  This plan folds that into A5 (sample-vs-true-peak delta) as a cheaper
  proxy. A true encode-preview pass (Opus/AAC round-trip) is a bigger
  engineering project; deferred beyond Phase 2.
- **Codex #9 + #11** emphasise low-frequency mono compatibility specifically
  (<100–150 Hz side/mid). This plan treats it as nice-to-have (A14); worth
  promoting to should-have if Ethan cares about club/vinyl translation.
- **Codex #12** spectral balance references a genre-agnostic slope. The
  existing 3-band `tonalBalance` is coarser than Codex suggests. Matches A7/A8
  but at lower resolution; if we want Codex's fidelity we'd need an FFT
  average and a pink-noise-slope reference, which is a Phase 3 item.
- **Codex #15** export format integrity (channel count, duration, NaNs)
  partly overlaps A10 (SR) + A17 (bit depth). Worth expanding A17 to cover
  channel count and file integrity.

## 7. Open questions for Ethan

1. Should the checklist *ever* be platform-specific (e.g. a dropdown to flip
   LUFS/TP targets), or is the platform-agnostic default permanent?
2. Acceptable perf budget for Phase 2 passes — an extra ffmpeg pass roughly
   doubles analysis time. Worth it for mono-compat + correlation?
3. Collapse categories (Loudness/Peaks/Dynamics/Stereo/Spectrum/Housekeeping)
   once the list grows past ~8 rows, or keep flat?
4. A17 dither hint — is there a Producer Player export flow that would surface
   this, or is it orphaned until one exists?
