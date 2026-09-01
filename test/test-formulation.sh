#!/usr/bin/env bash
# Test POST /api/formulation — PelletQ-AI
# Prasyarat: `pnpm dev` jalan di :3000 dan Docker (Postgres) sudah up + seed.
#
# Sekarang endpoint diproteksi Auth.js: harus login dulu (Credentials) untuk
# mendapat cookie session, lalu pakai cookie itu saat POST formulasi.

set -euo pipefail

BASE="http://localhost:3000"
URL="$BASE/api/formulation"
COOKIES="$(dirname "$0")/cookies.txt"

# Kredensial diambil dari environment supaya tidak ada password di repo:
#   SEED_ADMIN_USERNAME=... SEED_ADMIN_PASSWORD=... ./test/test-formulation.sh
USERNAME="${SEED_ADMIN_USERNAME:?set SEED_ADMIN_USERNAME dulu}"
PASSWORD="${SEED_ADMIN_PASSWORD:?set SEED_ADMIN_PASSWORD dulu}"

# fishSpeciesId & ingredientId diambil dari database (seed). Update jika re-seed.
read -r -d '' BODY <<'JSON' || true
{
  "fishSpeciesId": "cmqnpcf0w0000njkkxluc6eke",
  "phase": "GROWER",
  "umurIkanHari": 45,
  "jumlahIkanEkor": 7000,
  "bobotRataRataGram": 20,
  "jenisPelet": "TERAPUNG",
  "diameterPelletMm": 2.5,
  "panjangPelet": "SEDANG",
  "targetProduksiKgBatch": 5,
  "prioritas": "TERMURAH",
  "modeOperasi": "MANUAL",
  "bahanBaku": [
    { "ingredientId": "cmqnpcf1x0005njkk3c4xyijr", "stokKg": 3, "hargaPerKg": 15000, "kondisiBahan": "KERING", "bentukBahan": "HALUS" },
    { "ingredientId": "cmqnpcf220006njkkc21spcjg", "stokKg": 3, "hargaPerKg": 8000,  "kondisiBahan": "KERING", "bentukBahan": "HALUS" },
    { "ingredientId": "cmqnpcf270007njkkfaqyea2r", "stokKg": 5, "hargaPerKg": 5000,  "kondisiBahan": "KERING", "bentukBahan": "SEDANG" },
    { "ingredientId": "cmqnpcf2c0008njkki3iz7ssf", "stokKg": 5, "hargaPerKg": 3000,  "kondisiBahan": "KERING", "bentukBahan": "SEDANG" },
    { "ingredientId": "cmqnpcf2h0009njkkivewf88z", "stokKg": 3, "hargaPerKg": 7000,  "kondisiBahan": "KERING", "bentukBahan": "HALUS" }
  ]
}
JSON

# ------------------------------------------------------------------
# 1. Login: ambil CSRF token (sekaligus set cookie csrf ke jar), lalu
#    POST ke callback credentials untuk mendapat cookie session.
# ------------------------------------------------------------------
echo "→ Login sebagai $USERNAME"
CSRF=$(curl -s -c "$COOKIES" "$BASE/api/auth/csrf" \
  | grep -o '"csrfToken":"[^"]*"' | cut -d'"' -f4)

curl -s -c "$COOKIES" -b "$COOKIES" \
  -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "username=$USERNAME" \
  --data-urlencode "password=$PASSWORD" \
  --data-urlencode "callbackUrl=$BASE/" \
  -o /dev/null

if grep -q "authjs.session-token" "$COOKIES"; then
  echo "✓ Cookie session diperoleh"
else
  echo "✗ Gagal login — cookie session tidak ada. Hentikan."
  exit 1
fi

# ------------------------------------------------------------------
# 2. POST formulasi dengan cookie session
# ------------------------------------------------------------------
echo ""
echo "POST $URL (dengan cookie session)"
curl -s -b "$COOKIES" -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  -w "\n\nHTTP:%{http_code}\n"
