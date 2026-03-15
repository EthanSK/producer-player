![Producer Player app screenshot (live app capture)](docs/assets/readme/app-hero.png)

Producer Player is a desktop app for producers who keep exporting the same songs and need one place to manage versions without losing track of album order.

The screenshot above is a real capture from the current app UI using local sample songs.

## What it does

- Groups repeated exports into one song (`Track v1`, `Track v2`, etc.)
- Keeps track order stable while versions change over time
- Archives older versions cleanly instead of losing them
- Lets you cue current or older exports quickly

## Public links

- Live page: <https://ethansk.github.io/producer-player/>
- Repository: <https://github.com/EthanSK/producer-player>
- Releases: <https://github.com/EthanSK/producer-player/releases>
- Desktop workflow: <https://github.com/EthanSK/producer-player/actions/workflows/release-desktop.yml>
- Security policy: [`SECURITY.md`](SECURITY.md)

## Current status

Right now:

- The GitHub Pages landing page is live
- The repository is public
- Desktop workflow builds on each push to `main`/`master` and publishes a new snapshot release (marked **Latest**)
- Local Apple Silicon builds work (ZIP output)
- Mac App Store packaging scaffolding is in the repo

Not claimed yet:

- Signed/notarized public macOS release
- App Store submission approval
- Polished public download flow beyond test builds

If you download a current macOS ZIP, treat it as a test build.

## Local development

```bash
npm install
npm run dev
```

## Build and test

```bash
npm run build
npm run typecheck
npm run e2e
npm run e2e:ci
```

## Desktop packaging

```bash
npm run build:mac
npm run build:mac:dir
npm run build:mac:mas-dev
npm run build:mac:mas
npm run release:desktop:linux
npm run release:desktop:win
```

Mac App Store packaging notes: [`docs/MAC_APP_STORE.md`](docs/MAC_APP_STORE.md)

## Repo layout

- `apps/electron` — Electron main process and preload bridge
- `apps/renderer` — React renderer UI
- `packages/contracts` — shared IPC/types
- `packages/domain` — folder scanning/grouping/order logic
- `apps/e2e` — Playwright desktop tests
- `site/` — GitHub Pages landing page

## License

This product is open source. Feel free to modify it.

Producer Player is released under the **MIT License**.
See [`LICENSE`](LICENSE) and [`docs/LICENSE_STATUS.md`](docs/LICENSE_STATUS.md).
