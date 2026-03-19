# Producer Player Mac App Store status + runbook

_Last updated: 2026-03-19 (verified on Ethan’s Mac mini)_

## Verified current status (machine truth)

Producer Player is **repo-prepared** for Mac App Store packaging, but **submission is currently blocked by Apple account/signing/tooling prerequisites**.

### What was verified in this session

1. `npm run mas:preflight` reports **3 blockers**:
   - Apple Distribution signing identity missing from keychain
   - provisioning profile missing at:
     - `~/Library/MobileDevice/Provisioning Profiles/ProducerPlayer_AppStore.provisionprofile`
   - no `iTMSTransporter` found (Xcode/Transporter upload tooling missing)

2. Code-signing identities currently visible:
   - ✅ `Developer ID Application: Ethan Sarif-Kattan (T34G959ZG8)`
   - ❌ no `Apple Distribution` identity

3. Apple web portal auth state in Chrome:
   - App Store Connect `https://appstoreconnect.apple.com/apps` redirects to:
     - `https://appstoreconnect.apple.com/login?targetUrl=%2Fapps&authResult=FAILED`
   - Apple Developer certificates page redirects to:
     - `https://idmsa.apple.com/IDMSWebAuth/signin?...`
   - Meaning: active Apple session is not currently authenticated for completion of cert/profile/ASC steps.

4. Submission assets prepared in repo:
   - ✅ App Store screenshot pack generated at `artifacts/app-store-connect/screenshots/`
   - ✅ ASC checklist and metadata template docs present
   - ✅ MAS build/upload helper scripts present

## What is already wired in the repo

- Electron MAS build targets (`mas`, `mas-dev`) and entitlements
- MAS-safe behavior in app code (`process.mas` handling + security-scoped bookmarks)
- MAS preflight checks and local build/upload scripts
- App Store Connect metadata + checklist docs

## Local commands (from repo root)

```bash
npm run mas:preflight
npm run mas:preflight:build
npm run mas:screenshots
npm run build:mac:mas:local
npm run mas:upload
```

### What each command does

- `mas:preflight`
  - Full submission readiness: checks signing identities, provisioning profile validity, upload tooling, screenshots, and existing MAS artifacts.
- `mas:preflight:build`
  - Build readiness only (upload tooling is warning-level instead of blocker).
- `mas:screenshots`
  - Generates ASC-ready screenshots in `artifacts/app-store-connect/screenshots/`.
- `build:mac:mas:local`
  - Runs build-mode preflight, then runs `npm run build:mac:mas`.
- `mas:upload`
  - Uploads latest MAS `.pkg` via iTMSTransporter.
  - Requires `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`.

## Exact remaining steps to unblock submission

1. Sign into Apple Developer + App Store Connect in browser (session currently expired/failed).
2. Create/download **Apple Distribution** certificate and install it in login keychain.
3. Create/download **Mac App Store provisioning profile** for `com.ethansk.producerplayer`.
4. Put profile at default path or export env var:

   ```bash
   export PRODUCER_PLAYER_PROVISIONING_PROFILE="/absolute/path/to/profile.provisionprofile"
   ```

5. Install Xcode or Transporter so `iTMSTransporter` is available.
6. Re-run:

   ```bash
   npm run mas:preflight:build
   npm run build:mac:mas:local
   npm run mas:preflight
   npm run mas:upload
   ```

7. In App Store Connect, complete any remaining metadata/compliance/pricing/review fields and submit.

## Related docs

- `docs/APP_STORE_CONNECT_CHECKLIST.md`
- `docs/APP_STORE_CONNECT_METADATA_TEMPLATE.md`
- `docs/RELEASING.md`
- `docs/CODE_SIGNING.md`

## Relevant implementation files

- `package.json`
- `scripts/build-mac.mjs`
- `scripts/mas-preflight.sh`
- `scripts/build-mas-local.sh`
- `scripts/upload-mas-build.sh`
- `scripts/generate-app-store-screenshots.py`
- `build/entitlements.mas.plist`
- `build/entitlements.mas.inherit.plist`
- `apps/electron/src/main.ts`
