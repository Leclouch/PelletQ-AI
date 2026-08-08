#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${MQTT_DOMAIN:?MQTT_DOMAIN must be set (see .env)}"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

docker compose cp caddy:/data/caddy/certificates "$TMP_DIR/certs"

CERT_DIR=$(find "$TMP_DIR/certs" -type d -name "$MQTT_DOMAIN" | head -n1)
if [ -z "$CERT_DIR" ]; then
  echo "No cert directory found for $MQTT_DOMAIN yet - has Caddy issued it? (check: docker compose logs caddy)" >&2
  exit 1
fi

SRC_CRT="$CERT_DIR/$MQTT_DOMAIN.crt"
SRC_KEY="$CERT_DIR/$MQTT_DOMAIN.key"
DEST_DIR="mosquitto/certs"
DEST_CRT="$DEST_DIR/fullchain.pem"
DEST_CHAIN="$DEST_DIR/chain.pem"
DEST_KEY="$DEST_DIR/privkey.pem"

if [ ! -f "$SRC_CRT" ] || [ ! -f "$SRC_KEY" ]; then
  echo "Cert/key files missing in $CERT_DIR" >&2
  exit 1
fi

if [ -f "$DEST_CRT" ] && cmp -s "$SRC_CRT" "$DEST_CRT"; then
  echo "Cert for $MQTT_DOMAIN unchanged, nothing to do."
  exit 0
fi

mkdir -p "$DEST_DIR"
cp "$SRC_CRT" "$DEST_CRT"
cp "$SRC_CRT" "$DEST_CHAIN"
cp "$SRC_KEY" "$DEST_KEY"
chmod 644 "$DEST_CRT" "$DEST_CHAIN" "$DEST_KEY"

echo "Cert for $MQTT_DOMAIN updated, restarting mosquitto..."
docker compose restart mosquitto
