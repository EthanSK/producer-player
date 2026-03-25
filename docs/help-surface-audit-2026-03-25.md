# Help Surface Audit — 2026-03-25

Scope requested: audit every user-facing help tooltip/dialog surface and every tutorial video link across Producer Player app + website, fix mismatched/random links, and add a concrete status-card help tooltip in the left sidebar with operational path/backup guidance.

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

- App HelpTooltip instances: **47**
- App HelpTooltip instances with tutorial links: **39**
- App HelpTooltip instances without links: **8**
- Distinct tutorial link sets: **24**
- Tutorial link placements (sum of all set entries): **72**
- Distinct tutorial URLs: **58**
- Website embedded videos: **1** (`./assets/video/producer-player-explainer-web.mp4`)
- Website help-copy mention audited: **1**
- Total help/tutorial surfaces audited (app + website): **49**

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

Added a new sidebar status-card help surface in `apps/renderer/src/App.tsx` (+ supporting layout style in `apps/renderer/src/styles.css`):

- **Status card header help icon**
  - Added a top-right help tooltip in the Status card header.
  - Help text now explains:
    - what status/last scan indicate,
    - exactly what Auto-organize does,
    - watched folder paths currently linked,
    - where Auto-organize archives go (`<linked-folder>/old`),
    - iCloud backup folder path when available,
    - that iCloud backup syncs checklist/ratings/preferences metadata (not audio files), and how to open the path via the Show button.

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
