#!/usr/bin/env bash
# Build script for the Producer Player native audio-host sidecar.
#
# Wraps CMake + progress-ping so long JUCE first-compile runs don't silently
# starve CI watchdogs. Emits "...still building..." on stderr every 30s.
#
# Usage:
#   bash scripts/build-sidecar.sh           # Release build
#   BUILD_TYPE=Debug bash scripts/build-sidecar.sh
#
# Output binary lands at build/bin/pp-audio-host (runtime output dir is
# pinned in CMakeLists.txt so every generator/IDE drops it in the same place).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

BUILD_TYPE="${BUILD_TYPE:-Release}"
BUILD_DIR="${BUILD_DIR:-build}"
# Pinned JUCE tag — matches what Phase 1a was validated against.
JUCE_TAG="${JUCE_TAG:-8.0.12}"

echo "→ pp-audio-host: configuring ($BUILD_TYPE) in $BUILD_DIR"

# v3.39 bug fix (codex review 2026-04-19): auto-bootstrap the JUCE source
# tree on a fresh checkout. The root .gitignore excludes native/pp-audio-host/
# JUCE, and there's no .gitmodules entry for it (deliberate — Phase 1a uses a
# shallow clone instead of a submodule to avoid pulling 100 MB into every
# clone). Without this block, the build fails immediately on any machine that
# doesn't already have a local JUCE checkout, defeating the sidecar's only
# bootstrap path.
if [ ! -d JUCE ]; then
  echo "→ JUCE absent — cloning tag $JUCE_TAG..."
  git clone --depth 1 --branch "$JUCE_TAG" https://github.com/juce-framework/JUCE.git JUCE
elif [ ! -d JUCE/.git ]; then
  # Directory exists but is not a git checkout (e.g. left over from a
  # corrupted prior run). Bail loudly rather than silently using stale code.
  echo "✗ JUCE/ exists but is not a git checkout. Remove it and re-run this script." >&2
  exit 1
fi

# Wait-with-progress helper: polls once per second so fast commands exit
# quickly (codex review 2026-04-19 flagged the old 30 s sleep as adding
# unconditional latency to every build), and emits a "...still running..."
# heartbeat every 30 s of real elapsed time so CI watchdogs don't time out.
wait_with_ping() {
  local pid="$1"
  local label="$2"
  local elapsed=0
  local interval=1
  local ping_every=30
  while kill -0 "$pid" 2>/dev/null; do
    sleep "$interval"
    elapsed=$((elapsed + interval))
    if [ $((elapsed % ping_every)) -eq 0 ]; then
      echo "...still ${label} (pid=$pid, elapsed=${elapsed}s)..." >&2
    fi
  done
  wait "$pid"
}

# Configure. First run on a fresh machine pulls in all of JUCE's module
# sources and can take several minutes.
(
  cmake -B "$BUILD_DIR" -S . \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"
) &
wait_with_ping "$!" "configuring JUCE"

echo "→ pp-audio-host: building"

(
  cmake --build "$BUILD_DIR" --config "$BUILD_TYPE" --target pp-audio-host --parallel
) &
wait_with_ping "$!" "building pp-audio-host"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) BIN="$HERE/$BUILD_DIR/bin/pp-audio-host.exe" ;;
  *) BIN="$HERE/$BUILD_DIR/bin/pp-audio-host" ;;
esac
if [ ! -x "$BIN" ]; then
  echo "✗ build completed but binary missing at $BIN" >&2
  exit 2
fi

echo "✓ built $BIN"
echo "→ smoke test: --scan"
"$BIN" --scan | head -c 200
echo
