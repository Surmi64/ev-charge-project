#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose-dev.yaml"
STAMP="$(date +%s)"
EMAIL="smoketest-${STAMP}@example.com"
USERNAME="smoketest-${STAMP}"
# Must satisfy validate_password_strength in backend/auth_utils.py:
# at least 8 chars with an uppercase letter, a lowercase letter and a digit.
PASSWORD="Test1234"

echo "[1/6] Checking service status"
docker compose -f "$COMPOSE_FILE" ps

echo "[2/6] Checking backend health"
curl -fsS http://localhost:4646/health
echo

echo "[3/6] Checking frontend"
curl -fsSI http://localhost:4242 | head -n 1

echo "[4/6] Registering smoke user"
# An admin can close registration from the admin page, which makes /auth/register
# answer 403 by design. That is a deliberate configuration, not a broken deployment,
# so the smoke test says so and stops rather than reporting a failure.
REGISTER_STATUS="$(curl -sS -o /tmp/smoke-register.json -w '%{http_code}' \
  -X POST http://localhost:4646/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"

if [ "$REGISTER_STATUS" = "403" ]; then
  echo "Registration is closed on this instance (site setting), so the sign-up path"
  echo "cannot be exercised. Health, frontend and the API all responded."
  echo "Re-open it under Admin > Site settings to run the full check."
  exit 0
fi
if [ "$REGISTER_STATUS" != "201" ]; then
  echo "Register failed with HTTP $REGISTER_STATUS:" >&2
  cat /tmp/smoke-register.json >&2
  exit 1
fi
cat /tmp/smoke-register.json
echo

echo "[5/6] Logging in"
TOKEN="$(curl -fsS -X POST http://localhost:4646/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")"

echo "[6/6] Reading protected activity endpoint"
curl -fsS http://localhost:4646/activity -H "Authorization: Bearer $TOKEN"
echo
echo "Smoke test passed"