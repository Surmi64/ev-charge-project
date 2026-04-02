from fastapi import APIRouter, Depends, HTTPException

try:
    from backend.db import get_db, table_exists
except ModuleNotFoundError:
    from db import get_db, table_exists

router = APIRouter(tags=['health'])

REQUIRED_TABLES = [
    'users',
    'vehicles',
    'charging_sessions',
    'expenses',
    'user_sessions',
    'auth_audit_logs',
    'password_reset_tokens',
]

OPTIONAL_TABLES = [
    'vehicle_events',
    'recurring_expense_reminders',
]


@router.get('/health')
def healthcheck(db=Depends(get_db)):
    try:
        cur = db.cursor()
        cur.execute('SELECT 1 AS ok;')
        row = cur.fetchone() or {}
        return {'status': 'ok', 'database': 'ok', 'result': row.get('ok', 1)}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f'Healthcheck failed: {exc}')


@router.get('/ready')
def readiness_check(db=Depends(get_db)):
    try:
        cur = db.cursor()
        cur.execute('SELECT 1 AS ok;')
        row = cur.fetchone() or {}

        missing_required_tables = [table_name for table_name in REQUIRED_TABLES if not table_exists(db, table_name)]
        missing_optional_tables = [table_name for table_name in OPTIONAL_TABLES if not table_exists(db, table_name)]

        response = {
            'status': 'ready' if not missing_required_tables else 'not_ready',
            'database': 'ok' if row.get('ok', 0) == 1 else 'error',
            'required_tables_checked': REQUIRED_TABLES,
            'missing_required_tables': missing_required_tables,
            'optional_tables_checked': OPTIONAL_TABLES,
            'missing_optional_tables': missing_optional_tables,
        }

        if missing_required_tables:
            raise HTTPException(status_code=503, detail=response)

        return response
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail={'status': 'not_ready', 'database': 'error', 'reason': str(exc)})