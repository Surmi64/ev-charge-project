BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    theme_mode VARCHAR(10) NOT NULL DEFAULT 'dark' CHECK (theme_mode IN ('dark', 'light')),
    email_verified_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    dismissed_alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Display preferences. Distance and volume are converted from the canonical
    -- kilometres/litres; currency is a label only and is never converted.
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    distance_unit VARCHAR(4) NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km', 'mi')),
    volume_unit VARCHAR(8) NOT NULL DEFAULT 'l' CHECK (volume_unit IN ('l', 'gal_us', 'gal_uk')),
    -- NULL until the account has been through (or skipped) onboarding.
    onboarded_at TIMESTAMPTZ,
    -- Which climate the fleet is driven in. Feeds the seasonal curves the cost forecast
    -- is built from; NULL means unanswered, which resolves to a temperate default but
    -- lets the UI offer to correct it. No CHECK: the zone list lives in
    -- backend/climate.py and grows. (Alembic 20260731_000016)
    climate_zone VARCHAR(32),
    -- What a combustion car would have used over the same distance, and what that fuel
    -- costs per litre in this account's currency. Both NULL means "not answered": an
    -- invented fuel price would draw a comparison line that looks exactly as
    -- authoritative as a real one. (Alembic 20260731_000018)
    reference_consumption_l_100km NUMERIC(4,1),
    reference_fuel_price NUMERIC(10,2),
    -- The explicit on/off for that line. Without it the only way to remove the
    -- comparison was to have no price, which is a side effect rather than a setting.
    -- (Alembic 20260731_000019)
    fuel_comparison_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_reference_consumption_chk
        CHECK (reference_consumption_l_100km IS NULL OR reference_consumption_l_100km BETWEEN 1 AND 50),
    CONSTRAINT users_reference_fuel_price_chk
        CHECK (reference_fuel_price IS NULL OR reference_fuel_price > 0)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS climate_zone VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reference_consumption_l_100km NUMERIC(4,1);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reference_fuel_price NUMERIC(10,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS fuel_comparison_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_uidx ON users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_token_hash_uidx ON user_sessions (token_hash);
CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_user_revoked_expires_idx ON user_sessions (user_id, revoked_at, expires_at DESC);

CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    email VARCHAR(255),
    event_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    ip_address VARCHAR(64),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_audit_logs_user_id_idx ON auth_audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_logs_event_type_idx ON auth_audit_logs (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_logs_email_created_at_idx ON auth_audit_logs (LOWER(email), created_at DESC);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_token_hash_uidx ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_status_expires_idx ON password_reset_tokens (user_id, used_at, expires_at DESC);

INSERT INTO users (username, email, password_hash, role, theme_mode)
SELECT 'Admin', 'surmi64@gmail.com', '$2b$12$5WwnQf2wwMX.8.3fMDfrwO95UVYSrIOyVJYCPVkoz3nojQmMM8FhW', 'admin', 'dark'
WHERE NOT EXISTS (
    SELECT 1
    FROM users
    WHERE LOWER(email) = LOWER('surmi64@gmail.com')
);

UPDATE users SET role = 'admin' WHERE LOWER(email) = LOWER('surmi64@gmail.com');

CREATE TABLE IF NOT EXISTS vehicles (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120),
    make VARCHAR(80) NOT NULL,
    model VARCHAR(80) NOT NULL,
    fuel_type VARCHAR(20) NOT NULL DEFAULT 'electric' CHECK (fuel_type IN ('electric', 'hybrid', 'petrol', 'diesel', 'hydrogen')),
    year INTEGER,
    license_plate VARCHAR(20),
    battery_capacity_kwh NUMERIC(10,2),
    tank_capacity_liters NUMERIC(10,2),
    starting_odometer_km NUMERIC(10,1),
    color_hex VARCHAR(7),
    notes TEXT,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    -- Nullable so it can also mean "not answered": a heat pump roughly halves a
    -- battery car's cabin-heating penalty, and defaulting everyone to FALSE would
    -- skew their winter forecast. (Alembic 20260730_000015)
    has_heat_pump BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vehicles_year_chk CHECK (year IS NULL OR year BETWEEN 1950 AND 2100)
);

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tank_capacity_liters NUMERIC(10,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS starting_odometer_km NUMERIC(10,1);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color_hex VARCHAR(7);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS has_heat_pump BOOLEAN;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_color_hex_chk') THEN
        ALTER TABLE vehicles
            ADD CONSTRAINT vehicles_color_hex_chk
            CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_tank_capacity_chk') THEN
        ALTER TABLE vehicles
            ADD CONSTRAINT vehicles_tank_capacity_chk
            CHECK (tank_capacity_liters IS NULL OR tank_capacity_liters >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_starting_odometer_chk') THEN
        ALTER TABLE vehicles
            ADD CONSTRAINT vehicles_starting_odometer_chk
            CHECK (starting_odometer_km IS NULL OR starting_odometer_km >= 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS vehicles_user_id_idx ON vehicles (user_id);
CREATE INDEX IF NOT EXISTS vehicles_user_id_archived_idx ON vehicles (user_id, is_archived);
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_one_default_per_user_uidx ON vehicles (user_id) WHERE is_default = TRUE AND is_archived = FALSE;
CREATE INDEX IF NOT EXISTS vehicles_user_default_created_idx ON vehicles (user_id, is_default, created_at DESC);

CREATE TABLE IF NOT EXISTS expenses (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
    category VARCHAR(50) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'HUF',
    date DATE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT expenses_amount_chk CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS expenses_user_id_date_idx ON expenses (user_id, date DESC);
CREATE INDEX IF NOT EXISTS expenses_user_vehicle_date_idx ON expenses (user_id, vehicle_id, date DESC);

CREATE TABLE IF NOT EXISTS recurring_expense_reminders (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
    category VARCHAR(50) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'HUF',
    frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
    next_due_date DATE NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_logged_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT recurring_expense_amount_chk CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS recurring_expense_user_due_idx ON recurring_expense_reminders (user_id, is_active, next_due_date ASC);

CREATE TABLE IF NOT EXISTS charging_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    session_type VARCHAR(20) NOT NULL DEFAULT 'charging' CHECK (session_type IN ('charging', 'fueling')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    kwh NUMERIC(10,2),
    fuel_liters NUMERIC(10,2),
    cost_amount NUMERIC(12,2) NOT NULL,
    source VARCHAR(80) NOT NULL,
    battery_level_start SMALLINT,
    battery_level_end SMALLINT,
    odometer NUMERIC(10,1),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT charging_sessions_cost_chk CHECK (cost_amount >= 0),
    CONSTRAINT charging_sessions_kwh_chk CHECK (kwh IS NULL OR kwh >= 0),
    CONSTRAINT charging_sessions_fuel_liters_chk CHECK (fuel_liters IS NULL OR fuel_liters >= 0),
    CONSTRAINT charging_sessions_battery_start_chk CHECK (battery_level_start IS NULL OR battery_level_start BETWEEN 0 AND 100),
    CONSTRAINT charging_sessions_battery_end_chk CHECK (battery_level_end IS NULL OR battery_level_end BETWEEN 0 AND 100),
    CONSTRAINT charging_sessions_odometer_chk CHECK (odometer IS NULL OR odometer >= 0)
);

-- ---------------------------------------------------------------------------
-- Places (Alembic 20260731_000017)
--
-- A named spot the account keeps returning to. Separate from the coordinates on
-- charging_sessions, which record where the phone said it was on one particular
-- visit: naming a petrol station once has to be enough for every later visit.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS places (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    latitude NUMERIC(9,6) NOT NULL,
    longitude NUMERIC(9,6) NOT NULL,
    visit_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT places_latitude_chk CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT places_longitude_chk CHECK (longitude BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS places_user_coords_idx ON places (user_id, latitude, longitude);
CREATE UNIQUE INDEX IF NOT EXISTS places_user_name_uidx ON places (user_id, LOWER(name));

ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6);
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS location_accuracy_m NUMERIC(8,1);
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS place_id BIGINT REFERENCES places(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS charging_sessions_place_idx ON charging_sessions (place_id) WHERE place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS charging_sessions_user_id_start_time_idx ON charging_sessions (user_id, start_time DESC);
CREATE INDEX IF NOT EXISTS charging_sessions_vehicle_id_start_time_idx ON charging_sessions (vehicle_id, start_time DESC);
CREATE INDEX IF NOT EXISTS charging_sessions_user_vehicle_type_start_idx ON charging_sessions (user_id, vehicle_id, session_type, start_time DESC);

CREATE TABLE IF NOT EXISTS vehicle_events (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
    legacy_source VARCHAR(20) NOT NULL,
    legacy_id BIGINT NOT NULL,
    event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('charging', 'fueling', 'maintenance', 'insurance', 'parking', 'toll', 'tax', 'inspection', 'cleaning', 'other_expense')),
    expense_category VARCHAR(30) CHECK (expense_category IS NULL OR expense_category IN ('maintenance', 'insurance', 'parking', 'toll', 'tax', 'inspection', 'cleaning', 'other')),
    title VARCHAR(160),
    occurred_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    total_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'HUF',
    odometer_km NUMERIC(10,1),
    source VARCHAR(80),
    notes TEXT,
    energy_kwh NUMERIC(10,2),
    battery_level_start SMALLINT,
    battery_level_end SMALLINT,
    fuel_liters NUMERIC(10,2),
    -- Denormalised from places, so Records renders a row without a join.
    latitude NUMERIC(9,6),
    longitude NUMERIC(9,6),
    place_name VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vehicle_events_unique_legacy_uidx UNIQUE (legacy_source, legacy_id)
);

CREATE INDEX IF NOT EXISTS vehicle_events_user_id_idx ON vehicle_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_events_vehicle_id_idx ON vehicle_events (vehicle_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_events_user_event_type_date_idx ON vehicle_events (user_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_events_user_vehicle_date_idx ON vehicle_events (user_id, vehicle_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_events_expense_category_date_idx ON vehicle_events (expense_category, occurred_at DESC) WHERE expense_category IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Subscriptions (Alembic 20260721_000006)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    plan VARCHAR(20) NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'monthly', 'yearly')),
    status VARCHAR(20) NOT NULL DEFAULT 'trialing'
        CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
    trial_ends_at TIMESTAMPTZ,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    provider VARCHAR(30),
    provider_customer_id VARCHAR(120),
    provider_subscription_id VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions (status, current_period_end);

-- ---------------------------------------------------------------------------
-- Tenant isolation (Alembic 20260721_000007)
--
-- ---------------------------------------------------------------------------
-- Site settings (Alembic 20260730_000014)
--
-- Key/value so adding a setting does not need a migration. Deliberately outside row
-- level security: every other table here is tenant data keyed by user_id, this is one
-- global set that admins write and the app reads while serving anyone, including
-- during registration when no identity exists yet.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS site_settings (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

-- The API connects as mileage_app, which must not be a superuser and must not
-- have BYPASSRLS, otherwise these policies are silently skipped. get_tenant_db
-- sets app.user_id once per request; a query that forgets its WHERE clause then
-- returns no rows instead of every row.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mileage_app') THEN
        CREATE ROLE mileage_app LOGIN PASSWORD 'mileage_app_password'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO mileage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mileage_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mileage_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mileage_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mileage_app;

DO $$
DECLARE
    tenant_table TEXT;
    admin_table TEXT;
BEGIN
    -- User content: reachable only by its owner. No admin escape on purpose.
    FOREACH tenant_table IN ARRAY ARRAY['vehicles', 'charging_sessions', 'expenses',
                                        'vehicle_events', 'recurring_expense_reminders',
                                        'places']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tenant_table);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tenant_table);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', tenant_table || '_tenant_isolation', tenant_table);
        EXECUTE format(
            'CREATE POLICY %I ON %I USING (user_id = NULLIF(current_setting(''app.user_id'', true), '''')::bigint)'
            ' WITH CHECK (user_id = NULLIF(current_setting(''app.user_id'', true), '''')::bigint);',
            tenant_table || '_tenant_isolation', tenant_table);
    END LOOP;

    -- Billing metadata: the owner, plus admins doing user management.
    FOREACH admin_table IN ARRAY ARRAY['subscriptions']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', admin_table);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', admin_table);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', admin_table || '_tenant_isolation', admin_table);
        EXECUTE format(
            'CREATE POLICY %I ON %I USING (user_id = NULLIF(current_setting(''app.user_id'', true), '''')::bigint'
            ' OR current_setting(''app.admin'', true) = ''on'')'
            ' WITH CHECK (user_id = NULLIF(current_setting(''app.user_id'', true), '''')::bigint'
            ' OR current_setting(''app.admin'', true) = ''on'');',
            admin_table || '_tenant_isolation', admin_table);
    END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Migration bookkeeping
--
-- This file creates the schema Alembic would produce at head, so stamp it as
-- such. Without this a fresh database looks unmigrated and `alembic upgrade
-- head` would try to re-create everything.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alembic_version (
    version_num VARCHAR(32) NOT NULL CONSTRAINT alembic_version_pkc PRIMARY KEY
);

INSERT INTO alembic_version (version_num)
SELECT '20260731_000019'
WHERE NOT EXISTS (SELECT 1 FROM alembic_version);

COMMIT;
