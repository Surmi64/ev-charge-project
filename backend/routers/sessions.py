from fastapi import APIRouter, Depends, HTTPException

try:
    from backend.auth_utils import get_current_user_id
    from backend.db import get_db, get_vehicle_column
    from backend.schemas import ChargingSessionCreate
    from backend.vehicle_events import delete_vehicle_event_by_legacy, sync_session_to_vehicle_event
    from backend.vehicle_rules import validate_session_for_vehicle
except ModuleNotFoundError:
    from auth_utils import get_current_user_id
    from db import get_db, get_vehicle_column
    from schemas import ChargingSessionCreate
    from vehicle_events import delete_vehicle_event_by_legacy, sync_session_to_vehicle_event
    from vehicle_rules import validate_session_for_vehicle

router = APIRouter(tags=['sessions'])


@router.get('/charging_sessions', response_model=list[dict])
def get_charging_sessions(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    vehicle_column = get_vehicle_column(db)
    cur.execute(
        f"""
        SELECT
            id,
            {vehicle_column} AS vehicle_id,
            session_type,
            start_time,
            end_time,
            kwh,
            kwh AS energy_kwh,
            fuel_liters,
            cost_huf,
            source,
            battery_level_start,
            battery_level_end,
            odometer,
            notes
        FROM charging_sessions
        WHERE user_id = %s
        ORDER BY start_time DESC;
        """,
        (user_id,),
    )
    return cur.fetchall()


@router.patch('/charging_sessions/{session_id}')
def update_charging_session(session_id: str, session: ChargingSessionCreate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    vehicle_column = get_vehicle_column(db)
    try:
        cur.execute(f'SELECT {vehicle_column} AS vehicle_id FROM charging_sessions WHERE id = %s AND user_id = %s;', (session_id, user_id))
        existing_session = cur.fetchone()
        if not existing_session:
            raise HTTPException(status_code=404, detail='Charging session not found')

        validate_session_for_vehicle(
            db,
            user_id,
            session.vehicle_id,
            session.session_type,
            session.kwh,
            session.fuel_liters,
            allow_archived=int(existing_session['vehicle_id']) == int(session.vehicle_id),
        )

        cur.execute(
            f"""
            UPDATE charging_sessions
            SET {vehicle_column} = %s, session_type = %s, start_time = %s, end_time = %s,
                kwh = %s, fuel_liters = %s, cost_huf = %s, battery_level_start = %s,
                battery_level_end = %s, source = %s, notes = %s, odometer = %s
            WHERE id = %s AND user_id = %s;
            """,
            (
                session.vehicle_id, session.session_type, session.start_time, session.end_time,
                session.kwh, session.fuel_liters, session.cost_huf, session.battery_level_start,
                session.battery_level_end, session.source, session.notes, session.odometer, session_id, user_id,
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
def add_charging_session(session: ChargingSessionCreate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    vehicle_column = get_vehicle_column(db)
    try:
        validate_session_for_vehicle(db, user_id, session.vehicle_id, session.session_type, session.kwh, session.fuel_liters)

        cur.execute(
            f"""
            INSERT INTO charging_sessions
            (user_id, {vehicle_column}, session_type, start_time, end_time, kwh, fuel_liters,
             cost_huf, source, battery_level_start, battery_level_end,
             notes, odometer, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            RETURNING id;
            """,
            (
                user_id, session.vehicle_id, session.session_type, session.start_time, session.end_time,
                session.kwh, session.fuel_liters, session.cost_huf,
                session.source, session.battery_level_start, session.battery_level_end,
                session.notes, session.odometer,
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
def delete_charging_session(session_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
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