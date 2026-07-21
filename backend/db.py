import psycopg2
from psycopg2.extras import RealDictCursor

try:
    from backend.config import DB_APP_PASS, DB_APP_USER, DB_HOST, DB_NAME, DB_PORT
except ModuleNotFoundError:
    from config import DB_APP_PASS, DB_APP_USER, DB_HOST, DB_NAME, DB_PORT


def get_db():
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_APP_USER,
        password=DB_APP_PASS,
        cursor_factory=RealDictCursor,
    )
    try:
        yield conn
    finally:
        conn.close()


def set_tenant(db, user_id) -> None:
    """Bind this connection to one tenant for the rest of the request.

    Row level security keys off `app.user_id`. A plain SET (not SET LOCAL) is used
    deliberately: handlers commit mid-request, and SET LOCAL would be discarded at
    that point, leaving later statements with no tenant and therefore no rows.
    get_db opens a fresh connection per request, so the setting cannot leak.
    """
    cur = db.cursor()
    cur.execute('SET app.user_id = %s;', (str(user_id),))


def column_exists(db, table_name: str, column_name: str) -> bool:
    cur = db.cursor()
    cur.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
        LIMIT 1;
        """,
        (table_name, column_name),
    )
    return cur.fetchone() is not None


def get_vehicle_column(db) -> str:
    return 'vehicle_id_ref' if column_exists(db, 'charging_sessions', 'vehicle_id_ref') else 'vehicle_id'


def table_exists(db, table_name: str) -> bool:
    cur = db.cursor()
    cur.execute(
        """
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = %s
        LIMIT 1;
        """,
        (table_name,),
    )
    return cur.fetchone() is not None
