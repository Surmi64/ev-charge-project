# Phase 0 Refactor Plan

## Objective

Phase 0 is not a redesign phase. Its purpose is to remove the current inconsistencies that would make every later feature slower and riskier.

Primary outcome:

- one working auth flow,
- one working vehicle flow,
- one working event flow,
- real dashboard and analytics endpoints,
- one consistent schema direction.

## Current Repository Findings

### Frontend/Auth issues

- `frontend/src/main.jsx` does not wrap the app with `AuthProvider`.
- `frontend/src/App.jsx` reads auth state directly from `localStorage` instead of relying on context.
- `frontend/src/components/AuthPage.jsx` uses `useAuth()`, but the app root does not currently provide the context.
- Routes pass `mode` to `AuthPage`, but the component currently ignores that prop and uses tabs internally.

### Frontend/Feature issues

- `frontend/src/components/Profile.jsx` exists, but it is not integrated into the main route tree and navigation.
- `frontend/src/components/Dashboard.jsx` expects `/api/dashboard/stats`, but backend does not expose that route.
- `frontend/src/components/Analytics.jsx` expects `/api/analytics/summary`, but backend does not expose that route.
- `frontend/src/components/ListChargingSessions.jsx` edits sessions with `energy_kwh` and `duration_minutes`, while backend expects `kwh`, `end_time`, `fuel_liters`, and other fields.
- `frontend/src/components/ListChargingSessions.jsx` calls a delete endpoint for charging sessions, but backend does not define one.
- `frontend/src/components/UploadChargingForm.jsx` bypasses `/api`, bypasses auth headers, hardcodes a remote host, and hardcodes `vehicle_id = 1`.
- `frontend/src/components/UploadChargingForm.jsx` expects `/charging_sessions/locations`, but backend does not define that route.

### Backend issues

- `backend/main.py` keeps all auth, vehicle, expense, and session logic in one file.
- CORS currently allows all origins.
- JWT secret falls back to an insecure hardcoded default.
- Login currently accepts username or email, but the agreed target is email-first login.
- The backend currently lacks dashboard and analytics aggregation endpoints required by the frontend.
- Delete support is incomplete for charging sessions.

### Database issues

- The project currently mixes `vehicle_id` and `vehicle_id_ref`.
- Session columns differ between frontend expectations, backend models, and SQL files.
- There is no single canonical schema for future migration work.

Scope decision:

- The project will start with a clean database.
- Legacy data migration is not required.
- The legacy schema and migration files have been removed to avoid drift.

## Phase 0 Deliverables

1. AuthProvider-based frontend auth flow.
2. Email-first login and profile consistency.
3. Canonical event DTO shared between frontend and backend.
4. Charging session delete endpoint.
5. Working dashboard stats endpoint.
6. Working analytics summary endpoint.
7. Profile page available from navigation.
8. One documented target schema adopted as the immediate build target.

## Workstreams

### Workstream A: Canonical API Contract

Goal:

- Freeze the data contract before further UI or DB changes.

Tasks:

1. Define canonical `UserProfile` response shape.
2. Define canonical `Vehicle` payload shape.
3. Define canonical `VehicleEvent` payload shape for charging and fueling.
4. Decide whether extra costs remain in `expenses` temporarily or are immediately merged into `vehicle_events`.
5. Document field names to remove drift such as `kwh` vs `energy_kwh`.

Recommended output:

- a backend Pydantic schema layer,
- a frontend API contract note or typed client definitions.

### Workstream B: Frontend Auth Cleanup

Goal:

- Make auth state consistent and remove duplicate auth logic.

Tasks:

1. Wrap `App` with `AuthProvider` in `frontend/src/main.jsx`.
2. Refactor `App.jsx` to use auth context instead of direct token lookups.
3. Ensure logout clears context and redirects cleanly.
4. Make `AuthPage` email-first and align route behavior.
5. Add loading guard so private routes wait for auth restoration.

Done when:

- refresh keeps the user signed in,
- invalid token forces logout,
- auth components no longer depend on accidental localStorage state.

### Workstream C: Event Flow Cleanup

Goal:

- Get one reliable session flow working from UI to DB.

Tasks:

1. Update `ListChargingSessions.jsx` to use backend field names.
2. Remove unsupported update payload fields such as `duration_minutes` if backend does not own them.
3. Add missing delete endpoint in backend.
4. Remove hardcoded vehicle and host values from `UploadChargingForm.jsx`.
5. Pass bearer token for event creation.
6. Either implement `/charging_sessions/locations` or remove the dependency.

Done when:

- user can create, edit, list, and delete a charging session from the current UI.

### Workstream D: Dashboard And Analytics Alignment

Goal:

- Replace placeholder frontend assumptions with real backend data.

Tasks:

1. Implement `/dashboard/stats` in backend.
2. Implement `/analytics/summary` in backend.
3. Match response shape to current chart components or refactor the chart components to the new contract.
4. Ensure empty-state handling for users with no data.

Done when:

- dashboard and analytics screens render from real data without console errors.

### Workstream E: Routing And Navigation Cleanup

Goal:

- Make the actual screen structure match the available feature set.

Tasks:

1. Add profile/settings route to `App.jsx`.
2. Add profile/settings entry to sidebar and mobile navigation.
3. Review bottom navigation overlap with page actions on mobile.
4. Ensure English-only navigation labels.

Done when:

- all implemented major screens are reachable from navigation.

### Workstream F: Schema Direction

Goal:

- Stop editing against multiple incompatible schema snapshots.

Tasks:

1. Declare `sql/target_v3_schema.sql` as the target schema reference.
2. Update backend development against that schema instead of legacy table variants.
3. Simplify setup so local environments can be initialized directly from the target schema.
4. Keep schema evolution disciplined for future changes.

Done when:

- every backend model can be traced to one canonical schema target.

## Recommended Implementation Order

1. Workstream A
2. Workstream B
3. Workstream C
4. Workstream D
5. Workstream E
6. Workstream F

## Risks If Phase 0 Is Skipped

- Every new feature will reintroduce data mismatches.
- UI work will be blocked by missing backend routes.
- Schema sprawl will get worse after adding service and expense records.
- Authentication bugs will remain hard to reason about because state is duplicated.

## Exit Criteria

Phase 0 is complete when:

- auth is context-driven,
- session CRUD works end-to-end,
- dashboard and analytics routes exist,
- profile is reachable,
- frontend and backend use the same field names,
- one target schema is accepted as canonical.