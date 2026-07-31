from fastapi import APIRouter, Depends, HTTPException

try:
    from backend.auth_utils import get_current_user_id
    from backend.billing import get_tenant_db, require_write_access
    from backend.db import column_exists, get_vehicle_column
    from backend.places import resolve_place
    from backend.schemas import ChargingSessionCreate
    from backend.vehicle_events import delete_vehicle_event_by_legacy, sync_session_to_vehicle_event
    from backend.vehicle_rules import validate_session_for_vehicle
except ModuleNotFoundError:
    from auth_utils import get_current_user_id
    from billing import get_tenant_db, require_write_access
    from db import column_exists, get_vehicle_column
    from places import resolve_place
    from schemas import ChargingSessionCreate
    from vehicle_events import delete_vehicle_event_by_legacy, sync_session_to_vehicle_event
    from vehicle_rules import validate_session_for_vehicle

router = APIRouter(tags=['sessions'])


def _location_write(db, user_id, session):
    """SQL fragments and values for the location columns, or empty ones without them.

    Resolving the place is part of the same transaction as the session write, so a
    place can never be created for a record that then fails to save. It deliberately
    cannot raise: location is opt-in decoration on a record whose real content is the
    cost and the odometer, and a phone sending a nonsense fix must not block the save.
    """
    if not column_exists(db, 'charging_sessions', 'latitude'):
        return {'columns': '', 'placeholders': '', 'set': '', 'values': ()}

    place_id = resolve_place(
        db, user_id, session.latitude, session.longitude,
        session.location_accuracy_m, session.place_name,
    )
    return {
        'columns': ', latitude, longitude, location_accuracy_m, place_id',
        'placeholders': ', %s, %s, %s, %s',
        'set': ', latitude = %s, longitude = %s, location_accuracy_m = %s, place_id = %s',
        'values': (session.latitude, session.longitude, session.location_accuracy_m, place_id),
    }


@router.get('/charging_sessions', response_model=list[dict])
def get_charging_sessions(user_id: str = Depends(get_current_user_id), db=Depends(get_tenant_db)):
    cur = db.cursor()
    vehicle_column = get_vehicle_column(db)
    cur.execute(
        f"""
        SELECT
            cs.id,
            cs.{vehicle_column} AS vehicle_id,
            cs.session_type,
            cs.start_time,
            cs.end_time,
            cs.kwh,
            cs.kwh AS energy_kwh,
            cs.fuel_liters,
            cs.cost_amount,
            cs.source,
            cs.battery_level_start,
            cs.battery_level_end,
            cs.odometer,
            cs.notes,
            cs.latitude,
            cs.longitude,
            cs.location_accuracy_m,
            cs.place_id,
            -- Resolved here rather than left to the client: the edit dialog reloads the
            -- row and would otherwise re-save it with the name blanked out.
            p.name AS place_name
        FROM charging_sessions cs
        LEFT JOIN places p ON p.id = cs.place_id
        WHERE cs.user_id = %s
        ORDER BY cs.start_time DESC;
        """,
        (user_id,),
    )
    return cur.fetchall()


@router.patch('/charging_sessions/{session_id}')
def update_charging_session(session_id: str, session: ChargingSessionCreate, user_id: str = Depends(get_current_user_id), _subscription=Depends(require_write_access), db=Depends(get_tenant_db)):
    cur = db.cursor()
    vehicle_column = get_vehicle_column(db)
    try:
        cur.execute(f'SELECT {vehicle_column} AS vehicle_id FROM charging_sessions WHERE id = %s AND user_id = %s;', (session_id, user_id))
        existing_session = cur.fetchone()
        if not existing_session:
            raise HTTPException(status_code=404, detail='Charging session not found')

        # Editing a session already attached to an archived vehicle stays allowed as long
        # as the vehicle is unchanged. Mirrors the None guard in expenses.update_expense:
        # the column is NOT NULL today, but the cast must not be the thing keeping it safe.
        existing_vehicle_id = existing_session['vehicle_id']
        keeps_same_vehicle = (
            existing_vehicle_id is not None and int(existing_vehicle_id) == int(session.vehicle_id)
        )

        validate_session_for_vehicle(
            db,
            user_id,
            session.vehicle_id,
            session.session_type,
            session.kwh,
            session.fuel_liters,
            allow_archived=keeps_same_vehicle,
        )

        location = _location_write(db, user_id, session)
        location_set, location_values = location['set'], location['values']

        cur.execute(
            f"""
            UPDATE charging_sessions
            SET {vehicle_column} = %s, session_type = %s, start_time = %s, end_time = %s,
                kwh = %s, fuel_liters = %s, cost_amount = %s, battery_level_start = %s,
                battery_level_end = %s, source = %s, notes = %s, odometer = %s
                {location_set}
            WHERE id = %s AND user_id = %s;
            """,
            (
                session.vehicle_id, session.session_type, session.start_time, session.end_time,
                session.kwh, session.fuel_liters, session.cost_amount, session.battery_level_start,
                session.battery_level_end, session.source, session.notes, session.odometer,
                *location_values, session_id, user_id,
            ),
        )
        sync_session_to_vehicle_event(db, int(session_id))
        db.commit()
        return {'status': 'success'}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post('/charging_sessions', status_code=201)
def add_charging_session(session: ChargingSessionCreate, user_id: str = Depends(get_current_user_id), _subscription=Depends(require_write_access), db=Depends(get_tenant_db)):
    cur = db.cursor()
    vehicle_column = get_vehicle_column(db)
    try:
        validate_session_for_vehicle(db, user_id, session.vehicle_id, session.session_type, session.kwh, session.fuel_liters)

        location = _location_write(db, user_id, session)
        location_columns, location_placeholders = location['columns'], location['placeholders']
        location_values = location['values']

        cur.execute(
            f"""
            INSERT INTO charging_sessions
            (user_id, {vehicle_column}, session_type, start_time, end_time, kwh, fuel_liters,
             cost_amount, source, battery_level_start, battery_level_end,
             notes, odometer, created_at{location_columns})
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(){location_placeholders})
            RETURNING id;
            """,
            (
                user_id, session.vehicle_id, session.session_type, session.start_time, session.end_time,
                session.kwh, session.fuel_liters, session.cost_amount,
                session.source, session.battery_level_start, session.battery_level_end,
                session.notes, session.odometer, *location_values,
            ),
        )
        session_id = cur.fetchone()['id']
        sync_session_to_vehicle_event(db, session_id)
        db.commit()
        return {'status': 'success', 'session_id': session_id}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete('/charging_sessions/{session_id}')
def delete_charging_session(session_id: int, user_id: str = Depends(get_current_user_id), _subscription=Depends(require_write_access), db=Depends(get_tenant_db)):
    cur = db.cursor()
    try:
        cur.execute('DELETE FROM charging_sessions WHERE id = %s AND user_id = %s;', (session_id, user_id))
        if cur.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=404, detail='Charging session not found')
        delete_vehicle_event_by_legacy(db, 'charging_session', session_id)
        db.commit()
        return {'message': 'Charging session deleted successfully'}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))