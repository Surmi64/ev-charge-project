"""Turning a coordinate into a place the account already knows.

The point of the feature is not to store latitudes, it is to stop asking the same
question. Someone who fills up at the same petrol station forty times should name it
once; every later visit lands on that name because it is within a few dozen metres of
the last one.

So there are two representations and they are not redundant:

* the raw fix on the session — where the phone said it was, that time, with the
  accuracy it claimed
* the `places` row — the account's own name for a spot it keeps returning to

Matching is deliberately conservative. A wrong match silently files a charge under the
wrong station, which is worse than asking again, and unlike a wrong odometer reading
nothing downstream will ever look implausible enough to catch it.
"""

from math import asin, cos, radians, sin, sqrt

# How close a fix has to be to an existing place to be treated as the same spot.
# Roughly the size of a large forecourt: far enough that parking at a different pump
# still matches, tight enough that the filling station and the supermarket sharing a
# car park do not become one place.
MATCH_RADIUS_M = 150.0

# A fix vaguer than this is not evidence of being anywhere in particular — it is a
# phone that fell back to network positioning. It is still stored, because the user
# asked for it, but it will not name a place or create one.
MAX_TRUSTED_ACCURACY_M = 250.0

EARTH_RADIUS_M = 6371008.8


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    phi1, phi2 = radians(lat1), radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = radians(lon2 - lon1)
    a = sin(d_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(a)))


def _bounding_box(latitude: float, longitude: float, radius_m: float):
    """A lat/lon rectangle that certainly contains the radius, for the index to use.

    Longitude degrees shrink toward the poles, hence the cos(latitude) term. Guarded
    against the poles, where that term goes to zero and the box would become infinite.
    """
    lat_delta = radius_m / 111_320.0
    shrink = max(cos(radians(latitude)), 0.01)
    lon_delta = radius_m / (111_320.0 * shrink)
    return latitude - lat_delta, latitude + lat_delta, longitude - lon_delta, longitude + lon_delta


def find_nearest_place(db, user_id, latitude: float, longitude: float, radius_m: float = MATCH_RADIUS_M):
    """The account's closest known place within `radius_m`, or None.

    The bounding box is a prefilter, not the answer: it is a rectangle and the radius is
    a circle, so the corners are further away than they look. The haversine below is
    what actually decides.
    """
    min_lat, max_lat, min_lon, max_lon = _bounding_box(latitude, longitude, radius_m)
    cur = db.cursor()
    cur.execute(
        """
        SELECT id, name, latitude, longitude, visit_count
        FROM places
        WHERE user_id = %s
          AND latitude BETWEEN %s AND %s
          AND longitude BETWEEN %s AND %s;
        """,
        (user_id, min_lat, max_lat, min_lon, max_lon),
    )

    nearest = None
    for row in cur.fetchall():
        distance = haversine_m(latitude, longitude, float(row['latitude']), float(row['longitude']))
        if distance <= radius_m and (nearest is None or distance < nearest['distance_m']):
            nearest = {
                'id': row['id'],
                'name': row['name'],
                'latitude': float(row['latitude']),
                'longitude': float(row['longitude']),
                'distance_m': round(distance, 1),
            }

    if nearest:
        # Counted from the records, not from places.visit_count. That column is the
        # weight behind the stored position and only trusted fixes contribute to it, so
        # it is smaller than the number of times someone actually filled up here — and
        # "4 previous visits" on screen has to mean four records.
        nearest['visit_count'] = count_records_at(db, user_id, nearest['id'])
    return nearest


def count_records_at(db, user_id, place_id) -> int:
    cur = db.cursor()
    cur.execute(
        'SELECT COUNT(*) AS total FROM charging_sessions WHERE user_id = %s AND place_id = %s;',
        (user_id, place_id),
    )
    return (cur.fetchone() or {}).get('total', 0)


def resolve_place(db, user_id, latitude, longitude, accuracy_m=None, name=None):
    """Find or create the place a session belongs to. Returns its id, or None.

    Called from the session write path, so it must never be the reason a record fails to
    save: a coordinate with nothing to match and no name given simply stays a raw fix on
    the session.

    Does not commit. The caller owns the transaction, and the place must appear or not
    appear together with the session that created it.
    """
    if latitude is None or longitude is None:
        return None

    latitude, longitude = float(latitude), float(longitude)
    trusted = accuracy_m is None or float(accuracy_m) <= MAX_TRUSTED_ACCURACY_M
    cleaned = (name or '').strip()[:120]

    cur = db.cursor()

    # An explicit name wins over proximity. Someone typing "Otthon" at a spot the phone
    # placed 200 m off is correcting us, not describing somewhere new.
    if cleaned:
        cur.execute('SELECT id FROM places WHERE user_id = %s AND LOWER(name) = LOWER(%s);', (user_id, cleaned))
        existing = cur.fetchone()
        if existing:
            # Nudge the stored point toward the newest fix rather than replacing it, so
            # one bad reading cannot move a place across the street. Only trusted fixes
            # get a vote.
            if trusted:
                cur.execute(
                    """
                    UPDATE places
                    SET latitude = latitude + (%s - latitude) / (visit_count + 2),
                        longitude = longitude + (%s - longitude) / (visit_count + 2),
                        visit_count = visit_count + 1,
                        updated_at = NOW()
                    WHERE id = %s;
                    """,
                    (latitude, longitude, existing['id']),
                )
            return existing['id']

    if not trusted:
        return None

    nearest = find_nearest_place(db, user_id, latitude, longitude)
    if nearest and not cleaned:
        cur.execute(
            """
            UPDATE places
            SET latitude = latitude + (%s - latitude) / (visit_count + 2),
                longitude = longitude + (%s - longitude) / (visit_count + 2),
                visit_count = visit_count + 1,
                updated_at = NOW()
            WHERE id = %s;
            """,
            (latitude, longitude, nearest['id']),
        )
        return nearest['id']

    if not cleaned:
        # A coordinate nobody has named is not yet a place. Creating "Place 7" here would
        # fill the list with entries the user never asked for and cannot tell apart.
        return None

    cur.execute(
        """
        INSERT INTO places (user_id, name, latitude, longitude, visit_count)
        VALUES (%s, %s, %s, %s, 1)
        RETURNING id;
        """,
        (user_id, cleaned, latitude, longitude),
    )
    return cur.fetchone()['id']


def place_name_for(db, place_id):
    """The name to denormalise onto vehicle_events, or None."""
    if not place_id:
        return None
    cur = db.cursor()
    cur.execute('SELECT name FROM places WHERE id = %s;', (place_id,))
    row = cur.fetchone()
    return row['name'] if row else None
