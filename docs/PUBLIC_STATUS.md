# Producer Player — public status

_Last updated: 2026-03-10_

## Public now

- GitHub repository: <https://github.com/EthanSK/producer-player>
- GitHub Pages landing page: <https://ethansk.github.io/producer-player/>
- Current README and public-facing docs
- Security policy: [`../SECURITY.md`](../SECURITY.md)
- Automated desktop build workflow:
  - <https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml>

## Build status

- The desktop packaging path is working.
- Local verification on Apple Silicon produces `Producer-Player-0.1.0-mac-arm64.zip`.
- GitHub Actions is configured to build unsigned desktop ZIP artifacts.
- The repo now includes Mac App Store-oriented electron-builder targets, entitlements, and npm build scripts.

## Not public-ready yet

- Signed macOS release already accepted by Apple
- Apple notarization for outside-the-store distribution
- Final polished public download channel
- Chosen open-source license

## Honest public wording

Use wording like this on public surfaces:

> Producer Player is publicly visible, the landing page is live, and the desktop build path exists. A polished signed macOS release is still pending signing and notarization.

Do **not** describe it as launch-ready until those manual release steps are complete.
