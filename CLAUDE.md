# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GarageOS — a personal vehicle operations ledger (charging, fueling, expenses, ownership cost analytics). FastAPI + raw psycopg2 backend, Vite + React 19 + MUI frontend, PostgreSQL 17.

The repo is mid-refactor. `PHASE_0_REFACTOR_PLAN.md`, `IMPLEMENTATION_BACKLOG.md`, and `MICRO_SAAS_PLATFORM_PLAN.md` describe the intended direction; read them before large changes, but verify claims against code — some findings listed there are already fixed.

## Commands

### Full stack (the normal way to develop)

```bash
docker compose -f docker-compose-dev.yaml up --build   # db:5435, backend:4646, frontend:4242
bash scripts/smoke-dev.sh                              # health + auth + protected-endpoint smoke test
bash scripts/seed-dev.sh                               # idempotent demo data for surmi64@gmail.com
```

### Backend standalone

```bash
pip install -r backend/requirements.txt
export DB_HOST=localhost DB_PORT=5435 DB_NAME=ev_charger DB_USER=ev_user DB_PASS=ev_password
export APP_ENV=development
uvicorn backend.main:app --host 0.0.0.0 --port 4646 --reload
```

### Frontend

```bash
cd frontend && npm install
npm run dev      # vite, port 4242
npm run lint     # eslint (the only automated check in the repo)
npm run build
```

### Migrations (Alembic, from repo root)

```bash
alembic upgrade head
alembic revision -m "describe change"
```

There are two Alembic configs: `alembic.ini` (repo root, `script_location = backend/alembic`, defaults to the dev DB on `localhost:5435`) and `backend/alembic.ini` (used inside the container as `/app/alembic.ini`). `DB_*` env vars override the URL when set.

### Testing

There is no test suite — no pytest, no vitest, no test files. CI (`.github/workflows/`) only builds and pushes Docker images to a self-hosted registry; it runs no lint or tests. `scripts/smoke-dev.sh` is the closest thing to an integration test. If you add tests, you are establishing the convention.

## Architecture

### Dual-write event model (the most important invariant)

Writes go to the **legacy tables** — `charging_sessions` and `expenses`. Reads for Activity, Dashboard, and Analytics go to **`vehicle_events`**, a denormalized unified read model.

These are kept in sync explicitly in `backend/vehicle_events.py`:

- `sync_session_to_vehicle_event(db, session_id)` / `sync_expense_to_vehicle_event(db, expense_id)` — upsert on `(legacy_source, legacy_id)`
- `delete_vehicle_event_by_legacy(db, legacy_source, legacy_id)`
- `backfill_vehicle_events(db)` — bulk reconcile; called on every insights request

**Any new write path to `charging_sessions` or `expenses` must call the matching sync/delete helper before `db.commit()`, or the row will be invisible in the UI.** See `backend/routers/sessions.py` for the pattern.

`sql/target_v3_schema.sql` is the long-term direction: `vehicle_events` becomes the source of truth and the legacy tables go away.

### Runtime schema introspection

`backend/db.py` exposes `column_exists`, `table_exists`, and `get_vehicle_column`. Routers call these on each request to tolerate databases at different migration states — e.g. `get_vehicle_column(db)` returns `vehicle_id_ref` or `vehicle_id` and is interpolated into f-string SQL. Feature code guards optional columns the same way (`is_archived` in `vehicle_rules.py`). Preserve this pattern when touching queries that use it; the column name is the only interpolated value — all user data goes through psycopg2 parameters.

### Backend layout

- `main.py` — app assembly, CORS, request-ID middleware, structured JSON exception handlers
- `routers/` — `auth`, `admin`, `vehicles`, `expenses`, `sessions`, `activity`, `insights`, `health`
- `config.py` — env-driven; refuses to start outside development without a non-default `JWT_SECRET_KEY`
- `vehicle_rules.py` — fuel-type business rules (electric ⇒ charging only, petrol/diesel ⇒ fueling only, hybrid ⇒ both) plus payload normalization and ownership checks
- `logging_utils.py` — `log_event` structured logging

Every module uses a `try: from backend.X ... except ModuleNotFoundError: from X` import shim, because the container runs with `/app` as the working directory while local dev runs from the repo root. Match this in new modules.

Routers depend on `get_current_user_id` and scope every query by `user_id` — user isolation is enforced in the SQL `WHERE` clause, not by a middleware layer.

### Auth

JWT access token (HS256, 12h default) plus an opaque refresh token stored SHA-256-hashed in `user_sessions` (30d default). `auth_audit_logs` records auth events; `auth_rate_limit.py` throttles attempts. Roles are `user` / `admin`; admin routes live in `routers/admin.py` and are gated frontend-side by `AdminRoute` in `App.jsx`.

### Frontend

- `context/AuthContext.jsx` holds token state, persists to `localStorage`, refreshes on a 10-minute interval, and retries `401`s once via `/api/auth/refresh`. Consume via `useAuth()` (`context/useAuth.jsx`) — never read `localStorage` directly in components.
- All components `fetch` **relative `/api/...` paths** with a manual `Authorization: Bearer` header. There is no API client module and `VITE_API_URL` is not read anywhere in `src/` despite being set in the compose files.
- `/api` is proxied by nginx (`frontend/nginx.conf`) in the built image, and by the Vite dev proxy in development. **The Vite proxy targets `http://backend:4646`, a Docker service hostname** — running `npm run dev` on the host will fail to reach the API unless you change that target in `vite.config.js`.
- Routes are lazy-loaded and wrapped in `PrivateRoute`/`AdminRoute`. The MUI theme is defined inline in `App.jsx` (dark by default, industrial/neon styling); theme mode persists to the user record via `PATCH /api/auth/me`.

### Database bootstrap

`sql/phase0_bootstrap.sql` is mounted into `docker-entrypoint-initdb.d` and only runs on a **fresh volume**. After schema changes, either add an Alembic revision or `docker compose -f docker-compose-dev.yaml down -v` to re-init. `sql/dev_seed.sql` is seed data only and is deliberately outside the migration path.

## Conventions

- Backend uses single quotes for strings and raw SQL via `cur.execute` with `%s` parameters; no ORM (SQLAlchemy is present only for Alembic).
- Mutating router handlers wrap work in `try/except`, re-raise `HTTPException`, and `db.rollback()` on other exceptions.
- Currency defaults to `HUF` throughout.
