# Producer Player Linux hardening pass — 2026-04-28

## What changed

- Linux releases are now AppImage-first:
  - `Producer-Player-<version>-linux-x64.AppImage` is the primary Linux download and the in-app update target.
  - `Producer-Player-<version>-linux-x64.deb` is published for Debian/Ubuntu installs.
  - `Producer-Player-<version>-linux-x64.zip` remains a portable fallback.
- `npm run release:desktop:linux` now refuses to run on non-Linux hosts by default. This prevents a macOS/Windows cross-build from silently bundling the host `ffmpeg-static` binary into a Linux package.
- Linux release validation now requires exactly one AppImage, `.deb`, ZIP, and `latest-linux.yml` before a release can be marked latest.
- Release publishing now fails if Linux AppImage/update metadata is missing, instead of silently publishing a latest release that Linux users cannot install/update from.
- The landing page, README, release notes template, and releasing docs now point Linux users to the AppImage first.
- The app's Linux update UI disables electron-updater for non-AppImage packaged Linux installs (`.deb`/ZIP), with a clear message telling users to use the AppImage for automatic updates.
- Bundled ffmpeg is chmodded after copy so Linux package runtime permissions are explicit.

## What was checked locally on macOS

- `npm run version:check` — passed.
- `npm run typecheck:app` — passed.
- `npm test -w @producer-player/electron` — passed, including new Linux release asset resolution tests.
- `npm test -w @producer-player/renderer` — passed.
- `npm run build` — passed; built renderer/electron, sidecar, and bundled ffmpeg.
- `EXPECTED_VERSION=3.93.0 EXPECTED_PATH_REGEX='^Producer-Player-.*-linux-x64\\.AppImage$' node scripts/check-latest-mac-yml.mjs <synthetic latest-linux.yml>` — passed.
- `npm run release:desktop:linux` on macOS — intentionally refused with the new guard, because this host would bundle the wrong ffmpeg binary for Linux.

## What still needs a real Linux runner/VM

Local macOS cannot prove the actual Linux AppImage/.deb executable launches because the release script correctly refuses non-Linux shippable builds. The Ubuntu CI/release runner must prove:

```bash
npm ci
npm run release:desktop:linux
ls -lah release
EXPECTED_VERSION=3.93.0 \
EXPECTED_PATH_REGEX='^Producer-Player-.*-linux-x64\.AppImage$' \
node scripts/check-latest-mac-yml.mjs release/latest-linux.yml
```

Recommended manual Linux smoke after CI artifacts are available:

```bash
chmod +x Producer-Player-<version>-linux-x64.AppImage
./Producer-Player-<version>-linux-x64.AppImage --no-sandbox
```

Then verify:

- App launches and can link/open a folder.
- WAV/MP3 playback works.
- AIFF playback/transcode works, proving bundled Linux ffmpeg executes.
- Settings footer shows updates enabled for AppImage.
- `.deb`/ZIP builds launch but show the non-AppImage update-disabled message.

## Known constraints

- Linux auto-update support is AppImage-only. `.deb` and ZIP are intentionally visible install fallbacks but do not self-update from inside the app.
- Linux arm64 is not advertised yet; release asset resolution returns no stable Linux arm64 asset until CI/package support is explicitly added.
- The optional JUCE `pp-audio-host` plugin sidecar remains bundled only on macOS. The Linux hardening here covers the core desktop app, ffmpeg-backed media handling, install/update packaging, and release process; Linux native plugin-host packaging still needs a dedicated Ubuntu build/runtime pass before it should be advertised.
