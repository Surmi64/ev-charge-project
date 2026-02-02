-- 1. Create a backup table
CREATE TABLE IF NOT EXISTS charging_sessions_backup AS SELECT * FROM charging_sessions;

-- 2. Create the new modern table structure
CREATE TABLE charging_sessions_new (
    id SERIAL PRIMARY KEY,
    vehicle_id INT NOT NULL,
    license_plate TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    kwh NUMERIC(10,2),
    duration_seconds NUMERIC(10,2),
    cost_huf NUMERIC(10,2),
    price_per_kwh NUMERIC(10,2),
    source TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'HUF',
    notes TEXT,
    odometer NUMERIC(10,2),
    provider TEXT,
    city TEXT,
    location_detail TEXT,
    ac_or_dc TEXT,
    kw TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Migrate data from old to new
INSERT INTO charging_sessions_new (
    vehicle_id, license_plate, start_time, end_time, kwh, duration_seconds,
    cost_huf, price_per_kwh, source, currency, notes, odometer,
    provider, city, location_detail, ac_or_dc, kw, created_at
)
SELECT 
    vehicle_id,
    license_plate,
    to_timestamp(start_time_posix),
    CASE WHEN end_time_posix IS NOT NULL THEN to_timestamp(end_time_posix) ELSE NULL END,
    kwh,
    duration_seconds,
    cost_huf,
    price_per_kwh,
    source,
    currency,
    notes,
    odometer,
    provider,
    -- Simple split for legacy notes if they followed the Tesla Debrecen format
    split_part(notes, ' ', 2) as city,
    split_part(notes, ' ', 3) as location_detail,
    ac_or_dc,
    kw,
    created_at
FROM charging_sessions;

-- 4. Swap tables
-- Rename old table to stay safe, then move new one to its place
ALTER TABLE charging_sessions RENAME TO charging_sessions_old;
ALTER TABLE charging_sessions_new RENAME TO charging_sessions;

-- 5. Drop the old table only after verification (uncomment manually if needed)
-- DROP TABLE charging_sessions_old;
