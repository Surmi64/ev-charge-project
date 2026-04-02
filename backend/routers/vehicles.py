from fastapi import APIRouter, Depends, HTTPException, Query

try:
    from backend.auth_utils import get_current_user_id
    from backend.db import column_exists, get_db, get_vehicle_column
    from backend.schemas import VehicleCreate, VehicleUpdate
    from backend.vehicle_rules import normalize_vehicle_payload
except ModuleNotFoundError:
    from auth_utils import get_current_user_id
    from db import column_exists, get_db, get_vehicle_column
    from schemas import VehicleCreate, VehicleUpdate
    from vehicle_rules import normalize_vehicle_payload

router = APIRouter(tags=['vehicles'])


def has_archive_support(db) -> bool:
    return column_exists(db, 'vehicles', 'is_archived')


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
    db=Depends(get_db),
):
    cur = db.cursor()
    if has_archive_support(db):
        archived_filter = '' if include_archived else 'AND is_archived = FALSE'
        cur.execute(
            f'''
            SELECT *
            FROM vehicles
            WHERE user_id = %s {archived_filter}
            ORDER BY is_archived ASC, is_default DESC, created_at DESC;
            ''',
            (user_id,),
        )
    else:
        cur.execute('SELECT * FROM vehicles WHERE user_id = %s ORDER BY is_default DESC, created_at DESC;', (user_id,))
    return cur.fetchall()


@router.post('/vehicles', status_code=201)
def create_vehicle(vehicle: VehicleCreate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    try:
        payload = normalize_vehicle_payload(vehicle)

        if vehicle.is_default:
            cur.execute(
                f'UPDATE vehicles SET is_default = FALSE WHERE user_id = %s AND {get_active_vehicle_predicate(db)};',
                (user_id,),
            )

        cur.execute(
            """INSERT INTO vehicles (
                   user_id, name, make, model, fuel_type, year, license_plate,
                   battery_capacity_kwh, tank_capacity_liters, starting_odometer_km,
                   color_hex, notes, is_default
               )
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id;""",
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
            ),
        )
        vehicle_id = cur.fetchone()['id']
        db.commit()
        return {'message': 'Vehicle created', 'vehicle_id': vehicle_id}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch('/vehicles/{vehicle_id}')
def update_vehicle(vehicle_id: int, vehicle: VehicleUpdate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    select_fields = 'id, is_default, is_archived' if has_archive_support(db) else 'id, is_default'
    cur.execute(f'SELECT {select_fields} FROM vehicles WHERE id = %s AND user_id = %s;', (vehicle_id, user_id))
    existing_vehicle = cur.fetchone()
    if not existing_vehicle:
        raise HTTPException(status_code=404, detail='Vehicle not found or unauthorized')

    updates = []
    values = []
    normalized_payload = normalize_vehicle_payload(vehicle)

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


@router.delete('/vehicles/{vehicle_id}')
def delete_vehicle(vehicle_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    select_fields = 'id, is_default, is_archived' if has_archive_support(db) else 'id, is_default'
    cur.execute(f'SELECT {select_fields} FROM vehicles WHERE id = %s AND user_id = %s;', (vehicle_id, user_id))
    existing_vehicle = cur.fetchone()
    if not existing_vehicle:
        raise HTTPException(status_code=404, detail='Vehicle not found or unauthorized')

    try:
        vehicle_column = get_vehicle_column(db)
        cur.execute(f'SELECT COUNT(*) AS count FROM charging_sessions WHERE {vehicle_column} = %s AND user_id = %s;', (vehicle_id, user_id))
        session_count = cur.fetchone()['count']
        cur.execute('SELECT COUNT(*) AS count FROM expenses WHERE vehicle_id = %s AND user_id = %s;', (vehicle_id, user_id))
        expense_count = cur.fetchone()['count']

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