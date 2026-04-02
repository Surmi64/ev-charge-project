import psycopg2
from psycopg2.extras import RealDictCursor

try:
    from backend.config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS
except ModuleNotFoundError:
    from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS


def get_db():
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS,
        cursor_factory=RealDictCursor,
    )
    try:
        yield conn
    finally:
        conn.close()


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