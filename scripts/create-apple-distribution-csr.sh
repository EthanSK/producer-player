#!/usr/bin/env bash
set -euo pipefail

SIGNING_DIR="${APPLE_SIGNING_DIR:-$HOME/Library/Application Support/ProducerPlayer/signing/mas}"
KEY_PATH="${APPLE_DISTRIBUTION_PRIVATE_KEY_PATH:-$SIGNING_DIR/apple_distribution_private_key.pem}"
CSR_PATH="${APPLE_DISTRIBUTION_CSR_PATH:-$SIGNING_DIR/apple_distribution_request.csr}"
SUBJECT="${APPLE_DISTRIBUTION_CSR_SUBJECT:-/emailAddress=devnull@example.com,CN=Apple Distribution,OU=Engineering,O=Producer Player,C=GB}"
FORCE="${FORCE:-false}"

mkdir -p "$SIGNING_DIR"

if [[ -f "$KEY_PATH" || -f "$CSR_PATH" ]]; then
  if [[ "$FORCE" != "true" ]]; then
    echo "Key or CSR already exists."
    echo "- key: $KEY_PATH"
    echo "- csr: $CSR_PATH"
    echo "Set FORCE=true to overwrite."
    exit 1
  fi
fi

openssl req -new -newkey rsa:2048 -nodes \
  -keyout "$KEY_PATH" \
  -out "$CSR_PATH" \
  -subj "$SUBJECT"

chmod 600 "$KEY_PATH"
chmod 600 "$CSR_PATH"

echo "Created private key: $KEY_PATH"
echo "Created CSR: $CSR_PATH"
echo "Next: upload the CSR in Apple Developer Certificates > + > Apple Distribution"
