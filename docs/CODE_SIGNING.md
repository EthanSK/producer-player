# macOS Code Signing & Notarization

This guide covers everything needed to sign and notarize Producer Player for
macOS so Gatekeeper lets users open it without warnings.

---

## Overview

| Component | Purpose |
|---|---|
| **Developer ID Application** certificate | Signs the `.app` bundle |
| **Hardened Runtime** | Required for notarization |
| **Notarization** (Apple notary service) | Apple scans the app and staples a ticket |
| **Entitlements** | Declares runtime permissions (JIT, unsigned memory, dyld) |

The infrastructure is already wired up. You just need to provide credentials.

---

## 1. Create a Developer ID Application Certificate

### Option A — Xcode (easiest)

1. Open **Xcode → Settings → Accounts**.
2. Select your Apple ID → your team.
3. Click **Manage Certificates…**
4. Click **+** → **Developer ID Application**.
5. Xcode installs it into your keychain automatically.

### Option B — developer.apple.com

1. Go to <https://developer.apple.com/account/resources/certificates/list>.
2. Click **+** → **Developer ID Application**.
3. Follow the CSR flow (Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority).
4. Download and double-click the `.cer` to install it.

---

## 2. Export the Certificate as .p12

1. Open **Keychain Access**.
2. Find the **Developer ID Application: …** certificate (login keychain).
3. Expand it — you should see the private key underneath.
4. Right-click the certificate → **Export…**
5. Choose **Personal Information Exchange (.p12)**.
6. Set a strong password — you'll need it as `CSC_KEY_PASSWORD`.

### Base64-encode for CI

```bash
base64 -i ~/Desktop/cert.p12 | pbcopy
```

The clipboard now holds the value for the `CSC_LINK` secret.

---

## 3. Create an App-Specific Password

1. Go to <https://appleid.apple.com/account/manage>.
2. Sign in → **Sign-In and Security** → **App-Specific Passwords**.
3. Click **Generate an app-specific password…**
4. Label it something like `producer-player-notarize`.
5. Copy the generated password — this is your `APPLE_APP_SPECIFIC_PASSWORD`.

---

## 4. Find Your Team ID

1. Go to <https://developer.apple.com/account#MembershipDetailsCard>.
2. Your **Team ID** is the 10-character alphanumeric string.

Or from the terminal:

```bash
security find-identity -v -p codesigning | head -5
# Look for "Developer ID Application: Your Name (XXXXXXXXXX)"
# The 10-char string in parentheses is the Team ID.
```

---

## 5. Set GitHub Actions Secrets

Go to **Settings → Secrets and variables → Actions** in the
[producer-player repo](https://github.com/EthanSK/producer-player/settings/secrets/actions)
and add:

| Secret | Value |
|---|---|
| `CSC_LINK` | Base64-encoded `.p12` (from step 2) |
| `CSC_KEY_PASSWORD` | Password you set when exporting the `.p12` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (from step 3) |
| `APPLE_TEAM_ID` | 10-char Team ID (from step 4) |

Once these are set, every push to `main` (and every tag) will produce **signed
and notarized** macOS builds automatically. No code changes needed.

---

## 6. Test Signing Locally

```bash
# Export the env vars
export CSC_LINK="$(base64 -i ~/path/to/cert.p12)"
export CSC_KEY_PASSWORD="your-p12-password"
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"

# Build — this will sign AND notarize
npm run build:mac
```

To verify the result:

```bash
# Check signature
codesign --verify --deep --strict --verbose=2 \
  release/mac-arm64/Producer\ Player.app

# Check notarization
spctl --assess --type execute --verbose=2 \
  release/mac-arm64/Producer\ Player.app
```

---

## How It Works (for reference)

1. **`package.json` → `build.mac`** enables `hardenedRuntime` and points to
   `build/entitlements.mac.plist`.
2. **electron-builder** reads `CSC_LINK` / `CSC_KEY_PASSWORD` from the
   environment and signs the app automatically.
3. **`afterSign` → `scripts/notarize.js`** runs after signing. It calls
   `@electron/notarize` which submits the app to Apple's notary service and
   waits for approval (~1-5 min).
4. If `APPLE_*` env vars aren't set, the notarize script is a no-op —
   builds still succeed unsigned.

### Files involved

```
build/entitlements.mac.plist     ← runtime entitlements for direct distribution
build/entitlements.mas.plist     ← sandbox entitlements for Mac App Store
build/entitlements.mas.inherit.plist
scripts/notarize.js              ← afterSign notarization hook
scripts/build-mac.mjs            ← build orchestrator (respects CSC_LINK/CSC_NAME)
.github/workflows/release-desktop.yml  ← CI with signing secret env vars
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `errSecInternalComponent` | Unlock keychain: `security unlock-keychain -p "" login.keychain` |
| Notarization times out | Retry; Apple's service can be slow. Check `xcrun notarytool history`. |
| "The developer cannot be verified" | Certificate isn't Developer ID Application, or notarization wasn't completed. |
| Build fails on CI with signing error | Check that `CSC_LINK` is a valid base64 string, not a file path. |
| Local build ignores cert | Make sure `CSC_LINK` or `CSC_NAME` is exported — otherwise auto-discovery is disabled. |
