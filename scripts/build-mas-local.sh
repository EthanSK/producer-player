#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_PROFILE_PATH="$HOME/Library/MobileDevice/Provisioning Profiles/ProducerPlayer_AppStore.provisionprofile"
export PRODUCER_PLAYER_PROVISIONING_PROFILE="${PRODUCER_PLAYER_PROVISIONING_PROFILE:-$DEFAULT_PROFILE_PATH}"

"$ROOT_DIR/scripts/mas-preflight.sh" --for build

cd "$ROOT_DIR"
exec npm run build:mac:mas
