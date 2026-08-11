#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

git pull
docker compose build app
docker compose up -d
docker compose run --rm migrate migrate deploy
