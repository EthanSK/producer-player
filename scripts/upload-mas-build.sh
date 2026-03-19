#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TRANSPORTER_BIN=""
if xcrun --find iTMSTransporter >/dev/null 2>&1; then
  TRANSPORTER_BIN="$(xcrun --find iTMSTransporter)"
elif [[ -x "/Applications/Transporter.app/Contents/itms/bin/iTMSTransporter" ]]; then
  TRANSPORTER_BIN="/Applications/Transporter.app/Contents/itms/bin/iTMSTransporter"
fi

if [[ -z "$TRANSPORTER_BIN" ]]; then
  echo "No iTMSTransporter found. Install Xcode or Apple's Transporter app first."
  exit 1
fi

if [[ -z "${APPLE_ID:-}" ]]; then
  echo "APPLE_ID is required."
  exit 1
fi

if [[ -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
  echo "APPLE_APP_SPECIFIC_PASSWORD is required (app-specific password from appleid.apple.com)."
  exit 1
fi

if [[ $# -gt 0 ]]; then
  PKG_PATH="$1"
else
  PKG_PATH="$(find "$ROOT_DIR/release" -maxdepth 1 -type f -name 'Producer-Player-*-mas-*.pkg' -print | sort | tail -n 1)"
fi

if [[ -z "$PKG_PATH" || ! -f "$PKG_PATH" ]]; then
  echo "MAS .pkg not found."
  echo "Build one first with: npm run build:mac:mas"
  exit 1
fi

ARGS=(
  -m upload
  -assetFile "$PKG_PATH"
  -u "$APPLE_ID"
  -p "$APPLE_APP_SPECIFIC_PASSWORD"
  -v informational
)

if [[ -n "${ITMSTRANSPORTER_PROVIDER_SHORT_NAME:-}" ]]; then
  ARGS+=( -itc_provider "$ITMSTRANSPORTER_PROVIDER_SHORT_NAME" )
fi

echo "Uploading: $PKG_PATH"
echo "Using transporter: $TRANSPORTER_BIN"

exec "$TRANSPORTER_BIN" "${ARGS[@]}"
