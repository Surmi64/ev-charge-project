from fastapi import APIRouter, Depends, HTTPException, Query

import psycopg2

try:
    from backend.auth_utils import get_current_user_id
    from backend.billing import get_tenant_db, require_write_access
    from backend.places import MATCH_RADIUS_M, find_nearest_place
except ModuleNotFoundError:
    from auth_utils import get_current_user_id
    from billing import get_tenant_db, require_write_access
    from places import MATCH_RADIUS_M, find_nearest_place

router = APIRouter(tags=['places'])


def _serialize(row) -> dict:
    return {
        'id': row['id'],
        'name': row['name'],
        'latitude': float(row['latitude']),
        'longitude': float(row['longitude']),
        'visit_count': row['visit_count'],
    }


@router.get('/places')
def list_places(user_id: str = Depends(get_current_user_id), db=Depends(get_tenant_db)):
    """The account's named places, most visited first.

    Feeds the name field's suggestions, so someone who is out of signal — or who never
    granted the permission — can still file a record against a place they already know
    by picking the name.
    """
    cur = db.cursor()
    # The count comes from the records rather than places.visit_count, which is only the
    # weight behind the stored coordinates — see count_records_at.
    cur.execute(
        """
        SELECT p.id, p.name, p.latitude, p.longitude,
               COUNT(cs.id)::int AS visit_count
        FROM places p
        LEFT JOIN charging_sessions cs ON cs.place_id = p.id AND cs.user_id = p.user_id
        WHERE p.user_id = %s
        GROUP BY p.id, p.name, p.latitude, p.longitude
        ORDER BY COUNT(cs.id) DESC, LOWER(p.name);
        """,
        (user_id,),
    )
    return [_serialize(row) for row in cur.fetchall()]


@router.get('/places/nearby')
def nearby_place(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    user_id: str = Depends(get_current_user_id),
    db=Depends(get_tenant_db),
):
    """The known place a coordinate falls in, if any.

    A GET with the coordinate in the query string, which is the one thing the privacy
    rules would normally object to — but this is the account's own location going to the
    account's own server to be matched against the account's own list, and it is a read
    with no side effect. It is not logged with the request path anywhere the other
    endpoints are not.
    """
    match = find_nearest_place(db, user_id, latitude, longitude)
    return {'match': match, 'radius_m': MATCH_RADIUS_M}


@router.patch('/places/{place_id}')
def rename_place(
    place_id: int,
    name: str = Query(..., min_length=1, max_length=120),
    user_id: str = Depends(get_current_user_id),
    _subscription=Depends(require_write_access),
    db=Depends(get_tenant_db),
):
    """Rename a place everywhere at once.

    The whole reason places are a table: the name lives in one row, so correcting it
    fixes every record filed against it rather than only the next one.
    """
    cleaned = name.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail='A place needs a name')

    cur = db.cursor()
    try:
        cur.execute(
            'UPDATE places SET name = %s, updated_at = NOW() WHERE id = %s AND user_id = %s;',
            (cleaned, place_id, user_id),
        )
        if cur.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=404, detail='Place not found')
        # The read model carries a copy of the name, so it has to be restated.
        cur.execute(
            """
            UPDATE vehicle_events ve
            SET place_name = %s, updated_at = NOW()
            FROM charging_sessions cs
            WHERE ve.legacy_source = 'charging_session'
              AND ve.legacy_id = cs.id
              AND cs.place_id = %s
              AND ve.user_id = %s;
            """,
            (cleaned, place_id, user_id),
        )
        db.commit()
        return {'status': 'success', 'name': cleaned}
    except HTTPException:
        raise
    except psycopg2.IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail='You already have a place with that name')
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete('/places/{place_id}')
def delete_place(
    place_id: int,
    user_id: str = Depends(get_current_user_id),
    _subscription=Depends(require_write_access),
    db=Depends(get_tenant_db),
):
    """Forget a place. The records stay; they simply stop being grouped under a name.

    `place_id` is ON DELETE SET NULL rather than CASCADE, because deleting somewhere you
    once charged must never delete the charge. The raw coordinates stay on the session
    too, so the grouping can be rebuilt if it was a mistake.
    """
    cur = db.cursor()
    try:
        cur.execute(
            """
            UPDATE vehicle_events ve
            SET place_name = NULL, updated_at = NOW()
            FROM charging_sessions cs
            WHERE ve.legacy_source = 'charging_session'
              AND ve.legacy_id = cs.id
              AND cs.place_id = %s
              AND ve.user_id = %s;
            """,
            (place_id, user_id),
        )
        cur.execute('DELETE FROM places WHERE id = %s AND user_id = %s;', (place_id, user_id))
        if cur.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=404, detail='Place not found')
        db.commit()
        return {'message': 'Place deleted'}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
