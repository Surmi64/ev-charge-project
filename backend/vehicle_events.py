try:
    from backend.db import get_vehicle_column, table_exists
except ModuleNotFoundError:
    from db import get_vehicle_column, table_exists


EXPENSE_EVENT_TYPES = {'maintenance', 'insurance', 'parking', 'toll', 'tax', 'inspection', 'cleaning'}


def ensure_vehicle_events_table(db):
    if table_exists(db, 'vehicle_events'):
        return

    cur = db.cursor()
    cur.execute(
        """
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
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT vehicle_events_unique_legacy_uidx UNIQUE (legacy_source, legacy_id)
        );
        """
    )
    cur.execute('CREATE INDEX IF NOT EXISTS vehicle_events_user_id_idx ON vehicle_events (user_id, occurred_at DESC);')
    cur.execute('CREATE INDEX IF NOT EXISTS vehicle_events_vehicle_id_idx ON vehicle_events (vehicle_id, occurred_at DESC);')


def normalize_expense_event_type(category: str | None) -> str:
    if category in EXPENSE_EVENT_TYPES:
        return category
    return 'other_expense'


def normalize_expense_category(category: str | None) -> str | None:
    if not category:
        return None
    if category in EXPENSE_EVENT_TYPES:
        return category
    return 'other'


def backfill_vehicle_events(db):
    ensure_vehicle_events_table(db)
    cur = db.cursor()
    vehicle_column = get_vehicle_column(db)

    cur.execute(
        f"""
        INSERT INTO vehicle_events (
            user_id, vehicle_id, legacy_source, legacy_id, event_type, expense_category, title,
            occurred_at, ended_at, total_cost, currency, odometer_km, source, notes,
            energy_kwh, battery_level_start, battery_level_end, fuel_liters, created_at, updated_at
        )
        SELECT
            cs.user_id,
            cs.{vehicle_column},
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
        ON CONFLICT (legacy_source, legacy_id) DO NOTHING;
        """
    )

    cur.execute(
        """
        INSERT INTO vehicle_events (
            user_id, vehicle_id, legacy_source, legacy_id, event_type, expense_category, title,
            occurred_at, total_cost, currency, source, notes, created_at, updated_at
        )
        SELECT
            e.user_id,
            e.vehicle_id,
            'expense',
            e.id,
            CASE
                WHEN e.category IN ('maintenance', 'insurance', 'parking', 'toll', 'tax', 'inspection', 'cleaning') THEN e.category
                ELSE 'other_expense'
            END,
            CASE
                WHEN e.category IN ('maintenance', 'insurance', 'parking', 'toll', 'tax', 'inspection', 'cleaning') THEN e.category
                ELSE 'other'
            END,
            INITCAP(REPLACE(e.category, '_', ' ')),
            e.date::timestamp,
            e.amount,
            e.currency,
            'expense',
            e.description,
            e.created_at,
            NOW()
        FROM expenses e
        ON CONFLICT (legacy_source, legacy_id) DO NOTHING;
        """
    )


def sync_session_to_vehicle_event(db, session_id: int):
    ensure_vehicle_events_table(db)
    cur = db.cursor()
    vehicle_column = get_vehicle_column(db)
    cur.execute(
        f"""
        SELECT
            id,
            user_id,
            {vehicle_column} AS vehicle_id,
            session_type,
            start_time,
            end_time,
            cost_huf,
            odometer,
            source,
            notes,
            kwh,
            battery_level_start,
            battery_level_end,
            fuel_liters,
            created_at
        FROM charging_sessions
        WHERE id = %s
        LIMIT 1;
        """,
        (session_id,),
    )
    session = cur.fetchone()
    if not session:
        return

    cur.execute(
        """
        INSERT INTO vehicle_events (
            user_id, vehicle_id, legacy_source, legacy_id, event_type, title,
            occurred_at, ended_at, total_cost, currency, odometer_km, source, notes,
            energy_kwh, battery_level_start, battery_level_end, fuel_liters, created_at, updated_at
        )
        VALUES (%s, %s, 'charging_session', %s, %s, %s, %s, %s, %s, 'HUF', %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (legacy_source, legacy_id)
        DO UPDATE SET
            vehicle_id = EXCLUDED.vehicle_id,
            event_type = EXCLUDED.event_type,
            title = EXCLUDED.title,
            occurred_at = EXCLUDED.occurred_at,
            ended_at = EXCLUDED.ended_at,
            total_cost = EXCLUDED.total_cost,
            odometer_km = EXCLUDED.odometer_km,
            source = EXCLUDED.source,
            notes = EXCLUDED.notes,
            energy_kwh = EXCLUDED.energy_kwh,
            battery_level_start = EXCLUDED.battery_level_start,
            battery_level_end = EXCLUDED.battery_level_end,
            fuel_liters = EXCLUDED.fuel_liters,
            updated_at = NOW();
        """,
        (
            session['user_id'],
            session['vehicle_id'],
            session['id'],
            session['session_type'],
            'Fueling' if session['session_type'] == 'fueling' else 'Charging',
            session['start_time'],
            session['end_time'],
            session['cost_huf'],
            session['odometer'],
            session['source'],
            session['notes'],
            session['kwh'],
            session['battery_level_start'],
            session['battery_level_end'],
            session['fuel_liters'],
            session['created_at'],
        ),
    )


def sync_expense_to_vehicle_event(db, expense_id: int):
    ensure_vehicle_events_table(db)
    cur = db.cursor()
    cur.execute(
        """
        SELECT id, user_id, vehicle_id, category, amount, currency, date, description, created_at
        FROM expenses
        WHERE id = %s
        LIMIT 1;
        """,
        (expense_id,),
    )
    expense = cur.fetchone()
    if not expense:
        return

    cur.execute(
        """
        INSERT INTO vehicle_events (
            user_id, vehicle_id, legacy_source, legacy_id, event_type, expense_category, title,
            occurred_at, total_cost, currency, source, notes, created_at, updated_at
        )
        VALUES (%s, %s, 'expense', %s, %s, %s, %s, %s, %s, %s, 'expense', %s, %s, NOW())
        ON CONFLICT (legacy_source, legacy_id)
        DO UPDATE SET
            vehicle_id = EXCLUDED.vehicle_id,
            event_type = EXCLUDED.event_type,
            expense_category = EXCLUDED.expense_category,
            title = EXCLUDED.title,
            occurred_at = EXCLUDED.occurred_at,
            total_cost = EXCLUDED.total_cost,
            currency = EXCLUDED.currency,
            notes = EXCLUDED.notes,
            updated_at = NOW();
        """,
        (
            expense['user_id'],
            expense['vehicle_id'],
            expense['id'],
            normalize_expense_event_type(expense['category']),
            normalize_expense_category(expense['category']),
            (expense['category'] or 'Other').replace('_', ' ').title(),
            expense['date'],
            expense['amount'],
            expense['currency'],
            expense['description'],
            expense['created_at'],
        ),
    )


def delete_vehicle_event_by_legacy(db, legacy_source: str, legacy_id: int):
    if not table_exists(db, 'vehicle_events'):
        return
    cur = db.cursor()
    cur.execute('DELETE FROM vehicle_events WHERE legacy_source = %s AND legacy_id = %s;', (legacy_source, legacy_id))