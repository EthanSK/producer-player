#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/AppleDistribution.cer [output.p12]"
  exit 1
fi

CERT_PATH="$1"
DEFAULT_SIGNING_DIR="$HOME/Library/Application Support/ProducerPlayer/signing/mas"
DEFAULT_KEY_PATH="$DEFAULT_SIGNING_DIR/apple_distribution_private_key.pem"
DEFAULT_OUTPUT_P12="$DEFAULT_SIGNING_DIR/apple_distribution.p12"

OUTPUT_P12="${2:-$DEFAULT_OUTPUT_P12}"
KEY_PATH="${APPLE_DISTRIBUTION_PRIVATE_KEY_PATH:-$DEFAULT_KEY_PATH}"

if [[ ! -f "$CERT_PATH" ]]; then
  echo "Certificate file not found: $CERT_PATH"
  exit 1
fi

if [[ ! -f "$KEY_PATH" ]]; then
  echo "Private key file not found: $KEY_PATH"
  echo "Set APPLE_DISTRIBUTION_PRIVATE_KEY_PATH if your key is elsewhere."
  exit 1
fi

if [[ -z "${P12_PASSWORD:-}" ]]; then
  echo "Set P12_PASSWORD before running this script (password used to encrypt output .p12)."
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_P12")"

CERT_PEM_TMP="$(mktemp /tmp/apple-distribution-cert.XXXXXX.pem)"
cleanup() {
  rm -f "$CERT_PEM_TMP"
}
trap cleanup EXIT

if ! openssl x509 -in "$CERT_PATH" -inform DER -out "$CERT_PEM_TMP" 2>/dev/null; then
  openssl x509 -in "$CERT_PATH" -out "$CERT_PEM_TMP"
fi

openssl pkcs12 -export \
  -inkey "$KEY_PATH" \
  -in "$CERT_PEM_TMP" \
  -out "$OUTPUT_P12" \
  -name "Apple Distribution" \
  -passout "pass:${P12_PASSWORD}"

echo "Created: $OUTPUT_P12"
echo "Next (install into login keychain):"
echo "  security import \"$OUTPUT_P12\" -k ~/Library/Keychains/login.keychain-db -P \"<P12_PASSWORD>\" -T /usr/bin/codesign -T /usr/bin/security"
