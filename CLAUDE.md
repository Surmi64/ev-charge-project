# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mileage — a vehicle cost tracker for mixed fleets. Records charging, fueling and every ownership cost (insurance, tax, maintenance, tolls) across electric, hybrid, petrol and diesel vehicles, and reports what each actually costs to run. Multi-tenant SaaS: EUR 5/month or 50/year after a 30 day trial.

FastAPI + raw psycopg2 backend, Vite + React 19 + MUI frontend, PostgreSQL 17.

`MICRO_SAAS_PLATFORM_PLAN.md`, `IMPLEMENTATION_BACKLOG.md` and `PHASE_0_REFACTOR_PLAN.md` describe intent, but they predate a lot of this — verify against code before trusting them.

## Commands

### Full stack (the normal way to develop)

```bash
docker compose -f docker-compose-dev.yaml up --build   # db:5435, backend:4646, frontend:4242
bash scripts/smoke-dev.sh                              # health + auth + protected-endpoint check
bash scripts/seed-dev.sh                               # idempotent demo data
```

Containers are named `mileage-{postgres,backend,frontend}-dev`. Renaming the compose project changes the volume name too, which resets the dev database.

### Frontend

```bash
cd frontend && npm install
npm run lint     # eslint — currently clean, keep it that way
npm run build
```

`npm run dev` will not reach the API: `vite.config.js` proxies `/api` to `http://backend:4646`, a Docker service hostname. Change the target or work through the compose stack.

### Migrations (Alembic, from repo root)

```bash
alembic upgrade head
alembic revision -m "describe change"
```

`alembic.ini` at the repo root points at the dev DB on `localhost:5435`; `backend/alembic.ini` is the container copy. `DB_*` env vars override the URL.

**`sql/phase0_bootstrap.sql` is the full head-state schema and stamps `alembic_version` itself.** A fresh database is therefore already migrated and `alembic upgrade head` is a no-op. Any schema change needs updating in both places, including the stamp version. Do not run `alembic stamp head` against a database created some other way — check what actually exists first.

### Testing

There is no test suite. `scripts/smoke-dev.sh` is the closest thing to one, and `scripts/qa-accounts.py` goes deeper: two throwaway accounts, tenant isolation between them, then verification, sessions, export, feedback, scheduled deletion and the login limit, cleaning up after itself. `scripts/qa-fleet.py` does the same for fleets: owner, manager, driver and outsider, what each can reach, invitations, reassignment and removal. `scripts/qa-mfa.py` covers the refresh cookie (attributes, rotation, grace period) and two-step sign-in, including the admin requirement. All three need registration open and the dev containers. CI only builds images. If you add tests you are setting the convention.

For UI work, a headless Chromium is available at `/snap/bin/chromium` and `puppeteer-core` drives it. Layout shift, loading flicker and unit formatting have all been verified that way — lint and build catch none of them.

## Architecture

### Tenant isolation is enforced by the database

Row level security on `vehicles`, `charging_sessions`, `expenses`, `vehicle_events`, `recurring_expense_reminders` and `subscriptions`. Policies match on `current_setting('app.user_id')`, which `billing.get_workspace` (behind `get_tenant_db`) sets once per request.

- **Every endpoint touching user data must depend on `get_tenant_db`, not `get_db`, and take its id from `get_tenant_user_id`, not `get_current_user_id`.** The policy uses `NULLIF(...)`, so a connection that never sets the tenant matches nothing and returns zero rows rather than everyone's. The two ids differ inside a fleet (below) — filtering by the caller's own id there finds nothing, or inserts rows the policy refuses.
- What belongs to the person rather than to the records — profile, export, feedback, fleet membership — uses `get_own_db`, which ignores the workspace header.
- **The app connects as `DB_APP_USER` (`mileage_app`), which must not be a superuser and must not hold `BYPASSRLS`.** Either one silently disables every policy. `DB_USER` stays the owner and is used for migrations only.
- Admin endpoints deliberately use `get_db`, so `app.user_id` is unset and an admin cannot read another account's records even with a query that omits a `WHERE` clause. `subscriptions` carries an extra `app.admin` escape because plan state is what user management needs.

The auth tables (`users`, `user_sessions`, `password_reset_tokens`, `auth_audit_logs`) are excluded: login has to read them before any identity exists.

### Dual-write event model

Writes go to `charging_sessions` and `expenses`. Reads for Records, Dashboard and Analytics come from `vehicle_events`, a denormalized read model. `backend/vehicle_events.py` keeps them in step:

- `sync_session_to_vehicle_event` / `sync_expense_to_vehicle_event` — upsert on `(legacy_source, legacy_id)`
- `delete_vehicle_event_by_legacy`
- `backfill_vehicle_events` — bulk reconcile, **not called from any request path**

**Any new write to `charging_sessions` or `expenses` must call the matching sync/delete helper before `db.commit()`, or the row never appears in the UI.** See `routers/sessions.py`.

The backfill used to run on every read, which cost a full scan of both tables per request and achieved nothing — those endpoints never commit, so the rows were discarded each time. It is now reserved for data written directly to the database. `sql/target_v3_schema.sql` is the long-term direction, where `vehicle_events` becomes the source of truth.

### Subscriptions

`backend/billing.py` owns plan state. New accounts get a 30 day trial; `require_write_access` gates every mutating endpoint and answers **402** once it lapses. Reads and CSV export are deliberately never gated, so a lapsed account keeps access to its own data.

No payment provider is connected. The `provider*` columns exist for one, and an admin activates plans through `PATCH /admin/subscriptions/{user_id}`.

### Fleets

A fleet is an ordinary account (the owner) that other accounts are let into, as `manager` (every vehicle) or `driver` (the vehicles in `fleet_members.vehicle_ids`). The client sends `X-Mileage-Workspace: <owner id>`; `get_workspace` checks the membership on every request and binds `app.user_id` to the **owner**, so every tenant policy and every existing query works unchanged. For a driver it also sets `app.vehicle_ids`, which the five vehicle-bound policies honour — a driver's restriction lives in the database, not in each query. Unset or empty means all vehicles, which is what owners, managers and the notification worker get.

- `app.actor_id` is always the signed-in person. `charging_sessions.recorded_by` / `expenses.recorded_by` default from it, so no insert names the author; Records shows "by X" when it is not the owner.
- `require_fleet_manager` keeps drivers out of shaping the fleet: vehicles create/edit/delete, recurring costs, notification recipients, place management, CSV import. The UI hides the same controls via `canManage`.
- The owner's plan gates writes (`require_write_access` reads the tenant's subscription); the email-confirmation check stays the caller's own. `/billing/me` answers for the workspace, flagged `managed_by_fleet_owner`.
- Only the owner manages membership (`routers/fleet.py`). Invitations are hashed tokens, valid 14 days; the link is also returned to the owner so a fleet can be set up before mail works. A link can be accepted by any signed-in account (the owner chose whom to send it to); an in-app invitation needs the account's confirmed address to match. A stale header answers 403 with `X-Mileage-Workspace-Invalid`, and `api.js` drops it.
- Frontend: `AuthContext` exposes `workspace`, `switchWorkspace` (stores the id and reloads, since every page holds data for the old workspace), `canManage`, and overlays the owner's currency/unit/calculation settings onto `user`; `account` is the person's own row. Onboarding never shows inside a fleet.

### Client address, headers and the service worker

The API is only reached through the frontend's nginx, which resolves the real client from `X-Forwarded-For` (trusting only private and Tailscale hops, `set_real_ip_from` in `frontend/nginx.conf`) and passes it as `X-Real-IP`. `get_client_ip` reads that. Using `request.client.host` instead gives the proxy container's address for everyone — every per-IP limit then throttles all users at once.

`frontend/nginx-security-headers.conf` carries the CSP and friends, included per location because nginx drops inherited `add_header` as soon as a location sets its own. A new third-party origin (tile provider, payment overlay) has to be added to the CSP. `public/sw.js` handles same-origin GETs only: a request the worker re-fetches is held to the *worker's* `connect-src 'self'`, which blocked every map tile and web font when it intercepted everything.

### Accounts

Sign-up records `terms_accepted_at`/`terms_version` and queues a confirmation link. `require_email_verification` (site setting, off by default) makes `require_write_access` refuse unconfirmed accounts with 403 — leave it off until outgoing mail works, or nobody new can record anything. Access tokens carry `sid`, the refresh session they belong to, which is how the session list marks "this device". Self-service deletion revokes every session and waits 30 days; signing in shows a banner that cancels it.

**The refresh token is an httpOnly, Secure, SameSite=Strict cookie (`mileage_refresh`, path `/api/auth`) and never appears in a response body.** The access token lives only in `api.js` memory, so every page load restores the session through `/auth/refresh`. The cookie path is the one the browser sees — nginx strips `/api` — so scripts calling the backend directly on :4646 read the `Set-Cookie` header and send the token in the body, which is still accepted (also for one release of browsers holding a pre-cookie token in localStorage). Rotation keeps `previous_token_hash` valid for `REFRESH_GRACE_SECONDS`, and `api.js` serialises refreshes across tabs with Web Locks: every tab shares the one cookie.

Two-step sign-in is TOTP (`backend/mfa.py`, RFC 6238 written out, no dependency) with ten hashed single-use recovery codes. With it on, `/auth/login` answers `{mfa_required, mfa_token}` — a five-minute challenge signed under a *different* key, so it is useless as an access token — and `/auth/login/mfa` opens the session. `totp_last_step` stops a code being replayed. Enabling it signs out every other session. The `require_admin_mfa` site setting keeps admins without it out of `require_admin_user` (403 + `X-Mileage-Mfa-Required`); it cannot be saved by an admin who would be locked out. The TOTP secret is stored in plain text, like the password hash beside it — a database leak is already the worst case.

### Units and currency

Distance is stored in kilometres and volume in litres; the client converts for display, which is why `_km` and `_kwh` suffixes on API fields are accurate and worth keeping.

**Currency is a label, not a conversion.** Amounts are stored exactly as entered. Changing the account currency relabels future entries and leaves history alone — converting would need the exchange rate on each entry's original date. `frontend/src/utils/units.js` is the only place that formats money, distance or volume; do not format them inline.

Cost per 100 km converts by *dividing* by the distance factor, since 100 miles is the longer trip.

### Backend layout

- `main.py` — app assembly, CORS, request-ID middleware, structured JSON exception handlers
- `billing.py` — subscription state, `get_tenant_db`, `require_write_access`
- `routers/` — `auth`, `admin`, `billing`, `fleet`, `vehicles`, `expenses`, `sessions`, `activity`, `insights` (including `/analytics/map`), `places` (including the bulk `/places/unassigned` + `/places/assign`), `notifications`, `feedback` (user side and the `/admin/feedback` inbox), `health`
- `account_lifecycle.py` — account mail (verification, reset, notices) queued as `system` outbox rows, and the hourly `maintenance` the notification worker runs: purge accounts whose 30-day deletion grace has passed (complaints survive with `feedback.user_id` set NULL), trial reminders 7 and 1 days out (once each, keyed in `users.lifecycle_emails`), and pruning — security log after a year, rate-limit rows after a day. Bump `TERMS_VERSION` there whenever the terms text in `LegalPage.jsx` changes
- `auth_rate_limit.py` — attempt limits stored in `rate_limit_events`, not process memory, so a restart no longer resets them
- `config.py` — env-driven; refuses to start outside development without a non-default `JWT_SECRET_KEY`, and keeps the superseded GarageOS default on the rejection list
- `forecast.py` — year-end cost projection; de-seasonalises history before re-applying a seasonal curve, so the same curve must be used in both directions
- `climate.py` — monthly consumption multipliers derived from per-zone temperature normals and a heat-pump COP model. The curves are normalised to mean 1 and carry only the *shape* of the year; the level always comes from the account's own cost per km. `scripts/calibrate-climate.py` checks the temperate zone still reproduces the published fleet penalties and exits non-zero if it drifts
- `places.py` — matches a coordinate to a named place the account already uses. `places.visit_count` weights the stored position and counts only trusted fixes; the number shown to the user comes from `count_records_at`, not from that column. Geolocation needs a secure context, so the capture button is dead over plain HTTP
- `notifications.py` + `email_sender.py` — new-record emails. Saving a session only writes `notification_outbox` rows inside the request's transaction (under a savepoint, so a failure there never loses the record); a background thread started from `main.py`'s lifespan sends them with retries and builds the daily/weekly digests at `DIGEST_HOUR` in `APP_TIMEZONE`. The two notification tables accept `app.notifications = 'on'` in place of a tenant, for that worker and for the confirm/unsubscribe links opened without a session; the sessions behind a digest are still read with `app.user_id` set. Mail goes over SMTP (`SMTP_*`, `MAIL_FROM`, `APP_BASE_URL`); with no `SMTP_HOST`, development logs each message and any other environment leaves the queue pending
- `vehicle_rules.py` — fuel-type rules (electric ⇒ charging, petrol/diesel ⇒ fueling, hybrid ⇒ both) plus payload normalization and ownership checks

Every module uses a `try: from backend.X ... except ModuleNotFoundError: from X` shim, because the container runs from `/app` while local dev runs from the repo root. Match it in new modules.

If a `try` block can raise `HTTPException` — usually by calling a validator inside it — it needs `except HTTPException: raise` before the generic `except`. Without that, a 400 or 404 surfaces as a 500, because `HTTPException` subclasses `Exception`. Handlers that validate before opening the `try` do not need the clause, which is why the codebase has both shapes.

### Runtime schema introspection

`db.py` exposes `column_exists`, `table_exists` and `get_vehicle_column`, called per request to tolerate databases at different migration states. `get_vehicle_column` returns `vehicle_id_ref` or `vehicle_id` and is interpolated into f-string SQL — that column name is the only interpolated value, and all user data goes through psycopg2 parameters.

There is no runtime DDL left. The schema comes from migrations, and the app role has no `CREATE` privilege, so a new `ensure_*` table helper would fail.

## Frontend

- **`utils/api.js` is the only way to call the API.** `apiFetch` attaches the in-memory access token and retries once through a refresh on 401. The refresh is single-flighted because the endpoint *rotates* the refresh token — two concurrent refreshes log the user out. Never read `localStorage` directly in a component.
- `context/AuthContext.jsx` holds user and subscription state and consumes the same refresh implementation.
- Routes are imported directly, not lazily. Page chunks were a few kB against 220 kB of MUI and Recharts, and each navigation paid for them with a Suspense fallback that flickered.
- `components/RecordDialog.jsx` is the single entry point for creating and editing both sessions and costs. Records lives at `/activity`, with the tab in the URL (`?tab=recurring`).
- The MUI theme is inline in `App.jsx`, but **every colour it uses comes from `utils/palette.js`** — `HUES` is the measured set, `PALETTES` names five looks over it, and the account picks one (`users.theme_palette`, settings card in `AppearanceSettings.jsx`). App.jsx stamps the resolved hues onto `theme.palette.brand`/`.series` and onto `--mileage-primary`/`--mileage-secondary` for the CSS-side washes; `getBrand`/`getSeries` are the readers. **Light mode was added late and every value in `HUES` was measured both ways** — 4.5:1 on its own surface and under the `ON_BRAND` label ink as a button fill. Measure both before adding a hue.
- Only `primary`, `secondary` and the chart series vary by palette. `success`/`warning`/`error`, the fuel accents and the expense-category hues are fixed on purpose: those carry meaning, and recolouring them per look would make the user relearn the interface.
- Loading placeholders go through `utils/useDelayedLoading.js`: nothing shows for 220 ms, and once shown it stays 320 ms. Skeletons in `SectionSkeletons.jsx` mirror their pages card for card — if a page layout changes, change the skeleton with it or the swap will reflow.
- **Analytics generates its PDF itself** (jsPDF + html2canvas-pro), rather than going through the browser's print dialog as it used to. `components/AnalyticsReport.jsx` is a second rendering of the page: it mounts into a portal on `document.body` only while exporting, parked off-screen at `left: -10000px` — **not `display: none`, which measures zero and rasterises empty** — and the charts carry fixed pixel sizes for the same reason. Everything the screen hides in a tooltip is written out: values on the bars, a table under every chart. The figures both views share live in `utils/analyticsFormat.js`; put new ones there rather than in either renderer.
- The export follows the account's theme. `utils/reportTheme.js` resolves the palette and light/dark mode into the `--pr-*` properties the report block in `App.css` reads, and `utils/pdfExport.js` paints the same washed background the page carries onto every page. **Pagination is by block, and it packs**: `paginate` in `pdfExport.js` lays down the `data-pdf-block="fixed"` blocks in order (header, summary, the cost-over-time pair), then fits every remaining section — tallest first — into the earliest page with room for it, so a section can appear well away from where it sits in the JSX. A block is never split; only one taller than a whole page is sliced. **A section is therefore also the size of hole the packer can fill**, which is why a chart and its table, and each provider ring, are separate sections rather than one — merging them back would leave the same half-empty pages this replaced. Within a page the blocks are restored to document order.
- **The export button opens `ExportOptionsDialog.jsx` first**, which decides what the file covers. The two choices act at different depths: sections (`utils/exportSections.js`, the ids `AnalyticsReport` gates on) only decide which blocks render, while the vehicle picker is sent to `GET /analytics/summary?vehicles=…` and the report renders *that* response — every total, the trend, the categories and the provider rings are fleet-wide aggregates with no client-side way to re-cut them. The page's own state is left alone; exporting is not a change of view. The year-end projection is fleet-wide and cannot be re-cut per vehicle, so it is dropped from a subset export rather than printed beside one car's recorded spend.
- `prefers-reduced-motion` is handled in three places: a CSS rule, MUI transition durations, and `isAnimationActive` on every Recharts series. Recharts animates in JS and ignores CSS.

## Conventions

- Backend uses single quotes and raw SQL via `cur.execute` with `%s` parameters. No ORM — SQLAlchemy is present only for Alembic.
- `BOOTSTRAP_ADMIN_EMAIL` is the only way an account becomes admin automatically, and it is empty by default.
- Money, distance and volume are formatted through `createFormatters(user)`, never inline.
