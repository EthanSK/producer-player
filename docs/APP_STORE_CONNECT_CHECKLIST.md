# App Store Connect submission checklist (Producer Player)

_Last updated: 2026-03-19_

Bundle ID: `com.ethansk.producerplayer`
Product: `Producer Player`

## 0) Run local MAS preflight first

```bash
npm run mas:preflight
```

This checks:
- signing identities in keychain
- provisioning profile wiring
- upload tooling availability (Xcode/Transporter)
- screenshot asset pack presence

If preflight fails, fix blockers before trying to submit.

Current blockers observed on Ethan’s Mac mini (2026-03-19):
- no `Apple Distribution` identity in keychain
- no MAS provisioning profile at default path
- no `iTMSTransporter` (Xcode/Transporter not installed)
- browser session to App Store Connect currently redirects with `authResult=FAILED` (sign-in required)

---

## 1) Apple Developer prerequisites

- [ ] Apple Developer Program membership active
- [ ] App ID exists for `com.ethansk.producerplayer`
- [ ] Apple Distribution certificate installed in login keychain
- [ ] (Optional) Apple Development certificate installed for `mas-dev` testing
- [ ] Mac App Store provisioning profile created for `com.ethansk.producerplayer`
- [ ] `PRODUCER_PLAYER_PROVISIONING_PROFILE` points to that profile path

Useful scripts:

```bash
# Generate CSR + private key pair (if you need a new Apple Distribution cert request)
./scripts/create-apple-distribution-csr.sh

# Convert downloaded Apple Distribution cert + private key into .p12
P12_PASSWORD='...' ./scripts/prepare-apple-distribution-p12.sh /path/to/AppleDistribution.cer
```

---

## 2) Build MAS binary locally

```bash
# Uses build-mode preflight + MAS build
npm run build:mac:mas:local

# or explicitly
PRODUCER_PLAYER_PROVISIONING_PROFILE='/absolute/path/to/profile.provisionprofile' npm run build:mac:mas
```

Expected artifact (release dir):
- `Producer-Player-<version>-mas-<arch>.pkg`

---

## 3) Upload binary to App Store Connect

Requires `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD`.

```bash
APPLE_ID='you@example.com' \
APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx' \
npm run mas:upload
```

Optional if your account needs an explicit provider short name:

```bash
ITMSTRANSPORTER_PROVIDER_SHORT_NAME='YOUR_PROVIDER' ...
```

---

## 4) App Store Connect app record checklist

### App Information
- [ ] App record exists (`Producer Player`, macOS)
- [ ] Category set (Music)
- [ ] Content rights completed
- [ ] Age rating completed
- [ ] Privacy policy URL set

### Pricing and Availability
- [ ] Price tier selected
- [ ] Availability regions selected

### Version metadata
- [ ] Version number set (match uploaded build)
- [ ] Subtitle
- [ ] Description
- [ ] Keywords
- [ ] Support URL
- [ ] Marketing URL (optional)
- [ ] Promotional text (optional)

### App Privacy / compliance
- [ ] Data collection / privacy nutrition labels completed
- [ ] Export compliance declaration completed

### Review information
- [ ] Contact details
- [ ] Demo account (if needed)
- [ ] Notes for reviewer

---

## 5) Screenshots

Generate with:

```bash
npm run mas:screenshots
```

Output directory:

`artifacts/app-store-connect/screenshots/`

Generated set includes:
- `producer-player-1440x900.png`
- `producer-player-checklist-1440x900.png`
- `producer-player-readme-1440x900.png`
- `producer-player-1280x800.png`
- `producer-player-checklist-1280x800.png`
- `producer-player-readme-1280x800.png`

Upload these in App Store Connect for the macOS app version.

---

## 6) Submit

- [ ] Build finished processing in App Store Connect
- [ ] Build attached to the app version
- [ ] All required sections show complete
- [ ] Submit for Review
