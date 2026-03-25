# Help Surface Audit — 2026-03-25

Scope requested: audit every user-facing help tooltip/dialog surface and every tutorial video link across Producer Player app + website, then fix mismatched/random links.

## Audit method

- Added automated audit script: `scripts/audit/help-surface-audit.mjs`
- Script inventory sources:
  - `apps/renderer/src/App.tsx` (all `<HelpTooltip />` instances)
  - `apps/renderer/src/helpTooltipLinks.ts` (all tutorial link sets)
  - `site/index.html` (embedded website help/video surfaces)
- Script validates each tutorial URL via YouTube oEmbed metadata and flags mismatches:
  - Topic mismatch (set topic vs label/title keywords)
  - Label/title drift (label no longer matches fetched video title)

## Coverage inventory

- App HelpTooltip instances: **46**
- App HelpTooltip instances with tutorial links: **39**
- App HelpTooltip instances without links: **7**
- Distinct tutorial link sets: **24**
- Tutorial link placements (sum of all set entries): **72**
- Distinct tutorial URLs: **58**
- Website embedded videos: **1** (`./assets/video/producer-player-explainer-web.mp4`)
- Website help-copy mention audited: **1**

## Issues found (before fixes)

Initial automated pass flagged **10** relevance/mismatch issues concentrated in:

- `LRA_LINKS` (generic LUFS links instead of LRA-focused links)
- `WAVEFORM_LINKS` (EQ/width links not waveform-focused)
- `REFERENCE_TRACK_LINKS` (discussion-style link, weak tutorial relevance)
- `MID_SIDE_LINKS` (label keyword mismatch)
- `MID_SIDE_SPECTRUM_LINKS` (generic depth link)
- `LOUDNESS_HISTORY_LINKS` and `LOUDNESS_HISTOGRAM_LINKS` (label drift vs current YouTube title)
- `SPECTROGRAM_LINKS` (incorrect video ID / wrong destination video)

## Fixes applied

Updated `apps/renderer/src/helpTooltipLinks.ts` to keep tutorial links tightly aligned to their metric/section:

- **LRA_LINKS**
  - Replaced 2 weak/generic links with explicit LRA tutorials
- **WAVEFORM_LINKS**
  - Replaced 2 unrelated links with clipping/waveform-relevant tutorials
- **VECTORSCOPE_LINKS**
  - Replaced stereo test clip with phase/vectorscope-relevant tutorial
- **REFERENCE_TRACK_LINKS**
  - Replaced weak discussion link with practical references workflow tutorial
- **MID_SIDE_LINKS**
  - Normalized label wording to include `Mid/Side`
- **K_METERING_LINKS**
  - Replaced 2 generic Bob Katz links with explicit K-System setup/tutorial links
- **LOUDNESS_HISTORY_LINKS**
  - Updated SoundOracle label to match current live title
- **MID_SIDE_SPECTRUM_LINKS**
  - Replaced generic depth link set with explicit mid/side spectrum (SPAN) tutorials
- **LOUDNESS_HISTOGRAM_LINKS**
  - Updated SoundOracle label to match current live title
- **SPECTROGRAM_LINKS**
  - Corrected iZotope RX spectrogram URL to proper video ID

## Verification after fixes

Re-ran:

```bash
node scripts/audit/help-surface-audit.mjs
```

Result: **0 issues flagged**.

Output artifacts (gitignored, local):

- `artifacts/help-audit/help-surface-audit-latest.json`
- `artifacts/help-audit/help-surface-audit-latest.md`
