# Changelog

All notable changes to Producer Player are documented in this file.

This project follows a date-based release cadence with semantic version labels.

## [3.31] - 2026-04-18

### Features
- Mastering: "Show AI recommendations" toggle + "Regenerate" button in the fullscreen overlay (Phase 3a); light-blue per-metric AI recommendation captions under each stat card and Mastering Checklist row (hidden until the v3.33 auto-run lands)

### Polish
- Site: remove Windows "security warning" help expandable from the landing page

## [3.23] - 2026-04-18

### Polish
- Platform Normalization Preview: large applied-reduction readout in fullscreen bubbles
- Platform Normalization + Mastering Checklist: amber "Using Reference" indicator in reference mode
- Listening-device strip: full-width split (input | saved tags), single-row by default, flex-wrap
- Cmd+R reserved for Mix/Reference toggle — no longer reloads the Electron window
- Checklist row hover outline no longer clips on the left edge of the scroll region
- Site: Windows download help note explaining SmartScreen extract-and-run steps

## [2.63] - 2026-04-08

### Features
- Inline Mix/Ref toggle on EQ row, AI EQ applies to selected bands only

## [2.62] - 2026-04-08

### Fixes
- Enforce two-part version format (x.y), prevent non-zero patch

## [2.61] - 2026-04-08

### Fixes
- Accurate Spotify comparison tip, click-free song/reference switching

## [2.59.1] - 2026-04-08

### Fixes
- Fix volume matching tip, clean graph labels, add global Cmd+R shortcut

## [2.59] - 2026-04-08

### Documentation
- Add level match and referencing workflow guidance to help dialog

## [2.58] - 2026-04-08

### Fixes
- Fix AssemblyAI voice transcription in agent chat

## [2.57] - 2026-04-08

### Fixes
- File picker remembers last-used directory

## [2.56] - 2026-04-08

### Fixes
- Move EQ snapshots/state to unified file, add data storage rules to AGENTS.md

### Documentation
- Rewrite README with better focus and website-quality copy

## [2.55] - 2026-04-07

### Documentation
- Add comment explaining level match, platform normalization, and reference interaction

## [2.54.2] - 2026-04-07

### Fixes
- Fix Cmd+R event propagation, immediate EQ snapshot save

## [2.54.1] - 2026-04-07

### Fixes
- Cmd+R reference toggle, custom shortcuts, song switcher stays open, remove duplicate text, verify AI EQ

## [2.54] - 2026-04-07

### Fixes
- Enable HMR for faster dev, bypass EQ for reference tracks, apply platform normalization to reference, migrate EQ snapshots

## [2.53] - 2026-04-07

### Features
- Spectrum hover shows Hz and dB values, full per-track EQ state, R key shortcut for reference toggle, richer AI prompt context, help dialog update, reverse snapshot order

## [2.52] - 2026-04-07

### Features
- Agent notification badge, AI EQ UX improvements, per-track AI recommendations

## [2.51] - 2026-04-07

### Fixes
- Properly disable Swift extension, rename Package.swift

## [2.50] - 2026-04-07

### Maintenance
- Add VS Code settings to disable Swift LSP for this workspace

## [2.49] - 2026-04-05

### Maintenance
- Revert custom hot reload, restore default dev workflow

## [2.48] - 2026-04-05

### Fixes
- Make localStorage migration robust with logging and retry on failure

## [2.47] - 2026-04-05

### Fixes
- Migrate localStorage user data to unified state on first load

## [2.46] - 2026-04-05

### Features
- Enable auto-generated release notes from commits
- Folder-based export/import with localStorage dump

## [2.45] - 2026-04-05

### Features
- Unified user state file with migration, full import/export, iCloud backup

## [2.44] - 2026-04-05

### Fixes
- Auto-update toggle, dismissible banner, consistent version format

## [2.43] - 2026-04-05

### Fixes
- Prevent app freeze on quit by adding SIGKILL escalation and force-exit timeouts

## [2.42] - 2026-04-05

### Fixes
- Replace safeStorage/keychain with obfuscated file storage for API keys

## [2.41] - 2026-04-05

### Fixes
- Version comparison handles two-part format and equal versions

## [2.40] - 2026-04-05

### Features
- Auto-update via electron-updater (download + install without browser)

### Fixes
- Defer safeStorage keychain access to first mic interaction

## [2.38] - 2026-04-05

### Features
- AI-recommended EQ curve + reference difference EQ overlay

## [2.37] - 2026-04-05

### Fixes
- EQ snapshots stored per-track instead of globally

## [2.36] - 2026-04-05

### Features
- Per-source EQ state for A/B, fix tonal balance bar accuracy

## [2.35] - 2026-04-05

### Features
- EQ'd tonal balance preview toggle

## [2.34] - 2026-04-05

### Features
- Hot reload dev workflow with Vite HMR + esbuild watch

## [2.33] - 2026-04-05

### Fixes
- Song switcher plays on click, add EQ on/off toggle

## [2.32] - 2026-04-05

### Features
- Smooth combined EQ curve, EQ snapshots (save/load/restore)

### Maintenance
- Update README with new screenshots matching website

## [2.31.1] - 2026-04-05

### Features
- Add using-reference labels to all sections, horizontal EQ sliders

## [2.31] - 2026-04-04

### Features
- Per-band EQ gain sliders on spectrum analyzer

## [2.30.1] - 2026-04-04

### Fixes
- A/B toggle bottom-left inline, song switcher as floating panel bottom-right

## [2.30] - 2026-04-04

### Features
- Floating Mix/Reference A/B toggle in mastering fullscreen

## [2.29] - 2026-04-04

### Features
- Add quick song-switcher panel in mastering fullscreen

## [2.28] - 2026-04-04

### Fixes
- Change album checklist to text button matching Organize/Export style

## [2.27] - 2026-04-04

### Features
- Add global album checklist button next to Rescan

## [2.26] - 2026-04-04

### Features
- Add minus sign to Applied reduction value

## [2.25] - 2026-04-04

### Fixes
- Version tracking → version management in hero subtitle

## [2.24] - 2026-04-04

### Fixes
- Mid/side monitoring + visualizations during reference playback

## [2.23] - 2026-04-03

### Fixes
- Center and enlarge screenshot hover expand icon

## [2.22] - 2026-04-03

### Fixes
- Smoother fades, longer slide duration (5s per scene)

## [2.21] - 2026-04-03

### Fixes
- Improve lightbox hover UX, add expand icon on screenshots

## [2.20] - 2026-04-03

### Features
- Album art fullscreen preview on hover

## [2.19] - 2026-04-03

### Fixes
- Revert to simple fades, consistent titles, reorder scenes, rename album view

## [2.18] - 2026-04-03

### Fixes
- Remove build metadata from displayed version

## [2.17] - 2026-04-03

### Fixes
- Display version as two-part (2.16), fix album art color profile

## [2.16] - 2026-04-03

### Features
- Voice input UX overhaul + app logging system

## [2.15] - 2026-04-03

### Features
- Switch to two-part versioning (x.y), tighten screenshot gap

### Fixes
- One window → one app

## [2.0.14] - 2026-04-03

### Fixes
- Update wording, add AI mention to tutorials caption

## [2.0.13] - 2026-04-03

### Fixes
- Tighten caption gap, add screenshot lightbox

## [2.0.12] - 2026-04-03

### Features
- Re-research and upgrade all tutorial video links

## [2.0.11] - 2026-04-03

### Features
- Wacky transitions, new screenshots, reordered scenes, authentic tutorials

## [2.0.10] - 2026-04-03

### Features
- Add tutorials screenshot, equal grid layout

## [2.0.9] - 2026-04-03

### Fixes
- Remove card backgrounds from download section, update gallery heading

## [2.0.8] - 2026-04-03

### Fixes
- Restore original PNGs with transparency, revert dark bg flatten

## [2.0.7] - 2026-04-03

### Fixes
- Flatten screenshots onto dark bg, new hero image

## [2.0.6] - 2026-04-03

### Fixes
- Compress audio to MP3, remove duplicate hero screenshot

## [2.0.5] - 2026-04-03

### Features
- Reorder scenes, add soundtrack, remove album art, rename to Built-in Tutorials
- Replace all site screenshots with 6 new PNGs and update gallery layout

### Fixes
- Show feature commit message in workflow run titles instead of version bump

## [2.0.3] - 2026-04-03

### Fixes
- Force transparent backgrounds on all screenshot elements

## [2.0.2] - 2026-04-03

### Features
- Add async sample rate metadata to inspector version cards

## [2.0.1] - 2026-04-03

### Maintenance
- Enforce pre-push and CI version bump checks

## [2.0.0-build.294] - 2026-04-03

### Features
- Restructure layout — video first, feature cards with screenshots, remove borders

## [2.0.0-build.293] - 2026-04-03

### Maintenance
- Relicense project to PolyForm Noncommercial 1.0.0

## [2.0.0-build.292] - 2026-04-03

### Maintenance
- Use time jumping wording in checklist Shift+Tab hint

## [2.0.0-build.291] - 2026-04-03

### Fixes
- Remove white border from screenshot images

## [2.0.0-build.290] - 2026-04-03

### Features
- New screenshots gallery, updated explainer video, Remotion source

## [2.0.0-build.289] - 2026-04-03

### Fixes
- Restore checklist shift-tab focus loop and widen song row title

## [2.0.0-build.288] - 2026-04-03

### Fixes
- Align transport skips and restore version/help checklist UX

## [2.0.0] - 2026-04-02

### Features
- Land evening feedback sweep and v2 release prep

## [1.1.9-build.286] - 2026-04-01

### Fixes
- Normalize fixture paths for windows

## [1.1.9-build.285] - 2026-04-01

### Fixes
- Unblock main and windows tests

## [1.1.9-build.284] - 2026-04-01

### Features
- Land producer player recovery pass

## [1.1.9-build.283] - 2026-03-31

### Maintenance
- Rename agent back to Produciboi

## [1.1.9-build.282] - 2026-03-31

### Maintenance
- Refine Producey Boy UI + safe assistant settings reset

## [1.1.9-build.281] - 2026-03-31

### Fixes
- Wrap compact panel title rows with drag/chat controls

## [1.1.9-build.280] - 2026-03-27

### Features
- Allow steer-send while streaming

### Fixes
- Make settings panel scroll instead of clipping
- Ignore stdin EPIPE after stop/interrupt
- Seek playback when typing captures timestamp
- Fix checklist transport focus loop keyboard behavior
- Stop playback-time bottom scroll bounce
- Center open project clear button
- Fix K-meter and crest-factor preview state regressions
- Fix fullscreen loudness/peaks panel alignment
- Prevent header controls overlap with wrapping

### Maintenance
- Update branding copy to Produciboi Agent

## [1.1.9-build.279] - 2026-03-27

### Features
- Add panel-level Ask AI actions across mastering views

### Fixes
- Restore Ask AI panel metadata and typing in mastering UI

### Maintenance
- Wire panel drag controls to Ask AI mastering prompts

## [1.1.9-build.278] - 2026-03-27

### Fixes
- Move mastering drag handles into panel headers

## [1.1.9-build.277] - 2026-03-27

### Features
- Fade checklist visibility by remaining todos

## [1.1.9-build.276] - 2026-03-27

### Fixes
- Move drag handles to header row

## [1.1.9-build.275] - 2026-03-26

### Maintenance
- Clean up normalization copy and remove gain policy cards

## [1.1.9-build.274] - 2026-03-26

### Fixes
- Fix mastering graph hover Y readouts to sample real data values

## [1.1.9-build.273] - 2026-03-26

### Features
- Add one-time first-launch auto-open onboarding for agent panel

## [1.1.9-build.272] - 2026-03-26

### Features
- Add draggable persisted mastering panel layouts

## [1.1.9-build.271] - 2026-03-26

### Fixes
- Fix agent thinking/history session wiring and persistence coverage

## [1.1.9-build.270] - 2026-03-26

### Maintenance
- Refine Produceboi assistant help/history UX and empty-state guidance

## [1.1.9-build.269] - 2026-03-26

### Features
- Improve agent streaming handling and add focused streaming e2e tests

## [1.1.9-build.268] - 2026-03-26

### Features
- Add compact recent saved reference quick picks

## [1.1.9-build.267] - 2026-03-26

### Maintenance
- Always render all mastering fullscreen graphs

## [1.1.9-build.266] - 2026-03-26

### Maintenance
- Polish Produceboi panel UI and fix voice affordance state sync

## [1.1.9-build.265] - 2026-03-26

### Features
- Refine per-song project controls to set/open/clear

## [1.1.9-build.264] - 2026-03-26

### Features
- Add per-song project file links

## [1.1.9-build.263] - 2026-03-26

### Features
- Improve status card help paths

## [1.1.9-build.262] - 2026-03-25

### Maintenance
- Capture checklist item version numbers in history

## [1.1.9-build.261] - 2026-03-25

### Maintenance
- Move checklist composer above mini-player

## [1.1.9-build.260] - 2026-03-25

### Maintenance
- Stop checklist typing from rewinding playback

## [1.1.9] - 2026-03-25

### Features
- Add full-access system prompt to agent panel

## [1.1.8-build.258] - 2026-03-25

### Features
- Scale reorder date opacity by song age

## [1.1.8-build.257] - 2026-03-25

### Features
- Align mini level meter width with mini spectrum

## [1.1.8-build.256] - 2026-03-25

### Features
- Add status card help tooltip with path guidance

### Maintenance
- Blur checklist item textarea on Enter

## [1.1.8] - 2026-03-25

### Features
- Restore and harden agent chat integration

## [1.1.7-build.253] - 2026-03-25

### Maintenance
- Remove checklist scroll hijacking and playback-coupled auto-scroll

## [1.1.7-build.252] - 2026-03-25

### Features
- Support band isolation from mini spectrum analyzer

## [1.1.7-build.251] - 2026-03-25

### Maintenance
- Audit: tighten help tooltip tutorial relevance

## [1.1.7-build.250] - 2026-03-25

### Maintenance
- Clarify reorder header help icon grouping

## [1.1.7-build.249] - 2026-03-25

### Fixes
- Fix help icon alignment

## [1.1.7-build.248] - 2026-03-25

### Fixes
- Fix checklist Shift+Tab navigation and reset stale focus state

## [1.1.7-build.247] - 2026-03-25

### Fixes
- Fix help icon alignment

## [1.1.7-build.246] - 2026-03-25

### Features
- Add beginner-to-pro website help copy

## [1.1.7-build.245] - 2026-03-25

### Features
- Improve website feature card UX

## [1.1.7] - 2026-03-25

### Fixes
- Gate agent features behind default-off flag

## [1.1.6-build.243] - 2026-03-25

### Features
- Add full agent chat panel with Claude CLI integration

## [1.1.6-build.242] - 2026-03-25

### Features
- Add comprehensive mastering agent design document

## [1.1.6-build.241] - 2026-03-25

### Features
- Add comprehensive agent chat panel design document

## [1.1.6-build.240] - 2026-03-25

### Fixes
- Fix YouTube thumbnails in help modals: replace hallucinated video IDs with real ones

## [1.1.6-build.239] - 2026-03-25

### Features
- Add 4 advanced mastering visualizations to fullscreen overlay
- Persist reference tracks per song, add recent references, resize album art, and click-to-seek on charts

## [1.1.6-build.237] - 2026-03-25

### Maintenance
- Unified header help button and move Shift+Tab hint to checklist footer

## [1.1.6-build.236] - 2026-03-25

### Features
- Replace checklist trash icon with red X and fix metrics toggle persistence

## [1.1.6-build.235] - 2026-03-25

### Maintenance
- Clarify help tooltip copy

## [1.1.6-build.234] - 2026-03-25

### Fixes
- Fix Space key on checklist transport buttons and Shift+Tab default focus

## [1.1.6-build.233] - 2026-03-25

### Fixes
- Fix checklist hint text/position, platform preview tooltip, and crosshair y-label clipping

## [1.1.6-build.232] - 2026-03-25

### Features
- Add Shift+click to exclude spectrum bands and PSD album art support

### Fixes
- Fix Shift+Tab on all checklist transport buttons, CSP img-src for thumbnails, and add ±1s mastering skip buttons

## [1.1.6-build.230] - 2026-03-25

### Maintenance
- Revert website video to previous version (before mastering features rebuild)

## [1.1.6-build.229] - 2026-03-25

### Fixes
- Fix four UI issues: persist metrics toggle, align visualizations, compact folder help, resize album art

## [1.1.6-build.228] - 2026-03-25

### Features
- Add interactive crosshair with axis value display to all charts

## [1.1.6-build.227] - 2026-03-25

### Features
- Add platform normalization preview indicator icon in mastering headers

## [1.1.6-build.226] - 2026-03-25

### Fixes
- Fix playback and mastering regression: add producer-media: to CSP

## [1.1.6-build.225] - 2026-03-25

### Features
- Add blue active state for A/B buttons and half-width Quick A/B / Level Match cards

## [1.1.6-build.224] - 2026-03-25

### Features
- Add global left/right arrow key shortcuts for 5-second seek

## [1.1.6-build.223] - 2026-03-25

### Features
- Add skip/jump buttons to fullscreen mastering overlay transport

## [1.1.6-build.222] - 2026-03-25

### Maintenance
- Separate level meter help tooltip from spectrum analyzer

## [1.1.6-build.221] - 2026-03-25

### Maintenance
- Increase fullscreen spectrum analyzer and level meter resolution

## [1.1.6-build.220] - 2026-03-25

### Fixes
- Fix YouTube thumbnails and external link opening in help modals

## [1.1.6-build.219] - 2026-03-25

### Fixes
- Fix checklist modal Escape key: blur focused input before closing

## [1.1.6-build.218] - 2026-03-25

### Fixes
- Fix checklist scroll glitching during audio playback

## [1.1.6-build.217] - 2026-03-25

### Maintenance
- Move Shift+Tab hint text from header to above checklist input

## [1.1.6-build.216] - 2026-03-25

### Features
- Add album art upload and editable album title to main panel header

## [1.1.6-build.215] - 2026-03-24

### Fixes
- Fix mastering side pane: extra metrics toggle and add missing normalization cards

## [1.1.6-build.214] - 2026-03-24

### Features
- Replace help icon hover tooltips with click-to-open modal dialogs

## [1.1.6-build.213] - 2026-03-24

### Fixes
- Fix tab navigation from -10s button going backward to input instead of forward to -5s

## [1.1.6-build.212] - 2026-03-24

### Maintenance
- Exclude PLAN.md from version bump requirement

## [1.1.6-build.211] - 2026-03-24

### Features
- Add development log (PLAN.md) — cleaned for public viewing

## [1.1.6-build.210] - 2026-03-24

### Features
- Remove PLAN.md from tracking and add to .gitignore

## [1.1.6-build.209] - 2026-03-24

### Maintenance
- Rewrite normalization and tonal balance tooltips with beginner-friendly per-platform explanations

## [1.1.6-build.208] - 2026-03-24

### Features
- Add HelpTooltips for all non-mastering production features

## [1.1.6-build.207] - 2026-03-24

### Maintenance
- Rewrite visualization HelpTooltip text with rich, beginner-friendly explanations

## [1.1.6] - 2026-03-24

### Features
- Label and source tonal/spectrum panels for reference mode

## [1.1.5] - 2026-03-24

### Maintenance
- Assert fullscreen spectrum resolution and bump version

## [1.1.4-build.204] - 2026-03-24

### Features
- Add "Learn more" YouTube tutorial links to all HelpTooltips

## [1.1.4-build.203] - 2026-03-24

### Fixes
- Fix HelpTooltip "?" icons wrapping to new line instead of staying inline

## [1.1.4-build.202] - 2026-03-24

### Features
- Add hover tooltips (title attributes) to all buttons in App.tsx

## [1.1.4-build.201] - 2026-03-24

### Features
- Re-add PLAN.md to repo (reviewed, no sensitive content)

## [1.1.4-build.200] - 2026-03-24

### Maintenance
- Increase checklist dialog max-height for more vertical space

## [1.1.4-build.199] - 2026-03-24

### Maintenance
- Polish mastering fullscreen UI: section headers, inline layout, pro diagnostics

## [1.1.4-build.198] - 2026-03-24

### Features
- Add click-to-show HelpTooltip component to all mastering metrics
- Add proper axis labels to all analysis visualizations
- Add (Reference) indicators to all metric cards and visualization headers when playing reference track
- Update site with all new mastering features
- Add playback controls to mastering fullscreen overlay header
- Add saved reference tracks feature to mastering overlay

## [1.1.4-build.192] - 2026-03-24

### Features
- Add loading UX for Quick A/B reference track loading
- Update README to highlight full mastering analysis suite

## [1.1.4] - 2026-03-24

### Features
- Reinitialize checklist modal on mini-player track changes

### Maintenance
- Rebuild Remotion promo video with mastering features

## [1.1.3] - 2026-03-24

### Maintenance
- Cover checklist overlay hover scroll behavior

## [1.1.2] - 2026-03-24

### Maintenance
- Add lean quick/core/full validation ladder

## [1.1.1-build.186] - 2026-03-24

### Features
- Add comprehensive mastering analysis features

## [1.1.1] - 2026-03-24

### Features
- Expose canonical state via per-folder symlink sidecar

## [1.1.0] - 2026-03-24

### Features
- Redesign checklist capture flow and streamline mastering pane
- Add error boundary component for improved error handling

## [1.0.5] - 2026-03-23

### Fixes
- Disable hot reload by default in dev

## [1.0.4] - 2026-03-23

### Fixes
- Simplify checklist remove action affordance

## [1.0.3] - 2026-03-23

### Features
- Add checklist mini player and typing capture polish

## [1.0.2] - 2026-03-23

### Fixes
- Polish checklist and normalization workflow UX

## [1.0.1-build.178] - 2026-03-23

### Features
- Add PLAN.md to .gitignore and untrack

## [1.0.1-build.177] - 2026-03-23

### Features
- Remove PLAN.md and add to .gitignore

## [1.0.1] - 2026-03-21

### Fixes
- Bump Producer Player to 1.0.1 and enforce version bumps

## [1.0.0-build.175] - 2026-03-21

### Features
- Show parsed timestamps in migration preview checklist items

## [1.0.0-build.174] - 2026-03-21

### Fixes
- Change migrate button icon from import tray to old man emoji

## [1.0.0-build.173] - 2026-03-21

### Fixes
- Change migrate button icon from clipboard to import tray emoji

## [1.0.0-build.172] - 2026-03-21

### Features
- Add Shift+click developer mode to Delete All button

## [1.0.0-build.171] - 2026-03-21

### Fixes
- Populate timestampSeconds in LLM migration and add Delete All button to checklist

## [1.0.0] - 2026-03-20

### Maintenance
- Unify version source to package.json and release 1.0.0

## [0.3.2-169] - 2026-03-20

### Features
- Add 48x48 favicon for crawler compatibility
- Improve Pages branding metadata and favicon assets

## [0.3.1-167] - 2026-03-20

### Fixes
- Restore checklist textarea styling and composer UX

## [0.2.5-166] - 2026-03-20

### Maintenance
- Cover recent checklist UX + shared-state gaps

## [0.3.0-165] - 2026-03-20

### Features
- Add in-app update checks and download flow

## [0.2.4-164] - 2026-03-20

### Fixes
- Make checklist item fields auto-grow

## [0.2.3-163] - 2026-03-20

### Fixes
- Confirm clearing completed checklist items

## [0.2.2-162] - 2026-03-19

### Features
- Update landing page headline copy

## [0.2.1-161] - 2026-03-19

### Fixes
- Repair release workflow version bump logic

### Maintenance
- Auto-bump app version on releases
- Disable dependabot updates

## [0.2.0-158] - 2026-03-19

### Maintenance
- Simplify lower download section to GitHub releases button

## [0.2.0-157] - 2026-03-19

### Maintenance
- Remove internal download note from landing page

## [0.2.0-156] - 2026-03-19

### Fixes
- Finish checklist and download backlog

## [0.2.0-155] - 2026-03-19

### Maintenance
- Site: use single universal mac download button

## [0.2.0-154] - 2026-03-19

### Features
- Improve landing downloads with stable latest URLs

## [0.2.0-153] - 2026-03-19

### Fixes
- Fix normalization card layout overflow in mastering pane

## [0.2.0-152] - 2026-03-19

### Maintenance
- Refine landing page download fallback and nav branding

## [0.2.0-151] - 2026-03-19

### Fixes
- Fix landing page download asset selection

## [0.2.0-150] - 2026-03-19

### Maintenance
- Tweak landing page header logo size and alignment

## [0.2.0-149] - 2026-03-19

### Fixes
- Fix landing page download CTA flash and remove note

## [0.2.0-148] - 2026-03-19

### Maintenance
- Cover dev-to-packaged ratings state persistence

## [0.2.0-147] - 2026-03-19

### Fixes
- Rename bottom download CTA to GitHub

## [0.2.0-146] - 2026-03-19

### Features
- Add MAS preflight and App Store submission tooling/docs

### Fixes
- Tighten MAS preflight workflow and docs

## [0.2.0-144] - 2026-03-19

### Maintenance
- Remove OS detection from landing page download CTA

## [0.2.0-143] - 2026-03-19

### Maintenance
- Avoid duplicate platform download button on landing page

## [0.2.0-142] - 2026-03-19

### Maintenance
- Site: make lower download CTA direct too

## [0.2.0-141] - 2026-03-19

### Features
- Ship universal mac desktop build and single mac download

## [0.2.0-140] - 2026-03-19

### Features
- Add direct platform download buttons with latest-release auto-linking

## [0.2.0-139] - 2026-03-19

### Maintenance
- Remove full stop from website title

## [0.2.0-138] - 2026-03-19

### Maintenance
- Site: remove top nav links

## [0.2.0-137] - 2026-03-19

### Features
- Update website subtitle to mention more

## [0.2.0-136] - 2026-03-19

### Features
- Update website title to finish records the right way

## [0.2.0-135] - 2026-03-19

### Fixes
- Fix shared ratings/checklists persistence across dev and packaged app

## [0.2.0-134] - 2026-03-19

### Fixes
- Fix sample-rate fallback when ffprobe is unavailable

## [0.2.0-133] - 2026-03-18

### Features
- Update video section heading copy

## [0.2.0-132] - 2026-03-18

### Maintenance
- Use Node-invoked Playwright CLI for cross-platform CI

## [0.2.0-131] - 2026-03-18

### Fixes
- Fix Windows runtime smoke runner command resolution

## [0.2.0-130] - 2026-03-18

### Fixes
- Fix cross-platform smoke test filtering in CI
- Fix Linux CI Electron launch for runtime smoke tests

## [0.2.0-128] - 2026-03-18

### Features
- Add Windows and Linux runtime smoke tests in CI

## [0.2.0-127] - 2026-03-18

### Features
- Update website footer copyright year to 2026

## [0.2.0-126] - 2026-03-18

### Features
- Update website card copy to files

## [0.2.0-125] - 2026-03-18

### Features
- Update explainer video copy to files

## [0.2.0-124] - 2026-03-18

### Features
- Add empty-state Add Folder CTA and refresh screenshots/video

## [0.2.0-123] - 2026-03-18

### Fixes
- Correct misleading 'unsigned' log message in build-mac.mjs

## [0.2.0-122] - 2026-03-18

### Features
- Add macOS code signing & notarization infrastructure
- Add vitest devDependency and resolve type errors
- Add psychedelic purple kaleidoscope background + simplify feature copy
- Add AGENTS.md with project rules (screenshot/video refresh, deploy, etc.)
- Spectrum/meter UX — toggle band solo, freeze on stop, volume width
- Add LLM-powered note migration modal
- Add 'Show' button to reveal iCloud backup folder in Finder
- Add tooltips to mastering metrics to clarify static vs real-time values
- Add iCloud Drive backup for checklists, ratings, and preferences
- Make checklist items multi-line textareas that expand to show full text
- Add real-time spectrum analyzer, level meter, and interactive band soloing
- Change ±10s skip to ±5s, add ±1s skip buttons
- V6 explainer video — psychedelic purple + 60fps
- Add -10s/+10s skip buttons to checklist dialog
- V5: add background music (thedrums.mp3), update checklist UI mockup, compress for web
- Add play/pause button to checklist dialog
- Replace repeat button text with standard repeat icon
- Add checklist button to transport bar + 'Set now' timestamp capture button
- Replace explainer video with tasteful v4 — minimal, dark, restrained
- Add 'by 3000 AD' branding behind feature flag (OFF by default)
- Make checklist timestamp preview clickable to seek
- Show timestamp preview next to checklist input
- Add +10s / -10s skip buttons above transport prev/next controls
- Update explainer video v3 — add timestamp checklist feature showcase
- Reverse checklist item order (newest first)
- Add time-stamped notes feature card
- Add playback-position timestamps to checklist items
- Add 'by 3000 AD' branding in nav top-left
- Checklist click-outside-close, remove dup close btn, export ordering JSON, search shows all versions, e2e tests
- Replace placeholder video with polished text-based explainer
- Replace explainer video with diverse scene-based version
- Rebuild explainer video with higher quality and more scenes
- Add explainer video and embed it on the landing page
- Move screenshot to hero, add video explainer placeholder and script
- Release: publish real snapshot versions and add MIT license
- Add full expanded mastering/reference workspace
- Add ordered latest-version export utility
- Improve public landing page, add Reddit outreach shortlist, and enforce version-suffix filtering
- Ship producer-player catch-up fixes and salvage pass
- Ship mastering phase 2 recovery with platform normalization preview
- Add mastering preview phase 1 shell
- Add macOS App Store build scripts and docs
- Add playlist order export/import JSON flow
- Ship follow-up UX polish for playback, drag/drop, and sidebar
- Audit PLAN chat coverage and add transcript reconciliation workflow
- Add Producer Player app icon direction and macOS icon assets
- Add README app screenshot with active and archived files
- Improve pages SEO and run desktop release matrix on push
- Polish tracks UX, player dock, and folder/version behavior
- Add prominent naming guidance under folder picker
- Add playback, actual-song UX, ordering, and organize workflow
- Ship real macOS prebuilt release pipeline and publish docs
- Add public landing page and GitHub Actions packaging workflows

### Fixes
- Clean up release versioning and bump to v0.2.0
- Remove A/B mastering card from features
- Hide folder path in screenshots, fix screenshot script to use IPC for folder linking
- Remove path-linker from production UI, truncate sidebar folder paths
- Hide paste-folder-path in screenshots, retake with clean UI
- Screenshots with active spectrum analyzer & 5-version history
- Ensure video section is visible and prominent
- UX copy — improve import tooltip wording
- Spotify normalization policy + UX copy pass
- External URL allowlist + round checklist timestamps to whole seconds
- Use web-compressed video (1.4MB) for faster loading
- Mastering panel flex layout + retake screenshots at 1440×900
- Use video frame as poster, improve video quality (CRF 23, 657KB)
- Resize screenshots to sensible 1600x1268 (was absurdly tall 1968)
- Increase screenshot height to 1600×2000 to eliminate sidebar cutoff
- Timestamp preview shows whenever audio is loaded
- Title branding links to GitHub Pages site instead of Actions
- Fix A/B playhead boundary condition, stabilize naming guidance test, deduplicate tests
- Wire 3000 AD link to Linkfire URL
- Restore empty styles.css for deploy validation
- Require explicit playback switch after row selection
- Show loading state before track scan completes
- Clear legacy service workers that can trap stale loading state
- Restore mix playhead after reference audition
- Preserve playback fidelity for AIFF cache + row title casing
- Audit and harden Producer Player LUFS analysis
- Reject root/top-level folder paths in linkFolder to prevent chokidar hang
- Fix near-end playhead restore on track switch
- Fix playback UX and old-folder album leakage
- Scope tracks to selected watch folder
- Restore reliable default open-in-finder behavior
- Harden album reorder playback state and refresh UX docs
- Fix playback runtime and harden order persistence durability
- Complete phase1 checklist pass and harden playback + unlink
- Restore desktop mac release script wiring
- Build shared packages before domain/app typechecks
- Build shared packages before app typechecks in CI
- Run CI workspace commands by path
- Track TS packages so CI can resolve workspaces
- Make CI workspace checks path-based

### Maintenance
- Match screenshot data to Ethan's real app (version counts, ratings, song names)
- Use real song names from Ethan's library for screenshots
- Reorder features: version tracking → tracklist → timestamped notes → normalization → A/B
- Kaleidoscope: balance visuals between perf and beauty
- Optimize kaleidoscope background animation
- Reduce feature cards from 7 to 4 core fundamentals
- Video: re-render explainer with latest feature copy and screenshots
- Rewrite feature cards with compelling, producer-focused copy
- Refresh screenshots and re-render explainer video with latest UI
- Video: v6 psychedelic purple explainer — 60fps 1080p CRF 18
- Move Set Now button and timestamp preview to right of checklist input
- Move play/pause button from bottom actions to checklist modal header
- Compress explainer video 4MB→466KB for faster loading
- Retake screenshots with bigger window (1600x1100)
- Update app screenshots with real running app
- Update README with current features, badges, and website link
- Site: rewrite homepage from scratch
- Refresh public GitHub page copy and status
- Expand producer-player E2E coverage and stabilize UI workflows
- Assert path-linker disabled banner stays hidden in test mode
- Deepen checklist, support-link, and mastering reference coverage
- Polish top-left Producer Player branding header
- Publish rolling snapshot releases on main pushes
- Restore GitHub release notes category config
- Remove add-folder helper copy
- Polish production playback UI and messaging
- Design: apply Queue Halo app icon
- Polish public landing page and repo hygiene
- Archive legacy swift mvp
- Polish pages seo metadata and sitemap
- Harden folder-structure e2e and domain integration coverage
- Publish repo and wire live Pages/demo links
