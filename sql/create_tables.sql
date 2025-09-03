
\c ev_charger;

CREATE TABLE IF NOT EXISTS charging_sessions (
    id TEXT PRIMARY KEY,
    vehicle_id INT NOT NULL,
    license_plate TEXT,
    start_time_posix BIGINT NOT NULL,
    end_time_posix BIGINT,
    kwh NUMERIC(10,2),
    duration_seconds NUMERIC(10,2),
    cost_huf NUMERIC(10,2),
    price_per_kwh NUMERIC(10,2),
    source TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'HUF',
    invoice_id TEXT,
    notes TEXT,
    raw_payload JSONB,
    odometer NUMERIC(10,2),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
