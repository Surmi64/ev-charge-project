from fastapi import APIRouter, Depends, HTTPException, Query

try:
    from backend.auth_utils import get_current_user_id
    from backend.billing import get_tenant_db, require_write_access
    from backend.db import column_exists, get_vehicle_column, table_exists
    from backend.schemas import VehicleCreate, VehicleUpdate
    from backend.vehicle_rules import normalize_vehicle_payload
except ModuleNotFoundError:
    from auth_utils import get_current_user_id
    from billing import get_tenant_db, require_write_access
    from db import column_exists, get_vehicle_column, table_exists
    from schemas import VehicleCreate, VehicleUpdate
    from vehicle_rules import normalize_vehicle_payload

router = APIRouter(tags=['vehicles'])


def has_archive_support(db) -> bool:
    return column_exists(db, 'vehicles', 'is_archived')


def has_heat_pump_support(db) -> bool:
    return column_exists(db, 'vehicles', 'has_heat_pump')


def get_active_vehicle_predicate(db, table_alias: str | None = None) -> str:
    if not has_archive_support(db):
        return 'TRUE'
    prefix = f'{table_alias}.' if table_alias else ''
    return f'{prefix}is_archived = FALSE'


def promote_fallback_default_vehicle(cur, db, user_id: str):
    cur.execute(
        f'''
        SELECT id
        FROM vehicles
        WHERE user_id = %s AND {get_active_vehicle_predicate(db)}
        ORDER BY created_at DESC
        LIMIT 1;
        ''',
        (user_id,),
    )
    fallback_vehicle = cur.fetchone()
    if fallback_vehicle:
        cur.execute('UPDATE vehicles SET is_default = TRUE WHERE id = %s;', (fallback_vehicle['id'],))


def ensure_active_default_vehicle(cur, db, user_id: str):
    cur.execute(
        f'''
        SELECT id
        FROM vehicles
        WHERE user_id = %s AND is_default = TRUE AND {get_active_vehicle_predicate(db)}
        LIMIT 1;
        ''',
        (user_id,),
    )
    if not cur.fetchone():
        promote_fallback_default_vehicle(cur, db, user_id)


@router.get('/vehicles', response_model=list[dict])
def get_vehicles(
    include_archived: bool = Query(False),
    user_id: str = Depends(get_current_user_id),
    db=Depends(get_tenant_db),
):
    cur = db.cursor()
    # The highest reading filed so far, which RecordDialog compares a freshly typed
    # odometer against. MAX rather than the most recent by date: a back-dated record
    # would otherwise lower the baseline and stop catching the next fat-fingered entry.
    # Falls back to the vehicle's starting reading so a car with no history still has one.
    last_odometer = (
        '''COALESCE(
               (SELECT MAX(e.odometer_km) FROM vehicle_events e
                 WHERE e.vehicle_id = v.id AND e.user_id = v.user_id),
               v.starting_odometer_km
           ) AS last_odometer_km'''
        if table_exists(db, 'vehicle_events')
        else 'v.starting_odometer_km AS last_odometer_km'
    )
    if has_archive_support(db):
        archived_filter = '' if include_archived else 'AND v.is_archived = FALSE'
        cur.execute(
            f'''
            SELECT v.*, {last_odometer}
            FROM vehicles v
            WHERE v.user_id = %s {archived_filter}
            ORDER BY v.is_archived ASC, v.is_default DESC, v.created_at DESC;
            ''',
            (user_id,),
        )
    else:
        cur.execute(
            f'''
            SELECT v.*, {last_odometer}
            FROM vehicles v
            WHERE v.user_id = %s
            ORDER BY v.is_default DESC, v.created_at DESC;
            ''',
            (user_id,),
        )
    return cur.fetchall()


@router.post('/vehicles', status_code=201)
def create_vehicle(vehicle: VehicleCreate, user_id: str = Depends(get_current_user_id), _subscription=Depends(require_write_access), db=Depends(get_tenant_db)):
    cur = db.cursor()
    heat_pump_supported = has_heat_pump_support(db)
    try:
        payload = normalize_vehicle_payload(vehicle)

        if vehicle.is_default:
            cur.execute(
                f'UPDATE vehicles SET is_default = FALSE WHERE user_id = %s AND {get_active_vehicle_predicate(db)};',
                (user_id,),
            )

        cur.execute(
            f"""INSERT INTO vehicles (
                   user_id, name, make, model, fuel_type, year, license_plate,
                   battery_capacity_kwh, tank_capacity_liters, starting_odometer_km,
                   color_hex, notes, is_default{', has_heat_pump' if heat_pump_supported else ''}
               )
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s{', %s' if heat_pump_supported else ''})
               RETURNING id;""",
            (
                user_id,
                payload.get('name'),
                payload.get('make'),
                payload.get('model'),
                payload.get('fuel_type'),
                payload.get('year'),
                payload.get('license_plate'),
                payload.get('battery_capacity_kwh'),
                payload.get('tank_capacity_liters'),
                payload.get('starting_odometer_km'),
                payload.get('color_hex'),
                payload.get('notes'),
                payload.get('is_default', False),
                *([payload.get('has_heat_pump')] if heat_pump_supported else []),
            ),
        )
        vehicle_id = cur.fetchone()['id']
        db.commit()
        return {'message': 'Vehicle created', 'vehicle_id': vehicle_id}
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch('/vehicles/{vehicle_id}')
def update_vehicle(vehicle_id: int, vehicle: VehicleUpdate, user_id: str = Depends(get_current_user_id), _subscription=Depends(require_write_access), db=Depends(get_tenant_db)):
    cur = db.cursor()
    select_fields = 'id, is_default, is_archived' if has_archive_support(db) else 'id, is_default'
    cur.execute(f'SELECT {select_fields} FROM vehicles WHERE id = %s AND user_id = %s;', (vehicle_id, user_id))
    existing_vehicle = cur.fetchone()
    if not existing_vehicle:
        raise HTTPException(status_code=404, detail='Vehicle not found or unauthorized')

    updates = []
    values = []
    normalized_payload = normalize_vehicle_payload(vehicle)

    # The SET clause is built from whatever keys survive normalisation, so a column
    # this database does not have yet must be dropped before it reaches the query.
    if not has_heat_pump_support(db):
        normalized_payload.pop('has_heat_pump', None)

    if has_archive_support(db) and normalized_payload.get('is_archived') is True:
        normalized_payload['is_default'] = False

    if normalized_payload.get('is_default'):
        cur.execute(
            f'UPDATE vehicles SET is_default = FALSE WHERE user_id = %s AND id <> %s AND {get_active_vehicle_predicate(db)};',
            (user_id, vehicle_id),
        )

    for field, value in normalized_payload.items():
        updates.append(f'{field} = %s')
        values.append(value)

    if not updates:
        return {'message': 'No changes requested'}

    values.append(vehicle_id)
    values.append(user_id)
    query = f"UPDATE vehicles SET {', '.join(updates)} WHERE id = %s AND user_id = %s"

    try:
        cur.execute(query, tuple(values))
        if has_archive_support(db) and (existing_vehicle.get('is_default') or normalized_payload.get('is_default') or 'is_archived' in normalized_payload):
            ensure_active_default_vehicle(cur, db, user_id)
        db.commit()
        return {'message': 'Vehicle updated successfully'}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


def count_vehicle_history(cur, db, vehicle_id: int, user_id: str) -> dict:
    """How many records would go with this vehicle, per table.

    Both a precondition for archiving and the figure the purge confirmation shows:
    a delete that cannot be undone should say what it is about to take.
    """
    vehicle_column = get_vehicle_column(db)
    cur.execute(
        f'SELECT COUNT(*) AS count FROM charging_sessions WHERE {vehicle_column} = %s AND user_id = %s;',
        (vehicle_id, user_id),
    )
    sessions = cur.fetchone()['count']
    cur.execute('SELECT COUNT(*) AS count FROM expenses WHERE vehicle_id = %s AND user_id = %s;', (vehicle_id, user_id))
    expenses = cur.fetchone()['count']

    reminders = 0
    if table_exists(db, 'recurring_expense_reminders'):
        cur.execute(
            'SELECT COUNT(*) AS count FROM recurring_expense_reminders WHERE vehicle_id = %s AND user_id = %s;',
            (vehicle_id, user_id),
        )
        reminders = cur.fetchone()['count']

    return {'sessions': sessions, 'expenses': expenses, 'reminders': reminders}


@router.get('/vehicles/{vehicle_id}/history-count')
def get_vehicle_history_count(vehicle_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_tenant_db)):
    """What a permanent delete of this vehicle would destroy.

    A read, so it is deliberately not gated on write access -- a lapsed account may
    still look at what it owns. The confirmation dialog calls this before offering the
    purge, because "delete 2 years of fuel-ups" and "delete an empty car" are the same
    button otherwise.
    """
    cur = db.cursor()
    cur.execute('SELECT id FROM vehicles WHERE id = %s AND user_id = %s;', (vehicle_id, user_id))
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail='Vehicle not found or unauthorized')
    try:
        return count_vehicle_history(cur, db, vehicle_id, user_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete('/vehicles/{vehicle_id}')
def delete_vehicle(
    vehicle_id: int,
    purge: bool = Query(False),
    user_id: str = Depends(get_current_user_id),
    _subscription=Depends(require_write_access),
    db=Depends(get_tenant_db),
):
    """Delete a vehicle, archiving it instead if it still carries history.

    `purge=true` is the second step: it deletes the history too, and is accepted only
    for a vehicle that is already archived. Archiving first is what makes this hard to
    do by accident -- there is no single click anywhere that destroys a car's records.
    """
    cur = db.cursor()
    select_fields = 'id, is_default, is_archived' if has_archive_support(db) else 'id, is_default'
    cur.execute(f'SELECT {select_fields} FROM vehicles WHERE id = %s AND user_id = %s;', (vehicle_id, user_id))
    existing_vehicle = cur.fetchone()
    if not existing_vehicle:
        raise HTTPException(status_code=404, detail='Vehicle not found or unauthorized')

    if purge and has_archive_support(db) and not existing_vehicle.get('is_archived'):
        raise HTTPException(status_code=409, detail='Archive the vehicle before deleting it permanently')

    try:
        vehicle_column = get_vehicle_column(db)
        counts = count_vehicle_history(cur, db, vehicle_id, user_id)
        session_count = counts['sessions']
        expense_count = counts['expenses']

        if purge:
            # Every dependent row is removed by hand rather than left to the foreign
            # keys. Only charging_sessions cascades; expenses, vehicle_events and the
            # reminders are ON DELETE SET NULL, so dropping the vehicle alone would
            # leave its spending in the account's totals with nothing to attribute it
            # to -- the opposite of what deleting a car is for.
            if table_exists(db, 'vehicle_events'):
                cur.execute('DELETE FROM vehicle_events WHERE vehicle_id = %s AND user_id = %s;', (vehicle_id, user_id))
            if table_exists(db, 'recurring_expense_reminders'):
                cur.execute(
                    'DELETE FROM recurring_expense_reminders WHERE vehicle_id = %s AND user_id = %s;',
                    (vehicle_id, user_id),
                )
            cur.execute(f'DELETE FROM charging_sessions WHERE {vehicle_column} = %s AND user_id = %s;', (vehicle_id, user_id))
            cur.execute('DELETE FROM expenses WHERE vehicle_id = %s AND user_id = %s;', (vehicle_id, user_id))
            cur.execute('DELETE FROM vehicles WHERE id = %s AND user_id = %s;', (vehicle_id, user_id))
            ensure_active_default_vehicle(cur, db, user_id)
            db.commit()
            return {'message': 'Vehicle and its history deleted', 'purged': True, 'deleted': counts}

        if has_archive_support(db) and (session_count or expense_count):
            cur.execute(
                'UPDATE vehicles SET is_archived = TRUE, is_default = FALSE WHERE id = %s AND user_id = %s;',
                (vehicle_id, user_id),
            )
            ensure_active_default_vehicle(cur, db, user_id)
            db.commit()
            return {'message': 'Vehicle archived because related history exists', 'archived': True}

        cur.execute('DELETE FROM vehicles WHERE id = %s AND user_id = %s;', (vehicle_id, user_id))
        if existing_vehicle.get('is_default'):
            ensure_active_default_vehicle(cur, db, user_id)
        db.commit()
        return {'message': 'Vehicle deleted successfully'}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))