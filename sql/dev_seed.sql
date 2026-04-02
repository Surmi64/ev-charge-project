BEGIN;

WITH admin_user AS (
    SELECT id
    FROM users
    WHERE LOWER(email) = LOWER('surmi64@gmail.com')
    LIMIT 1
)
INSERT INTO vehicles (
    user_id, name, make, model, fuel_type, year, license_plate, battery_capacity_kwh,
    tank_capacity_liters, starting_odometer_km, color_hex, notes, is_default
)
SELECT admin_user.id, 'GarageOS Demo EV', 'Tesla', 'Model 3', 'electric', 2023, 'GO-EV-001', 62.0,
       NULL, 18000.0, '#C2185B', 'Demo seed vehicle for EV charging scenarios', FALSE
FROM admin_user
WHERE NOT EXISTS (
    SELECT 1 FROM vehicles WHERE user_id = admin_user.id AND name = 'GarageOS Demo EV'
);

WITH admin_user AS (
    SELECT id
    FROM users
    WHERE LOWER(email) = LOWER('surmi64@gmail.com')
    LIMIT 1
)
INSERT INTO vehicles (
    user_id, name, make, model, fuel_type, year, license_plate, battery_capacity_kwh,
    tank_capacity_liters, starting_odometer_km, color_hex, notes, is_default
)
SELECT admin_user.id, 'GarageOS Demo Hybrid', 'Toyota', 'Corolla Touring Sports', 'hybrid', 2022, 'GO-HY-001', 1.3,
       43.0, 48200.0, '#455A64', 'Demo seed vehicle for mixed charging and fueling scenarios', FALSE
FROM admin_user
WHERE NOT EXISTS (
    SELECT 1 FROM vehicles WHERE user_id = admin_user.id AND name = 'GarageOS Demo Hybrid'
);

UPDATE vehicles
SET
        battery_capacity_kwh = 62.0,
        tank_capacity_liters = NULL,
        starting_odometer_km = 18000.0,
        color_hex = '#C2185B',
        notes = 'Demo seed vehicle for EV charging scenarios'
WHERE user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER('surmi64@gmail.com') LIMIT 1)
    AND name = 'GarageOS Demo EV'
    AND (
        battery_capacity_kwh IS DISTINCT FROM 62.0
        OR starting_odometer_km IS DISTINCT FROM 18000.0
        OR color_hex IS DISTINCT FROM '#C2185B'
        OR notes IS DISTINCT FROM 'Demo seed vehicle for EV charging scenarios'
    );

UPDATE vehicles
SET
        battery_capacity_kwh = 1.3,
        tank_capacity_liters = 43.0,
        starting_odometer_km = 48200.0,
        color_hex = '#455A64',
        notes = 'Demo seed vehicle for mixed charging and fueling scenarios'
WHERE user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER('surmi64@gmail.com') LIMIT 1)
    AND name = 'GarageOS Demo Hybrid'
    AND (
        battery_capacity_kwh IS DISTINCT FROM 1.3
        OR tank_capacity_liters IS DISTINCT FROM 43.0
        OR starting_odometer_km IS DISTINCT FROM 48200.0
        OR color_hex IS DISTINCT FROM '#455A64'
        OR notes IS DISTINCT FROM 'Demo seed vehicle for mixed charging and fueling scenarios'
    );

WITH admin_user AS (
    SELECT id
    FROM users
    WHERE LOWER(email) = LOWER('surmi64@gmail.com')
    LIMIT 1
),
demo_ev AS (
    SELECT id, user_id
    FROM vehicles
    WHERE name = 'GarageOS Demo EV' AND user_id = (SELECT id FROM admin_user)
    LIMIT 1
),
demo_hybrid AS (
    SELECT id, user_id
    FROM vehicles
    WHERE name = 'GarageOS Demo Hybrid' AND user_id = (SELECT id FROM admin_user)
    LIMIT 1
)
INSERT INTO charging_sessions (
    user_id, vehicle_id, session_type, start_time, end_time, kwh, fuel_liters,
    cost_huf, source, battery_level_start, battery_level_end, odometer, notes
)
SELECT demo_ev.user_id, demo_ev.id, 'charging', TIMESTAMPTZ '2026-03-28T18:15:00+00:00', TIMESTAMPTZ '2026-03-28T19:05:00+00:00', 24.80, NULL,
       4680, 'dev_seed', 22, 79, 18240.4, 'Demo seed: evening home charging'
FROM demo_ev
WHERE NOT EXISTS (
    SELECT 1
    FROM charging_sessions
    WHERE user_id = demo_ev.user_id AND vehicle_id = demo_ev.id AND source = 'dev_seed' AND start_time = TIMESTAMPTZ '2026-03-28T18:15:00+00:00'
)
UNION ALL
SELECT demo_hybrid.user_id, demo_hybrid.id, 'fueling', TIMESTAMPTZ '2026-03-29T09:30:00+00:00', TIMESTAMPTZ '2026-03-29T09:42:00+00:00', NULL, 34.20,
       22140, 'dev_seed', NULL, NULL, 48755.1, 'Demo seed: hybrid motorway refuel'
FROM demo_hybrid
WHERE NOT EXISTS (
    SELECT 1
    FROM charging_sessions
    WHERE user_id = demo_hybrid.user_id AND vehicle_id = demo_hybrid.id AND source = 'dev_seed' AND start_time = TIMESTAMPTZ '2026-03-29T09:30:00+00:00'
);

WITH admin_user AS (
    SELECT id
    FROM users
    WHERE LOWER(email) = LOWER('surmi64@gmail.com')
    LIMIT 1
),
demo_ev AS (
    SELECT id, user_id
    FROM vehicles
    WHERE name = 'GarageOS Demo EV' AND user_id = (SELECT id FROM admin_user)
    LIMIT 1
),
demo_hybrid AS (
    SELECT id, user_id
    FROM vehicles
    WHERE name = 'GarageOS Demo Hybrid' AND user_id = (SELECT id FROM admin_user)
    LIMIT 1
)
INSERT INTO expenses (user_id, vehicle_id, category, amount, currency, date, description)
SELECT demo_ev.user_id, demo_ev.id, 'insurance', 18200, 'HUF', DATE '2026-03-01', 'Demo seed: quarterly EV insurance'
FROM demo_ev
WHERE NOT EXISTS (
    SELECT 1
    FROM expenses
    WHERE user_id = demo_ev.user_id AND vehicle_id = demo_ev.id AND category = 'insurance' AND description = 'Demo seed: quarterly EV insurance'
)
UNION ALL
SELECT demo_hybrid.user_id, demo_hybrid.id, 'maintenance', 38750, 'HUF', DATE '2026-03-15', 'Demo seed: annual service and filters'
FROM demo_hybrid
WHERE NOT EXISTS (
    SELECT 1
    FROM expenses
    WHERE user_id = demo_hybrid.user_id AND vehicle_id = demo_hybrid.id AND category = 'maintenance' AND description = 'Demo seed: annual service and filters'
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'recurring_expense_reminders'
    ) THEN
        INSERT INTO recurring_expense_reminders (
            user_id, vehicle_id, category, amount, currency, frequency,
            next_due_date, description, is_active
        )
        SELECT demo_ev.user_id, demo_ev.id, 'insurance', 18200, 'HUF', 'quarterly',
               DATE '2026-06-01', 'Demo seed: EV insurance renewal reminder', TRUE
        FROM (
            SELECT id, user_id
            FROM vehicles
            WHERE name = 'GarageOS Demo EV'
              AND user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER('surmi64@gmail.com') LIMIT 1)
            LIMIT 1
        ) demo_ev
        WHERE NOT EXISTS (
            SELECT 1
            FROM recurring_expense_reminders
            WHERE user_id = demo_ev.user_id AND vehicle_id = demo_ev.id AND category = 'insurance' AND description = 'Demo seed: EV insurance renewal reminder'
        );

        INSERT INTO recurring_expense_reminders (
            user_id, vehicle_id, category, amount, currency, frequency,
            next_due_date, description, is_active
        )
        SELECT demo_hybrid.user_id, demo_hybrid.id, 'tax', 14500, 'HUF', 'yearly',
               DATE '2026-09-15', 'Demo seed: hybrid vehicle tax reminder', TRUE
        FROM (
            SELECT id, user_id
            FROM vehicles
            WHERE name = 'GarageOS Demo Hybrid'
              AND user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER('surmi64@gmail.com') LIMIT 1)
            LIMIT 1
        ) demo_hybrid
        WHERE NOT EXISTS (
            SELECT 1
            FROM recurring_expense_reminders
            WHERE user_id = demo_hybrid.user_id AND vehicle_id = demo_hybrid.id AND category = 'tax' AND description = 'Demo seed: hybrid vehicle tax reminder'
        );
    END IF;
END $$;

INSERT INTO vehicle_events (
    user_id, vehicle_id, legacy_source, legacy_id, event_type, expense_category, title,
    occurred_at, ended_at, total_cost, currency, odometer_km, source, notes,
    energy_kwh, battery_level_start, battery_level_end, fuel_liters, created_at, updated_at
)
SELECT
    cs.user_id,
    cs.vehicle_id,
    'charging_session',
    cs.id,
    cs.session_type,
    NULL,
    CASE WHEN cs.session_type = 'fueling' THEN 'Fueling' ELSE 'Charging' END,
    cs.start_time,
    cs.end_time,
    cs.cost_huf,
    'HUF',
    cs.odometer,
    cs.source,
    cs.notes,
    cs.kwh,
    cs.battery_level_start,
    cs.battery_level_end,
    cs.fuel_liters,
    cs.created_at,
    NOW()
FROM charging_sessions cs
WHERE cs.source = 'dev_seed'
ON CONFLICT (legacy_source, legacy_id) DO NOTHING;

INSERT INTO vehicle_events (
    user_id, vehicle_id, legacy_source, legacy_id, event_type, expense_category, title,
    occurred_at, total_cost, currency, source, notes, created_at, updated_at
)
SELECT
    e.user_id,
    e.vehicle_id,
    'expense',
    e.id,
    CASE WHEN e.category IN ('maintenance', 'insurance', 'parking', 'toll', 'tax', 'inspection', 'cleaning') THEN e.category ELSE 'other_expense' END,
    CASE WHEN e.category IN ('maintenance', 'insurance', 'parking', 'toll', 'tax', 'inspection', 'cleaning') THEN e.category ELSE 'other' END,
    INITCAP(REPLACE(e.category, '_', ' ')),
    e.date::timestamp,
    e.amount,
    e.currency,
    'expense',
    e.description,
    e.created_at,
    NOW()
FROM expenses e
WHERE e.description LIKE 'Demo seed:%'
ON CONFLICT (legacy_source, legacy_id) DO NOTHING;

COMMIT;