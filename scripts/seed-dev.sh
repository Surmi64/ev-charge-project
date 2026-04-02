#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose-dev.yaml"
SEED_FILE="$ROOT_DIR/sql/dev_seed.sql"

echo "[1/3] Checking dev stack"
docker compose -f "$COMPOSE_FILE" ps

echo "[2/3] Applying development seed data"
docker exec -i garageos-postgres-dev psql -v ON_ERROR_STOP=1 -U ev_user -d ev_charger < "$SEED_FILE"

echo "[3/3] Seed complete"
echo "Demo vehicles, sessions, expenses, and unified vehicle_events rows are now available for surmi64@gmail.com"