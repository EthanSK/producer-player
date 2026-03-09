#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_SVG="$ROOT_DIR/assets/icon/source/producer-player-icon.svg"
PNG_DIR="$ROOT_DIR/assets/icon/png"
ICONSET_DIR="$ROOT_DIR/assets/icon/ProducerPlayer.iconset"
ICNS_OUT="$ROOT_DIR/assets/icon/ProducerPlayer.icns"
PREVIEW_OUT="$ROOT_DIR/docs/assets/icon/producer-player-icon-preview.png"

if ! command -v sips >/dev/null 2>&1; then
  echo "error: sips is required (macOS)" >&2
  exit 1
fi

if ! command -v iconutil >/dev/null 2>&1; then
  echo "error: iconutil is required (macOS)" >&2
  exit 1
fi

mkdir -p "$PNG_DIR" "$ICONSET_DIR" "$(dirname "$PREVIEW_OUT")"

MASTER_PNG="$PNG_DIR/icon-1024.png"

sips -s format png -z 1024 1024 "$SOURCE_SVG" --out "$MASTER_PNG" >/dev/null

for size in 16 32 64 128 256 512 1024; do
  sips -z "$size" "$size" "$MASTER_PNG" --out "$PNG_DIR/icon-${size}.png" >/dev/null
  echo "generated: assets/icon/png/icon-${size}.png"
done

cp "$PNG_DIR/icon-16.png" "$ICONSET_DIR/icon_16x16.png"
cp "$PNG_DIR/icon-32.png" "$ICONSET_DIR/icon_16x16@2x.png"
cp "$PNG_DIR/icon-32.png" "$ICONSET_DIR/icon_32x32.png"
cp "$PNG_DIR/icon-64.png" "$ICONSET_DIR/icon_32x32@2x.png"
cp "$PNG_DIR/icon-128.png" "$ICONSET_DIR/icon_128x128.png"
cp "$PNG_DIR/icon-256.png" "$ICONSET_DIR/icon_128x128@2x.png"
cp "$PNG_DIR/icon-256.png" "$ICONSET_DIR/icon_256x256.png"
cp "$PNG_DIR/icon-512.png" "$ICONSET_DIR/icon_256x256@2x.png"
cp "$PNG_DIR/icon-512.png" "$ICONSET_DIR/icon_512x512.png"
cp "$PNG_DIR/icon-1024.png" "$ICONSET_DIR/icon_512x512@2x.png"

iconutil -c icns "$ICONSET_DIR" -o "$ICNS_OUT"
echo "generated: assets/icon/ProducerPlayer.icns"

cp "$PNG_DIR/icon-1024.png" "$PREVIEW_OUT"
echo "generated: docs/assets/icon/producer-player-icon-preview.png"
