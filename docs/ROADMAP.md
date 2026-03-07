# Producer Player Roadmap

## Phase 1 — MVP hardening (next)

- Improve scan robustness with explicit retry/error reporting
- Better active-version diffing for same-path overwrite scenarios
- Persist user fuzzy threshold and UI preferences
- Add per-album regex editor UI (currently schema + defaults exist)
- Add richer uncertain-match dialog (A/B confidence explanations)

## Phase 2 — Producer audition workflow

- True A/B compare controls between two versions
- Peak/RMS/loudness quick readouts
- Mark favorite versions
- Keyboard-first navigation tuning for rapid audition loops
- Improved waveform with zoom and region scrub

## Phase 3 — Performance at scale (10k+ files)

- Parallel folder scanning pipeline
- Batched DB writes + explicit transactions per scan block
- Hash-based duplicate/render detection (optional)
- FSEvents integration for lower overhead change tracking
- UI virtualization and pagination for massive lists

## Phase 4 — DAW ecosystem polish

- Ableton/Logic bounce folder presets
- Smarter regex recipe templates
- Optional metadata import (BPM/key/length)
- MIDI controller transport mapping
- Spectrogram view

## Phase 5 — Reliability and packaging

- Unit + integration test suite
- Crash-safe background indexing checkpoints
- App signing / notarization pipeline
- Sparkle auto-update pipeline
