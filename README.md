# Producer Player

**Finish music, not file management.**

[![CI](https://github.com/EthanSK/producer-player/actions/workflows/ci.yml/badge.svg)](https://github.com/EthanSK/producer-player/actions/workflows/ci.yml)
[![Release](https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml/badge.svg)](https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-purple.svg)](LICENSE)

A desktop app for producers who bounce a lot. Drag in a folder of exports and Producer Player auto-groups versions, organizes your album, and gives you a full mastering workspace -- all in one place.

[Website](https://ethansk.github.io/producer-player/) &#183; [Download](https://github.com/EthanSK/producer-player/releases) &#183; [Source](https://github.com/EthanSK/producer-player)

<p align="center">
  <img src="site/assets/screenshots/main-view.png" alt="Producer Player — scan folders, auto-group versions, drag to reorder, album art, version history, mastering metrics" width="100%" />
</p>

## Features

<table>
  <tr>
    <td align="center" width="50%">
      <img src="site/assets/screenshots/checklist.png" alt="Production Checklist" width="100%" /><br />
      <strong>Production Checklist</strong><br />
      <sub>Per-song notes with timestamps and version management. Click a timestamp to jump straight to that moment in playback.</sub>
    </td>
    <td align="center" width="50%">
      <img src="site/assets/screenshots/tutorials.png" alt="Built-in Tutorials & AI Assistant" width="100%" /><br />
      <strong>Tutorials & AI Assistant</strong><br />
      <sub>Every metric explained in plain language with curated video tutorials. Chat with Producey Boy, an AI mastering assistant, for personalised guidance.</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="site/assets/screenshots/waveform-loudness.png" alt="Reference Matching" width="100%" /><br />
      <strong>Reference A/B Comparison</strong><br />
      <sub>Load a reference track, auto-match loudness, and A/B compare. Loudness history and waveform visualization side by side.</sub>
    </td>
    <td align="center" width="50%">
      <img src="site/assets/screenshots/platform-normalization.png" alt="Platform Normalization" width="100%" /><br />
      <strong>Platform Normalization Preview</strong><br />
      <sub>Hear what Spotify, Apple Music, YouTube, and TIDAL will do to your master before you upload. Headroom-aware gain limits included.</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="site/assets/screenshots/spectrum-mastering.png" alt="Mastering Workspace" width="100%" /><br />
      <strong>Mastering Workspace</strong><br />
      <sub>Spectrum analyzer with band soloing, loudness metering (integrated, short-term, momentary LUFS), true peak detection, and stereo imaging.</sub>
    </td>
    <td align="center" width="50%">
      <img src="site/assets/screenshots/midside-analysis.png" alt="Advanced Analysis" width="100%" /><br />
      <strong>Advanced Analysis</strong><br />
      <sub>Dynamic range, crest factor, mid/side spectrum, loudness distribution, vectorscope, and stereo correlation -- with AI-powered insights.</sub>
    </td>
  </tr>
</table>

### Version Management & Album Organization

The core workflow. Drop a folder of bounces and Producer Player groups them automatically (`Track v1`, `Track v2`, etc.). Drag songs into album order, attach album art, and link to your DAW project files. Order persists through rescans and restarts.

### Production Checklist & Notes

Per-song checklist with time-stamped notes -- add an item during playback and it captures the exact position. Click the timestamp to jump back. Rate tracks 1-10 to keep your album shortlist clear.

### AI Mastering Assistant

Producey Boy analyzes your track's loudness, spectrum, and stereo field, then gives you plain-language feedback and suggestions. Available throughout the app.

### Built-in Tutorials

Every metric in the app has a dedicated tutorial with clear explanations and curated video links. No more tab-switching to figure out what LRA means.

### Reference Track A/B

Load a reference alongside your master with automatic level matching so you're comparing tone, not volume. Playhead restores after auditioning.

### Platform Normalization Preview

Preview gain adjustments for Spotify (-14 LUFS), Apple Music (-16 LUFS), YouTube, TIDAL, and Amazon Music. Clips are flagged before you upload.

### Mastering Workspace

Full-screen spectrum analyzer with frequency band soloing, integrated/short-term/momentary LUFS, true peak (dBTP), sample peak, clip count, crest factor, DC offset, stereo correlation, vectorscope, K-metering (K-14, K-20), mid/side monitoring, and loudness history.

### Export & Handoff

Export the latest version of every song as numbered, album-sequenced files with ordering metadata. Ready for distribution or handoff to a mastering engineer.

## Download

Free and source-available. macOS, Windows, and Linux.

**[Latest release](https://github.com/EthanSK/producer-player/releases)**

> Current builds are unsigned preview releases. Signed/notarized macOS distribution is pending.

## Development

Electron + React + TypeScript monorepo with npm workspaces.

```
apps/electron    -- main process + preload bridge
apps/renderer    -- React UI
apps/e2e         -- Playwright desktop tests
packages/contracts -- shared IPC types
packages/domain  -- folder scanning, grouping, ordering logic
site/            -- GitHub Pages landing page
```

```bash
npm install          # install deps + set up git hooks
npm run dev          # development mode
npm run dev:hot      # with renderer hot reload
npm run build        # production build
npm run typecheck    # full typecheck (all workspaces)
npm run e2e          # smoke E2E tests
```

See [docs/RELEASING.md](docs/RELEASING.md) for packaging and release details.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) -- free for noncommercial use.
