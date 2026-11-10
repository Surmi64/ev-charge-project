import re
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query

import psycopg2

try:
    from backend.billing import get_tenant_db, get_tenant_user_id, require_fleet_manager, require_write_access
    from backend.db import get_vehicle_column
    from backend.places import MATCH_RADIUS_M, find_nearest_place
    from backend.providers import SITE_SHAPE, _is_provenance
    from backend.schemas import PlaceAssignRequest
except ModuleNotFoundError:
    from billing import get_tenant_db, get_tenant_user_id, require_fleet_manager, require_write_access
    from db import get_vehicle_column
    from places import MATCH_RADIUS_M, find_nearest_place
    from providers import SITE_SHAPE, _is_provenance
    from schemas import PlaceAssignRequest

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
def list_places(user_id: str = Depends(get_tenant_user_id), db=Depends(get_tenant_db)):
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
    user_id: str = Depends(get_tenant_user_id),
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
    user_id: str = Depends(get_tenant_user_id),
    _subscription=Depends(require_write_access),
    db=Depends(get_tenant_db),
    _manager=Depends(require_fleet_manager),
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
    user_id: str = Depends(get_tenant_user_id),
    _subscription=Depends(require_write_access),
    db=Depends(get_tenant_db),
    _manager=Depends(require_fleet_manager),
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


# --- filing older records under a place ------------------------------------------------------
# Most history predates location capture: the record names its site in words ("Evse HK
# AC 22 kW", "Shell Rakamaz") and has no coordinate. These two endpoints turn that into
# places in bulk — the records are grouped by the words that name the site, each group
# gets a suggested existing place, and one call files a whole group.

# Words that describe the charger rather than the site, so they say nothing about where.
_NON_PLACE_WORDS = {'ac', 'dc', 'kw', 'kwh', 'hpc'}
# How alike a group's words and a place's name must be before the place is suggested:
# the shared words over all the words either has. "TEA Abony DC 130 kW" and "Abony Tea"
# score 1, "Evse Gyál" and "Gyál" a half; "LIDL Debrecen Derék" and "Lidl Balmazújvárosi"
# a quarter, and are not paired. It is only ever a suggestion the user confirms.
SUGGEST_MIN_SIMILARITY = 0.5


def _site_words(text: str) -> set[str]:
    return {
        word for word in re.split(r'\W+', (text or '').lower(), flags=re.UNICODE)
        if word and word not in _NON_PLACE_WORDS and not any(ch.isdigit() for ch in word)
    }


def _site_label(source: str | None, notes: str | None) -> str:
    """The words on a record that name where it happened, or '' if none do.

    A note shaped like a charger description beats the source (which for imported rows
    is only the importer's tag); otherwise a source that is not a provenance marker; and
    last a plain note, which on a fill-up is usually the station.
    """
    note = (notes or '').strip()
    cleaned_source = (source or '').strip()
    if note and SITE_SHAPE.search(note):
        return note
    if cleaned_source and not _is_provenance(cleaned_source):
        return note if note and _site_words(cleaned_source) <= _site_words(note) else cleaned_source
    return note


@router.get('/places/unassigned')
def unassigned_records(user_id: str = Depends(get_tenant_user_id), db=Depends(get_tenant_db), _manager=Depends(require_fleet_manager)):
    """Charging and fueling records with no place and no coordinate, grouped by the
    words that name their site, largest group first.

    Archived vehicles are left out, as on the map whose gaps this fills: the count on
    the map card and the records offered here have to be the same records.
    """
    cur = db.cursor()
    vehicle_column = get_vehicle_column(db)
    cur.execute(
        f"""
        SELECT cs.id, cs.session_type, cs.start_time, cs.kwh, cs.fuel_liters, cs.source, cs.notes
        FROM charging_sessions cs
        JOIN vehicles v ON v.id = cs.{vehicle_column}
        WHERE cs.user_id = %s AND cs.place_id IS NULL AND cs.latitude IS NULL
          AND COALESCE(v.is_archived, FALSE) = FALSE
        ORDER BY cs.start_time;
        """,
        (user_id,),
    )
    groups: dict[str, dict] = {}
    for row in cur.fetchall():
        label = _site_label(row.get('source'), row.get('notes'))
        # Keyed by the site's words, not the text: "TEA Abony DC 130 kW" and "TEA Abony
        # DC 150 kW" are two chargers at one site, and a place is the site.
        words = _site_words(label)
        key = ' '.join(sorted(words)) if words else label.lower()
        group = groups.setdefault(key, {
            'spellings': Counter(),
            'session_ids': [],
            'charging': 0,
            'fueling': 0,
            'energy_kwh': 0.0,
            'fuel_liters': 0.0,
            'first_at': row['start_time'],
            'last_at': row['start_time'],
        })
        group['spellings'][label] += 1
        group['session_ids'].append(row['id'])
        group['charging' if row['session_type'] == 'charging' else 'fueling'] += 1
        group['energy_kwh'] += float(row.get('kwh') or 0)
        group['fuel_liters'] += float(row.get('fuel_liters') or 0)
        group['last_at'] = row['start_time']

    cur.execute('SELECT id, name FROM places WHERE user_id = %s;', (user_id,))
    places = [(place, _site_words(place['name'])) for place in cur.fetchall()]

    result = []
    for key, group in groups.items():
        group['label'] = group['spellings'].most_common(1)[0][0]
        words = _site_words(group['label'])
        suggestion, best = None, 0.0
        for place, place_words in places:
            if not words or not place_words:
                continue
            score = len(words & place_words) / len(words | place_words)
            if score > best:
                suggestion, best = place, score
        result.append({
            'key': key,
            'label': group['label'],
            'count': len(group['session_ids']),
            'session_ids': group['session_ids'],
            'charging': group['charging'],
            'fueling': group['fueling'],
            'energy_kwh': round(group['energy_kwh'], 2),
            'fuel_liters': round(group['fuel_liters'], 2),
            'first_at': group['first_at'].isoformat(),
            'last_at': group['last_at'].isoformat(),
            'suggested_place_id': suggestion['id'] if suggestion and best >= SUGGEST_MIN_SIMILARITY else None,
        })
    # Unnamed records last: there is nothing to go on, so they are the least likely to
    # be filed in one go.
    result.sort(key=lambda group: (not group['label'], -group['count'], group['label'].lower()))
    return result


@router.post('/places/assign')
def assign_place(
    payload: PlaceAssignRequest,
    user_id: str = Depends(get_tenant_user_id),
    _subscription=Depends(require_write_access),
    _manager=Depends(require_fleet_manager),
    db=Depends(get_tenant_db),
):
    """File records under a place: an existing one by id, or a new one by name and position.

    Only records that have no place yet are touched, so a stale selection can never move
    a record someone already filed elsewhere. The records keep no coordinate of their
    own: none was ever measured, and inventing one from the place would pass a guess off
    as a reading. The map places them through the place.
    """
    session_ids = sorted(set(payload.session_ids))
    if not session_ids:
        raise HTTPException(status_code=400, detail='No records selected')

    cur = db.cursor()
    try:
        if payload.place_id is not None:
            cur.execute('SELECT id, name FROM places WHERE id = %s AND user_id = %s;', (payload.place_id, user_id))
            place = cur.fetchone()
            if not place:
                raise HTTPException(status_code=404, detail='Place not found')
        else:
            name = (payload.name or '').strip()
            if not name or payload.latitude is None or payload.longitude is None:
                raise HTTPException(status_code=400, detail='A new place needs a name and a position on the map')
            cur.execute(
                """
                INSERT INTO places (user_id, name, latitude, longitude)
                VALUES (%s, %s, %s, %s)
                RETURNING id, name;
                """,
                (user_id, name, payload.latitude, payload.longitude),
            )
            place = cur.fetchone()

        cur.execute(
            """
            UPDATE charging_sessions SET place_id = %s
            WHERE user_id = %s AND id = ANY(%s) AND place_id IS NULL
            RETURNING id;
            """,
            (place['id'], user_id, session_ids),
        )
        updated = [row['id'] for row in cur.fetchall()]
        # The read model carries a copy of the name, as in rename_place.
        cur.execute(
            """
            UPDATE vehicle_events SET place_name = %s, updated_at = NOW()
            WHERE legacy_source = 'charging_session' AND user_id = %s AND legacy_id = ANY(%s);
            """,
            (place['name'], user_id, updated),
        )
        db.commit()
        return {'place': {'id': place['id'], 'name': place['name']}, 'assigned': len(updated)}
    except HTTPException:
        db.rollback()
        raise
    except psycopg2.IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail='You already have a place with that name. Pick it from the list instead.')
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
