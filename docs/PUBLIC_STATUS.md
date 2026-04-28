# Producer Player — public status

_Last updated: 2026-03-16_

## Public now

- GitHub repository (public): <https://github.com/EthanSK/producer-player>
- GitHub Pages landing page: <https://ethansk.github.io/producer-player/>
- README, release links, and security policy:
  - [`../README.md`](../README.md)
  - [`../SECURITY.md`](../SECURITY.md)
- Automated desktop release workflow:
  - <https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml>

## Current release model

- Baseline tagged release: `v0.1.0`
- Rolling snapshot prereleases from `main`/`master` pushes (`desktop-snapshot-*`)
- Release assets publish a macOS ZIP, Linux AppImage/.deb/ZIP, and a Windows NSIS installer
- SHA-256 checksum files are published alongside ZIP/AppImage/.deb/installer assets

## Public workflow/features currently represented on main

- Version grouping by song with archive-aware handling (`old/`)
- Stable album order controls with export/import helpers
- Mastering/reference workspace with loudness + peak analysis
- Platform normalization preview profiles
- Per-song checklist and rating workflow

## Not public-ready yet

- Signed + notarized polished macOS outside-store distribution
- App Store submission/approval
- Finalized non-technical installer onboarding flow

## Honest public wording

Use wording like this on public surfaces:

> Producer Player is publicly visible, the landing page is live, and rolling desktop snapshots are downloadable now. Signing/notarization for polished macOS distribution is still in progress.

Do **not** describe it as a finalized polished release while signing/notarization and installer trust flow are still pending.
