from fastapi import APIRouter, Depends, HTTPException

try:
    from backend.db import get_db, table_exists
    from backend.site_settings import get_site_settings
except ModuleNotFoundError:
    from db import get_db, table_exists
    from site_settings import get_site_settings

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

@router.get('/site/config')
def public_site_config(db=Depends(get_db)):
    """The handful of site settings the sign-in screen needs before anyone is signed in.

    Deliberately a whitelist rather than the whole settings object: this endpoint is
    unauthenticated, so trial length, default currency and anything added later stay
    behind the admin API unless they are explicitly published here.
    """
    try:
        settings = get_site_settings(db)
    except Exception:
        # Never let a settings problem break the login screen; the safe answer is the
        # ordinary one.
        return {'registration_open': True, 'maintenance_notice': ''}
    return {
        'registration_open': settings['registration_open'],
        'maintenance_notice': settings['maintenance_notice'],
    }
