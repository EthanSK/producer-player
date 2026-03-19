#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_PROFILE_PATH="$HOME/Library/MobileDevice/Provisioning Profiles/ProducerPlayer_AppStore.provisionprofile"
PROFILE_PATH="${PRODUCER_PLAYER_PROVISIONING_PROFILE:-$DEFAULT_PROFILE_PATH}"

if [[ ! -f "$PROFILE_PATH" ]]; then
  echo "[producer-player] MAS provisioning profile not found."
  echo "Expected at: $PROFILE_PATH"
  echo "Either place the profile there or export PRODUCER_PLAYER_PROVISIONING_PROFILE first."
  exit 1
fi

export PRODUCER_PLAYER_PROVISIONING_PROFILE="$PROFILE_PATH"

"$ROOT_DIR/scripts/mas-preflight.sh"

cd "$ROOT_DIR"
exec npm run build:mac:mas
