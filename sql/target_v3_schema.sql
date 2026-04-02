-- Target schema for the single-user vehicle cost tracking platform.
-- This schema is intended as the canonical reference for the next migration phase.

BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(120),
    password_hash VARCHAR(255) NOT NULL,
    theme_mode VARCHAR(10) NOT NULL DEFAULT 'dark' CHECK (theme_mode IN ('dark', 'light')),
    locale VARCHAR(10) NOT NULL DEFAULT 'en',
    currency VARCHAR(3) NOT NULL DEFAULT 'HUF',
    timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Budapest',
    email_verified_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    user_agent TEXT,
    ip_address INET,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_token_hash_uidx ON user_sessions (token_hash);
CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_token_hash_uidx ON password_reset_tokens (token_hash);

CREATE TABLE IF NOT EXISTS vehicles (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120),
    make VARCHAR(80) NOT NULL,
    model VARCHAR(80) NOT NULL,
    fuel_type VARCHAR(20) NOT NULL CHECK (fuel_type IN ('electric', 'hybrid', 'petrol', 'diesel')),
    year SMALLINT,
    license_plate VARCHAR(20),
    battery_capacity_kwh NUMERIC(10,2),
    tank_capacity_liters NUMERIC(10,2),
    starting_odometer_km NUMERIC(10,1),
    color_hex VARCHAR(7),
    notes TEXT,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vehicles_year_chk CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
    CONSTRAINT vehicles_color_hex_chk CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE INDEX IF NOT EXISTS vehicles_user_id_idx ON vehicles (user_id);
CREATE INDEX IF NOT EXISTS vehicles_user_id_archived_idx ON vehicles (user_id, is_archived);
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_one_default_per_user_uidx ON vehicles (user_id) WHERE is_default = TRUE AND is_archived = FALSE;

CREATE TABLE IF NOT EXISTS vehicle_events (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('charging', 'fueling', 'maintenance', 'insurance', 'parking', 'toll', 'tax', 'inspection', 'cleaning', 'other_expense')),
    expense_category VARCHAR(30) CHECK (expense_category IS NULL OR expense_category IN ('maintenance', 'insurance', 'parking', 'toll', 'tax', 'inspection', 'cleaning', 'other')),
    title VARCHAR(160),
    occurred_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    total_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'HUF',
    odometer_km NUMERIC(10,1),
    source VARCHAR(50),
    notes TEXT,
    provider VARCHAR(120),
    station_brand VARCHAR(120),
    vendor VARCHAR(120),
    location_name VARCHAR(160),
    city VARCHAR(120),
    country_code VARCHAR(2),
    charger_type VARCHAR(10) CHECK (charger_type IS NULL OR charger_type IN ('AC', 'DC')),
    charger_power_kw NUMERIC(10,2),
    energy_kwh NUMERIC(10,2),
    price_per_kwh NUMERIC(10,4),
    battery_level_start SMALLINT,
    battery_level_end SMALLINT,
    fuel_liters NUMERIC(10,2),
    price_per_liter NUMERIC(10,4),
    fuel_grade VARCHAR(30),
    due_date DATE,
    recurrence_type VARCHAR(20) CHECK (recurrence_type IS NULL OR recurrence_type IN ('monthly', 'quarterly', 'yearly')),
    document_reference VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vehicle_events_battery_level_start_chk CHECK (battery_level_start IS NULL OR battery_level_start BETWEEN 0 AND 100),
    CONSTRAINT vehicle_events_battery_level_end_chk CHECK (battery_level_end IS NULL OR battery_level_end BETWEEN 0 AND 100),
    CONSTRAINT vehicle_events_cost_chk CHECK (total_cost >= 0),
    CONSTRAINT vehicle_events_energy_chk CHECK (energy_kwh IS NULL OR energy_kwh >= 0),
    CONSTRAINT vehicle_events_fuel_chk CHECK (fuel_liters IS NULL OR fuel_liters >= 0),
    CONSTRAINT vehicle_events_odometer_chk CHECK (odometer_km IS NULL OR odometer_km >= 0)
);

CREATE INDEX IF NOT EXISTS vehicle_events_user_id_idx ON vehicle_events (user_id);
CREATE INDEX IF NOT EXISTS vehicle_events_vehicle_id_idx ON vehicle_events (vehicle_id);
CREATE INDEX IF NOT EXISTS vehicle_events_occurred_at_idx ON vehicle_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_events_user_type_date_idx ON vehicle_events (user_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_events_user_vehicle_date_idx ON vehicle_events (user_id, vehicle_id, occurred_at DESC);

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

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    event_name VARCHAR(80) NOT NULL,
    entity_type VARCHAR(80),
    entity_id VARCHAR(80),
    ip_address INET,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS audit_logs_event_name_idx ON audit_logs (event_name);

COMMIT;