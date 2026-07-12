#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "App-audio output capture currently requires macOS." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$SCRIPT_DIR/CaptureAppAudio.swift"
BUILD_DIR="${TMPDIR:-/tmp}/producer-player-audio-output-diagnostics"
BINARY="$BUILD_DIR/capture-app-audio"

mkdir -p "$BUILD_DIR"

if [[ ! -x "$BINARY" || "$SOURCE" -nt "$BINARY" ]]; then
  xcrun swiftc \
    -O \
    -parse-as-library \
    -framework AVFoundation \
    -framework AudioToolbox \
    -framework CoreGraphics \
    -framework CoreMedia \
    -framework ScreenCaptureKit \
    "$SOURCE" \
    -o "$BINARY"
fi

exec "$BINARY" "$@"
