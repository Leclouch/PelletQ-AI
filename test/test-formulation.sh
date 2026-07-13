#!/usr/bin/env bash
# Test POST /api/formulation — PelletQ-AI
# Prasyarat: `pnpm dev` jalan di :3000 dan Docker (Postgres) sudah up + seed.

set -euo pipefail

URL="http://localhost:3000/api/formulation"

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

echo "POST $URL"
curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  -w "\n\nHTTP:%{http_code}\n"
