#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose-dev.yaml"
STAMP="$(date +%s)"
EMAIL="smoketest-${STAMP}@example.com"
USERNAME="smoketest-${STAMP}"
PASSWORD="test1234"

echo "[1/6] Checking service status"
docker compose -f "$COMPOSE_FILE" ps

echo "[2/6] Checking backend health"
curl -fsS http://localhost:4646/health
echo

echo "[3/6] Checking frontend"
curl -fsSI http://localhost:4242 | head -n 1

echo "[4/6] Registering smoke user"
curl -fsS -X POST http://localhost:4646/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
echo

echo "[5/6] Logging in"
TOKEN="$(curl -fsS -X POST http://localhost:4646/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")"

echo "[6/6] Reading protected activity endpoint"
curl -fsS http://localhost:4646/activity -H "Authorization: Bearer $TOKEN"
echo
echo "Smoke test passed"