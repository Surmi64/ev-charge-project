# Implementation Backlog

## Purpose

This document turns the product plan into an execution backlog for the current repository. It is ordered by dependency, not by visual impact. The first goal is to stabilize the existing app, then complete the product flows.

## Priority Legend

- P0: blocks a usable product
- P1: required for a solid MVP
- P2: valuable improvement after MVP stability

## Estimation Legend

- S: small
- M: medium
- L: large

## Epic 0: Stabilize The Current Application

Goal:

- Make the existing frontend and backend consistent enough to support further development without schema drift.

Stories:

1. As a user, I can log in and stay authenticated across page refreshes.
2. As a user, I can view, create, edit, and delete vehicles reliably.
3. As a user, I can manage charging and fueling records without frontend/backend field mismatches.
4. As a developer, I have one canonical event model and one canonical SQL direction.

Tasks:

| ID | Priority | Estimate | Task |
| --- | --- | --- | --- |
| E0-01 | P0 | S | Wrap the app with AuthProvider and stop mixing direct localStorage auth checks with context-based auth. |
| E0-02 | P0 | M | Define a single canonical event payload shared by backend and frontend. |
| E0-03 | P0 | M | Add missing backend endpoints used by the frontend: dashboard stats, analytics summary, charging session delete. |
| E0-04 | P0 | M | Align vehicle and event field names across React components and FastAPI models. |
| E0-05 | P0 | M | Remove hardcoded API host usage and enforce a single API base strategy. |
| E0-06 | P0 | M | Consolidate SQL direction and switch development to the canonical target schema immediately. |
| E0-07 | P0 | S | Reconnect the profile/settings screen into navigation and routing. |
| E0-08 | P0 | S | Replace leftover Hungarian UI copy with English strings. |

## Epic 1: Authentication And Account

Goal:

- Deliver a secure, English-only single-user account system with profile management.

Stories:

1. As a user, I can register with email and password.
2. As a user, I can sign in with email and password.
3. As a user, I can update my profile, password, and theme preference.
4. As a user, I can recover access if I forget my password.
5. As a user, I can persist my dashboard and analytics widget visibility preferences at account level.

Tasks:

| ID | Priority | Estimate | Task |
| --- | --- | --- | --- |
| E1-01 | P1 | M | Change login UX and backend contract to email-first authentication. |
| E1-02 | P1 | M | Add password policy and better validation messages. |
| E1-03 | P1 | M | Add forgot-password request and reset flows. |
| E1-04 | P1 | M | Add session/refresh token storage model for safer auth lifecycle. |
| E1-05 | P1 | S | Add last_login_at and email_verified_at support to users. |
| E1-06 | P1 | S | Add profile settings screen to main navigation. |
| E1-07 | P1 | M | Add account-level security logs or at least auth event audit entries. |
| E1-08 | P1 | S | Restrict CORS and remove insecure fallback secret behavior. |
| E1-09 | P2 | M | Add backend-persisted user layout preferences for dashboard and analytics widget visibility, managed from Profile settings. |

Status update:

- Completed: E1-01, E1-02, E1-04, E1-05, E1-06, E1-07, E1-08.
- Completed with current environment constraint: E1-03 is implemented as a dev-safe token-based forgot/reset flow because outbound email is not configured yet.
- Extra admin/security additions completed beyond the original Epic 1 list: RBAC (`admin` / `user`), admin-only user management, admin-created reset tokens, forced logout, and user-visible security activity.

## Epic 2: Vehicle Management

Goal:

- Make vehicle management complete, clean, and usable on both mobile and desktop.

Stories:

1. As a user, I can add multiple vehicles.
2. As a user, I can set one default vehicle.
3. As a user, I can store electric and fuel vehicle metadata in one system.

Tasks:

| ID | Priority | Estimate | Task |
| --- | --- | --- | --- |
| E2-01 | P1 | S | Finalize canonical vehicle fields across API, SQL, and UI. |
| E2-02 | P1 | S | Enforce one default vehicle per user at DB or service level. |
| E2-03 | P1 | M | Add optional vehicle metadata: color, tank capacity, starting odometer, notes. |
| E2-04 | P1 | S | Improve empty states and validation in Vehicles UI. |
| E2-05 | P2 | S | Add archived vehicle support without data loss. |

Status update:

- Completed: E2-03 with optional vehicle metadata added across schema, API, and UI (`tank_capacity_liters`, `starting_odometer_km`, `color_hex`, `notes`).
- Completed: E2-04 with stronger empty states and inline client-side validation in the Vehicles UI.
- Completed: E2-05 with soft-archive vehicle support across schema, API, and UI so historical sessions and expenses stay linked while only active vehicles remain selectable for new records.

## Epic 3: Event And Expense Management

Goal:

- Replace fragmented charging-only logic with one unified event system.

Stories:

1. As a user, I can record a charging event.
2. As a user, I can record a fueling event.
3. As a user, I can record service, insurance, parking, toll, and other expenses.
4. As a user, I can filter all costs by vehicle, type, and time period.

Tasks:

| ID | Priority | Estimate | Task |
| --- | --- | --- | --- |
| E3-01 | P1 | L | Introduce unified vehicle_events model in backend and SQL. |
| E3-02 | P1 | M | Build create/edit/delete flows for charging and fueling records. |
| E3-03 | P1 | M | Add generic expense record support for maintenance, insurance, parking, toll, tax, and other costs. |
| E3-04 | P1 | M | Add filters for event type, vehicle, date range, and text search. |
| E3-05 | P1 | M | Design mobile-friendly event creation UX. |
| E3-06 | P2 | M | Add recurring expense support for insurance or tax reminders. |

Status update:

- Started: E3-01 now has a compatibility-phase implementation with a `vehicle_events` shadow table, backfill, and dual-write from charging sessions and expenses.
- Completed in compatibility phase: dashboard/activity/analytics reads now use `vehicle_events`, so the core product surfaces already run against the unified event layer without cutting over the legacy write paths yet.
- Completed: E3-06 with recurring expense reminders for insurance and tax-style costs, including due-date tracking and one-click logging into real expense records.
- Completed: E3-07 with CSV export of filtered activity data plus CSV import back into sessions and expenses from the Activity screen.
| E3-07 | P2 | M | Add CSV import/export. |

## Epic 4: Dashboard And Analytics

Goal:

- Provide decision-supporting insights instead of only list views.

Stories:

1. As a user, I can see my total monthly vehicle cost.
2. As a user, I can compare cost and usage per vehicle.
3. As a user, I can understand charging versus fueling trends over time.
4. As a user, I can hide analytics and dashboard widgets I do not need without breaking the layout.

Tasks:

| ID | Priority | Estimate | Task |
| --- | --- | --- | --- |
| E4-01 | P1 | M | Implement /dashboard/stats backend aggregation. |
| E4-02 | P1 | M | Implement /analytics/summary backend aggregation. |
| E4-03 | P1 | M | Align chart data contracts with real query output. |
| E4-04 | P1 | S | Add recent activity card to dashboard. |
| E4-05 | P1 | M | Add total cost by vehicle and cost trend charts. |
| E4-06 | P2 | M | Add cost per 100 km metrics when odometer data is available. |
| E4-07 | P2 | S | Add category breakdown chart for maintenance and other expenses. |
| E4-08 | P2 | M | Assign stable widget IDs to dashboard and analytics cards and render sections from filtered widget lists instead of fixed slots. |

Status update:

- Completed: E4-06 with distance-aware dashboard and analytics metrics driven by vehicle starting odometer plus event odometer readings, including per-vehicle and overall cost-per-100-km output when data is available.

## Epic 5: UI System, Themes, And Responsiveness

Goal:

- Turn the current interface into a consistent and polished product UI.

Stories:

1. As a user, I get a coherent dark and light theme.
2. As a user, I can use the app comfortably on mobile.
3. As a user, I see English-only labels and polished states.

Tasks:

| ID | Priority | Estimate | Task |
| --- | --- | --- | --- |
| E5-01 | P1 | M | Create shared theme tokens for surfaces, borders, accents, and charts. |
| E5-02 | P1 | M | Redesign auth page into a stronger split-layout experience. |
| E5-03 | P1 | M | Standardize cards, tables, filters, dialogs, and empty states. |
| E5-04 | P1 | M | Review all screens for mobile spacing, bottom-nav overlap, and tap targets. |
| E5-05 | P1 | S | Standardize English copy and status messages. |
| E5-06 | P2 | S | Add skeleton loading states to dashboard, vehicles, and events screens. |
| E5-07 | P2 | M | Add Profile controls for per-widget visibility toggles on Dashboard and Analytics, with a reset-to-default action. |

## Epic 6: Data Foundation And Schema Discipline

Goal:

- Move the project from ad hoc SQL evolution to one canonical clean-start schema.

Stories:

1. As a developer, I have one canonical schema for all new backend work.
2. As a developer, local and deployed environments can be initialized consistently from scratch.

Tasks:

| ID | Priority | Estimate | Task |
| --- | --- | --- | --- |
| E6-01 | P1 | M | Adopt the canonical target schema as the immediate source of truth for new development. |
| E6-02 | P1 | M | Introduce Alembic or another schema-management tool for future controlled changes. |
| E6-03 | P1 | S | Add seed/dev data for local testing. |
| E6-04 | P1 | S | Add indexes for users, vehicles, and events query patterns. |
| E6-05 | P2 | M | Add soft-archive or historical retention rules where useful. |

Status update:

- Completed: E6-02 with an Alembic baseline setup (`alembic.ini`, `backend/alembic/`, baseline revision `20260402_000001`) so future schema changes can be tracked outside the one-time bootstrap SQL path.
- Completed: E6-03 with optional idempotent development seed data in `sql/dev_seed.sql` plus `scripts/seed-dev.sh` for local demo setup without mixing seed state into migrations.
- Completed: E6-04 with additional query-pattern indexes tracked in Alembic revision `20260402_000002` and mirrored into the clean-start bootstrap SQL.

## Epic 7: Quality And Operations

Goal:

- Make the repo safer to evolve.

Stories:

1. As a developer, I can catch regressions before deployment.
2. As a user, I experience fewer silent failures.

Tasks:

| ID | Priority | Estimate | Task |
| --- | --- | --- | --- |
| E7-01 | P1 | M | Add backend API tests for auth, vehicles, and events. |
| E7-02 | P1 | M | Add frontend smoke tests for auth and core flows. |
| E7-03 | P1 | S | Add lint + test commands to CI. |
| E7-04 | P1 | S | Add structured logging for backend errors. |
| E7-05 | P2 | S | Add monitoring-ready health and readiness endpoints. |

Status update:

- Completed: E7-04 via structured JSON-style request and exception logging in the FastAPI app layer.
- Completed: E7-05 with separate `/health` and `/ready` endpoints; readiness now checks DB reachability and required schema presence, and the Docker Compose backend healthchecks use `/ready`.

## Suggested Execution Order

1. Epic 0
2. Epic 1
3. Epic 2 and Epic 3 in parallel where possible
4. Epic 4
5. Epic 5
6. Epic 6
7. Epic 7

## Definition Of Done For MVP

- Authentication is email-first and stable.
- The app uses one unified event model for charging, fueling, and extra costs.
- Vehicles, events, dashboard, analytics, and profile flows work end-to-end.
- All visible copy is English.
- Dark and light themes are both coherent.
- Mobile layout works without broken navigation or blocked actions.
- Backend and frontend data contracts are aligned.
- There is one canonical schema and a controlled way to evolve it in the future.