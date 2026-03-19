#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_PROFILE_PATH="$HOME/Library/MobileDevice/Provisioning Profiles/ProducerPlayer_AppStore.provisionprofile"
PROFILE_PATH="${PRODUCER_PLAYER_PROVISIONING_PROFILE:-$DEFAULT_PROFILE_PATH}"
SCREENSHOT_DIR="$ROOT_DIR/artifacts/app-store-connect/screenshots"

read_package_field() {
  local field_path="$1"
  python3 - "$ROOT_DIR/package.json" "$field_path" <<'PY'
import json
import sys

package_path = sys.argv[1]
field_path = sys.argv[2].split('.')

with open(package_path, 'r', encoding='utf-8') as fh:
    payload = json.load(fh)

cursor = payload
for segment in field_path:
    cursor = cursor[segment]

print(cursor)
PY
}

APP_ID="$(read_package_field "build.appId")"
APP_VERSION="$(read_package_field "version")"
PRODUCT_NAME="$(read_package_field "build.productName")"

BLOCKERS=()
WARNINGS=()
OK_ITEMS=()

append_blocker() {
  BLOCKERS+=("$1")
}

append_warning() {
  WARNINGS+=("$1")
}

append_ok() {
  OK_ITEMS+=("$1")
}

# ---- signing identities ----
IDENTITIES_OUTPUT="$(security find-identity -v -p codesigning 2>/dev/null || true)"

if grep -q "Apple Distribution" <<<"$IDENTITIES_OUTPUT"; then
  append_ok "Apple Distribution signing identity present"
else
  append_blocker "Apple Distribution signing identity missing from keychain"
fi

if grep -q "Apple Development" <<<"$IDENTITIES_OUTPUT"; then
  append_ok "Apple Development signing identity present"
else
  append_warning "Apple Development signing identity missing (only needed for mas-dev builds)"
fi

# ---- provisioning profile ----
if [[ -f "$PROFILE_PATH" ]]; then
  PROFILE_PLIST="$(mktemp /tmp/producer-player-profile.XXXXXX.plist)"
  cleanup_profile_plist() {
    rm -f "$PROFILE_PLIST"
  }
  trap cleanup_profile_plist EXIT

  if security cms -D -i "$PROFILE_PATH" > "$PROFILE_PLIST" 2>/dev/null; then
    PROFILE_NAME="$(plutil -extract Name raw -o - "$PROFILE_PLIST" 2>/dev/null || true)"
    PROFILE_UUID="$(plutil -extract UUID raw -o - "$PROFILE_PLIST" 2>/dev/null || true)"
    PROFILE_EXPIRY="$(plutil -extract ExpirationDate raw -o - "$PROFILE_PLIST" 2>/dev/null || true)"
    TEAM_ID="$(plutil -extract TeamIdentifier.0 raw -o - "$PROFILE_PLIST" 2>/dev/null || true)"
    APPLICATION_IDENTIFIER="$(plutil -extract Entitlements.application-identifier raw -o - "$PROFILE_PLIST" 2>/dev/null || true)"

    if [[ "$APPLICATION_IDENTIFIER" == *".$APP_ID" ]]; then
      append_ok "Provisioning profile found and matches app id ($APPLICATION_IDENTIFIER)"
    else
      append_blocker "Provisioning profile app id mismatch (profile has '$APPLICATION_IDENTIFIER', expected '*.$APP_ID')"
    fi

    if [[ -n "$TEAM_ID" ]]; then
      append_ok "Provisioning profile Team ID: $TEAM_ID"
    else
      append_warning "Could not read TeamIdentifier from provisioning profile"
    fi

    if [[ -n "$PROFILE_NAME" || -n "$PROFILE_UUID" || -n "$PROFILE_EXPIRY" ]]; then
      append_ok "Provisioning profile details: ${PROFILE_NAME:-<unknown>} ${PROFILE_UUID:+(UUID $PROFILE_UUID)} ${PROFILE_EXPIRY:+expires $PROFILE_EXPIRY}"
    fi
  else
    append_blocker "Provisioning profile exists but could not be decoded via 'security cms -D -i'"
  fi
else
  append_blocker "Provisioning profile missing at '$PROFILE_PATH' (set PRODUCER_PLAYER_PROVISIONING_PROFILE)"
fi

# ---- upload toolchain ----
if xcrun --find iTMSTransporter >/dev/null 2>&1; then
  TRANSPORTER_PATH="$(xcrun --find iTMSTransporter)"
  append_ok "Upload tool available: $TRANSPORTER_PATH"
elif [[ -x "/Applications/Transporter.app/Contents/itms/bin/iTMSTransporter" ]]; then
  append_ok "Upload tool available: /Applications/Transporter.app/Contents/itms/bin/iTMSTransporter"
else
  append_blocker "No iTMSTransporter found (install Xcode or Apple's Transporter app)"
fi

if xcodebuild -version >/dev/null 2>&1; then
  append_ok "Xcode available for local MAS build/upload tooling"
else
  append_warning "Full Xcode not installed (using CommandLineTools only)"
fi

# ---- screenshot pack checks ----
if [[ -d "$SCREENSHOT_DIR" ]]; then
  required_files=(
    "$SCREENSHOT_DIR/producer-player-1440x900.png"
    "$SCREENSHOT_DIR/producer-player-checklist-1440x900.png"
    "$SCREENSHOT_DIR/producer-player-readme-1440x900.png"
    "$SCREENSHOT_DIR/producer-player-1280x800.png"
    "$SCREENSHOT_DIR/producer-player-checklist-1280x800.png"
    "$SCREENSHOT_DIR/producer-player-readme-1280x800.png"
  )

  missing_count=0
  for screenshot in "${required_files[@]}"; do
    if [[ ! -f "$screenshot" ]]; then
      missing_count=$((missing_count + 1))
    fi
  done

  if [[ "$missing_count" -eq 0 ]]; then
    append_ok "App Store screenshot set present in artifacts/app-store-connect/screenshots"
  else
    append_warning "Missing $missing_count expected screenshot file(s) in artifacts/app-store-connect/screenshots"
  fi
else
  append_warning "Screenshot directory missing ($SCREENSHOT_DIR)"
fi

# ---- existing MAS build artifact ----
MAS_PKG_COUNT="$(find "$ROOT_DIR/release" -maxdepth 1 -type f -name 'Producer-Player-*-mas-*.pkg' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$MAS_PKG_COUNT" -gt 0 ]]; then
  append_ok "Found $MAS_PKG_COUNT MAS pkg artifact(s) in release/"
else
  append_warning "No MAS pkg artifacts in release/ yet (run npm run build:mac:mas after blockers are fixed)"
fi

# ---- report ----
echo ""
echo "Producer Player MAS preflight"
echo "- Product: $PRODUCT_NAME"
echo "- Version: $APP_VERSION"
echo "- Bundle ID: $APP_ID"
echo "- Profile path: $PROFILE_PATH"
echo ""

echo "✅ Ready checks"
if [[ "${#OK_ITEMS[@]}" -eq 0 ]]; then
  echo "- (none)"
else
  for item in "${OK_ITEMS[@]}"; do
    echo "- $item"
  done
fi

echo ""
echo "⚠️ Warnings"
if [[ "${#WARNINGS[@]}" -eq 0 ]]; then
  echo "- (none)"
else
  for item in "${WARNINGS[@]}"; do
    echo "- $item"
  done
fi

echo ""
echo "❌ Blockers"
if [[ "${#BLOCKERS[@]}" -eq 0 ]]; then
  echo "- (none)"
  echo ""
  echo "MAS preflight passed."
  exit 0
fi

for item in "${BLOCKERS[@]}"; do
  echo "- $item"
done

echo ""
echo "MAS preflight failed (${#BLOCKERS[@]} blocker(s))."
exit 1
