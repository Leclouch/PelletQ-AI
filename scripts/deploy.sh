#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

git pull
docker compose build app migrate
docker compose run --rm migrate migrate deploy
docker compose up -d
