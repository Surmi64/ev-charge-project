from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import EmailStr
import psycopg2
from psycopg2.extras import Json

try:
    from backend.auth_rate_limit import check_login_rate_limit, clear_login_failures, register_login_failure
    from backend.auth_utils import (
        create_access_token,
        create_refresh_token,
        get_current_user_id,
        hash_token,
        pwd_context,
        validate_password_strength,
    )
    from backend.config import BOOTSTRAP_ADMIN_EMAIL, CURRENCY_CODES, DISTANCE_UNITS, SUPPORTED_CURRENCIES, VOLUME_UNITS, IS_DEVELOPMENT, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
    from backend.db import column_exists, get_db, table_exists
    from backend.site_settings import get_site_settings
    from backend.schemas import ForgotPasswordRequest, LogoutRequest, RefreshTokenRequest, ResetPasswordRequest, UserLogin, UserRegister
except ModuleNotFoundError:
    from auth_rate_limit import check_login_rate_limit, clear_login_failures, register_login_failure
    from auth_utils import create_access_token, create_refresh_token, get_current_user_id, hash_token, pwd_context, validate_password_strength
    from config import BOOTSTRAP_ADMIN_EMAIL, CURRENCY_CODES, DISTANCE_UNITS, SUPPORTED_CURRENCIES, VOLUME_UNITS, IS_DEVELOPMENT, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
    from db import column_exists, get_db, table_exists
    from site_settings import get_site_settings
    from schemas import ForgotPasswordRequest, LogoutRequest, RefreshTokenRequest, ResetPasswordRequest, UserLogin, UserRegister

router = APIRouter(tags=['auth'])

ALLOWED_USER_ROLES = {'admin', 'user'}


def get_client_ip(request: Request | None):
    if not request or not request.client:
        return None
    return request.client.host


def ensure_user_roles(db):
    """Promote the configured bootstrap account to admin, once.

    This used to ALTER the users table on every auth request and hard-coded a
    personal address. The schema now comes from migrations, and the address is
    configuration, so a stock deployment promotes nobody.
    """
    if not BOOTSTRAP_ADMIN_EMAIL:
        return

    cur = db.cursor()
    cur.execute(
        "UPDATE users SET role = 'admin' WHERE LOWER(email) = LOWER(%s) AND role <> 'admin';",
        (BOOTSTRAP_ADMIN_EMAIL,),
    )
    if cur.rowcount:
        db.commit()


def log_auth_event(db, event_type: str, status: str, user_id=None, email=None, ip_address=None, details=None):
    cur = db.cursor()
    cur.execute(
        """
        INSERT INTO auth_audit_logs (user_id, email, event_type, status, ip_address, details)
        VALUES (%s, %s, %s, %s, %s, %s);
        """,
        (user_id, email, event_type, status, ip_address, Json(details or {})),
    )


def serialize_auth_log(row):
    return {
        'id': row['id'],
        'event_type': row['event_type'],
        'status': row['status'],
        'ip_address': row.get('ip_address'),
        'details': row.get('details') or {},
        'created_at': row['created_at'].isoformat() if row.get('created_at') else None,
    }


def load_user_profile(db, user_id) -> dict | None:
    """The one description of a user the client gets, whichever endpoint it asks.

    /auth/me, login and refresh each used to assemble this separately, and the short
    version login and refresh returned held only id, username, email and role. The
    client overwrites its whole user object with whatever those two return, so every
    refresh silently reset the account's currency and unit preferences and — because
    onboarded_at came back missing — dropped a working session into the onboarding
    wizard. `role` was patched into the short version for exactly this reason once
    already; sharing one loader is what stops the next field repeating it.
    """
    cur = db.cursor()
    columns = ['id', 'username', 'email', 'role', 'created_at']
    if column_exists(db, 'users', 'theme_mode'):
        columns.append('theme_mode')
    if column_exists(db, 'users', 'dismissed_alerts'):
        columns.append('dismissed_alerts')
    for preference in ('currency', 'distance_unit', 'volume_unit', 'onboarded_at'):
        if column_exists(db, 'users', preference):
            columns.append(preference)

    cur.execute(f"SELECT {', '.join(columns)} FROM users WHERE id = %s;", (user_id,))
    user = cur.fetchone()
    if not user:
        return None

    user.setdefault('theme_mode', 'dark')
    user.setdefault('role', 'user')
    user.setdefault('dismissed_alerts', [])
    user.setdefault('currency', 'EUR')
    user.setdefault('distance_unit', 'km')
    user.setdefault('volume_unit', 'l')
    user['onboarded_at'] = user['onboarded_at'].isoformat() if user.get('onboarded_at') else None
    return user


def build_auth_payload(db, user_id, access_token: str, refresh_token: str):
    profile = load_user_profile(db, user_id)
    if not profile:
        raise HTTPException(status_code=404, detail='User not found')
    return {
        'access_token': access_token,
        'refresh_token': refresh_token,
        'token_type': 'bearer',
        'user': profile,
    }


def create_session_tokens(db, db_user: dict):
    refresh_token, refresh_expires_at = create_refresh_token()
    refresh_hash = hash_token(refresh_token)
    access_token = create_access_token(data={'sub': str(db_user['id'])})

    cur = db.cursor()
    cur.execute(
        """
        INSERT INTO user_sessions (user_id, token_hash, expires_at, last_used_at)
        VALUES (%s, %s, %s, NOW())
        RETURNING id;
        """,
        (db_user['id'], refresh_hash, refresh_expires_at),
    )
    db.commit()
    return build_auth_payload(db, db_user['id'], access_token, refresh_token)


def is_session_expired(expires_at):
    if not expires_at:
        return True
    if getattr(expires_at, 'tzinfo', None):
        return expires_at <= datetime.now(timezone.utc)
    return expires_at <= datetime.utcnow()


@router.post('/auth/register', status_code=201)
def register(user: UserRegister, request: Request, db=Depends(get_db)):
    ensure_user_roles(db)

    settings = get_site_settings(db)
    if not settings['registration_open']:
        log_auth_event(db, 'register', 'failed', email=user.email, ip_address=get_client_ip(request), details={'reason': 'registration_closed'})
        db.commit()
        raise HTTPException(status_code=403, detail='New registrations are currently closed.')

    validate_password_strength(user.password)
    pwd_hash = pwd_context.hash(user.password)
    cur = db.cursor()
    try:
        role = 'admin' if BOOTSTRAP_ADMIN_EMAIL and user.email.lower() == BOOTSTRAP_ADMIN_EMAIL.lower() else 'user'
        if column_exists(db, 'users', 'currency'):
            cur.execute(
                'INSERT INTO users (username, email, password_hash, role, currency) VALUES (%s, %s, %s, %s, %s) RETURNING id;',
                (user.username, user.email, pwd_hash, role, settings['default_currency']),
            )
        else:
            cur.execute(
                'INSERT INTO users (username, email, password_hash, role) VALUES (%s, %s, %s, %s) RETURNING id;',
                (user.username, user.email, pwd_hash, role),
            )
        user_id = cur.fetchone()['id']
        db.commit()
        log_auth_event(db, 'register', 'success', user_id=user_id, email=user.email, ip_address=get_client_ip(request))
        db.commit()
        return {'message': 'User registered successfully', 'user_id': user_id}
    except psycopg2.IntegrityError as exc:
        db.rollback()
        # Both username and email carry a case-insensitive unique index, so "one of
        # these is taken" left the client unable to say which field to fix. The
        # constraint name says exactly which, and the sign-up form needs that to put
        # the error under the right input.
        constraint = getattr(getattr(exc, 'diag', None), 'constraint_name', None) or ''
        if 'username' in constraint:
            field, message = 'username', 'That name is already taken. Please pick another.'
        elif 'email' in constraint:
            field, message = 'email', 'An account already exists for this email address.'
        else:
            field, message = None, 'Username or email already exists'
        log_auth_event(
            db, 'register', 'failed', email=user.email, ip_address=get_client_ip(request),
            details={'reason': 'duplicate_user', 'field': field},
        )
        db.commit()
        # Returned rather than raised so `field` can travel beside `detail`. A header
        # would need CORS expose_headers to be readable off-origin; keeping detail a
        # plain string keeps every existing caller working unchanged.
        return JSONResponse(status_code=409, content={'detail': message, 'field': field})
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post('/auth/login')
def login(user: UserLogin, request: Request, db=Depends(get_db)):
    check_login_rate_limit(user.email)
    ensure_user_roles(db)
    cur = db.cursor()
    cur.execute('SELECT * FROM users WHERE LOWER(email) = LOWER(%s);', (user.email,))
    db_user = cur.fetchone()

    if not db_user or not pwd_context.verify(user.password, db_user['password_hash']):
        register_login_failure(user.email)
        log_auth_event(db, 'login', 'failed', email=user.email, ip_address=get_client_ip(request), details={'reason': 'invalid_credentials'})
        db.commit()
        raise HTTPException(status_code=401, detail='Invalid email or password')

    clear_login_failures(user.email)

    if column_exists(db, 'users', 'last_login_at'):
        cur.execute('UPDATE users SET last_login_at = NOW() WHERE id = %s;', (db_user['id'],))
        db.commit()

    payload = create_session_tokens(db, db_user)
    log_auth_event(db, 'login', 'success', user_id=db_user['id'], email=db_user['email'], ip_address=get_client_ip(request))
    db.commit()
    return payload


@router.post('/auth/refresh')
def refresh_session(payload: RefreshTokenRequest, request: Request, db=Depends(get_db)):
    ensure_user_roles(db)
    cur = db.cursor()
    refresh_hash = hash_token(payload.refresh_token)
    cur.execute(
        """
        SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.username, u.email, u.role
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = %s
        LIMIT 1;
        """,
        (refresh_hash,),
    )
    session = cur.fetchone()

    if not session:
        log_auth_event(db, 'refresh', 'failed', ip_address=get_client_ip(request), details={'reason': 'invalid_token'})
        db.commit()
        raise HTTPException(status_code=401, detail='Invalid refresh token')

    if session.get('revoked_at') is not None:
        log_auth_event(db, 'refresh', 'failed', user_id=session['user_id'], email=session['email'], ip_address=get_client_ip(request), details={'reason': 'revoked_token'})
        db.commit()
        raise HTTPException(status_code=401, detail='Refresh token has been revoked')

    expires_at = session.get('expires_at')
    if is_session_expired(expires_at):
        cur.execute('UPDATE user_sessions SET revoked_at = NOW() WHERE id = %s;', (session['id'],))
        log_auth_event(db, 'refresh', 'failed', user_id=session['user_id'], email=session['email'], ip_address=get_client_ip(request), details={'reason': 'expired_token'})
        db.commit()
        raise HTTPException(status_code=401, detail='Refresh token has expired')

    new_refresh_token, refresh_expires_at = create_refresh_token()
    access_token = create_access_token(data={'sub': str(session['user_id'])})
    cur.execute(
        """
        UPDATE user_sessions
        SET token_hash = %s, expires_at = %s, last_used_at = NOW(), revoked_at = NULL
        WHERE id = %s;
        """,
        (hash_token(new_refresh_token), refresh_expires_at, session['id']),
    )
    db.commit()

    log_auth_event(db, 'refresh', 'success', user_id=session['user_id'], email=session['email'], ip_address=get_client_ip(request))
    db.commit()

    # The full profile is re-read rather than assembled from the session join, so a
    # refresh cannot return a user that is missing fields the client depends on.
    return build_auth_payload(db, session['user_id'], access_token, new_refresh_token)


@router.post('/auth/logout')
def logout(payload: LogoutRequest, request: Request, db=Depends(get_db)):
    cur = db.cursor()
    refresh_hash = hash_token(payload.refresh_token)
    cur.execute('SELECT id, user_id FROM user_sessions WHERE token_hash = %s LIMIT 1;', (refresh_hash,))
    session = cur.fetchone()
    cur.execute(
        'UPDATE user_sessions SET revoked_at = NOW() WHERE token_hash = %s AND revoked_at IS NULL;',
        (refresh_hash,),
    )
    log_auth_event(
        db,
        'logout',
        'success',
        user_id=session['user_id'] if session else None,
        ip_address=get_client_ip(request),
        details={'session_found': bool(session)},
    )
    db.commit()
    return {'message': 'Logged out successfully'}


@router.post('/auth/forgot-password')
def forgot_password(payload: ForgotPasswordRequest, request: Request, db=Depends(get_db)):
    cur = db.cursor()
    cur.execute('SELECT id, email FROM users WHERE LOWER(email) = LOWER(%s) LIMIT 1;', (payload.email,))
    db_user = cur.fetchone()

    response = {'message': 'If an account exists for this email, a reset token has been created.'}
    if not db_user:
        log_auth_event(db, 'forgot_password', 'ignored', email=payload.email, ip_address=get_client_ip(request), details={'reason': 'user_not_found'})
        db.commit()
        return response

    reset_token, expires_at = create_refresh_token(PASSWORD_RESET_TOKEN_EXPIRE_MINUTES)
    cur.execute(
        """
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE user_id = %s AND used_at IS NULL AND expires_at > NOW();
        """,
        (db_user['id'],),
    )
    cur.execute(
        """
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES (%s, %s, %s);
        """,
        (db_user['id'], hash_token(reset_token), expires_at),
    )
    log_auth_event(db, 'forgot_password', 'success', user_id=db_user['id'], email=db_user['email'], ip_address=get_client_ip(request))
    db.commit()

    if IS_DEVELOPMENT:
        response['reset_token'] = reset_token
        response['expires_at'] = expires_at.isoformat()
    return response


@router.post('/auth/reset-password')
def reset_password(payload: ResetPasswordRequest, request: Request, db=Depends(get_db)):
    validate_password_strength(payload.new_password)
    cur = db.cursor()
    cur.execute(
        """
        SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at, u.email
        FROM password_reset_tokens prt
        JOIN users u ON u.id = prt.user_id
        WHERE prt.token_hash = %s
        LIMIT 1;
        """,
        (hash_token(payload.reset_token),),
    )
    reset_row = cur.fetchone()

    if not reset_row:
        log_auth_event(db, 'reset_password', 'failed', ip_address=get_client_ip(request), details={'reason': 'invalid_token'})
        db.commit()
        raise HTTPException(status_code=400, detail='Invalid reset token')

    if reset_row['used_at'] is not None:
        log_auth_event(db, 'reset_password', 'failed', user_id=reset_row['user_id'], email=reset_row['email'], ip_address=get_client_ip(request), details={'reason': 'used_token'})
        db.commit()
        raise HTTPException(status_code=400, detail='Reset token has already been used')

    if is_session_expired(reset_row['expires_at']):
        cur.execute('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = %s;', (reset_row['id'],))
        log_auth_event(db, 'reset_password', 'failed', user_id=reset_row['user_id'], email=reset_row['email'], ip_address=get_client_ip(request), details={'reason': 'expired_token'})
        db.commit()
        raise HTTPException(status_code=400, detail='Reset token has expired')

    cur.execute('UPDATE users SET password_hash = %s WHERE id = %s;', (pwd_context.hash(payload.new_password), reset_row['user_id']))
    cur.execute('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = %s;', (reset_row['id'],))
    cur.execute('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = %s AND revoked_at IS NULL;', (reset_row['user_id'],))
    log_auth_event(db, 'reset_password', 'success', user_id=reset_row['user_id'], email=reset_row['email'], ip_address=get_client_ip(request))
    db.commit()

    return {'message': 'Password reset successfully. Please log in again.'}


@router.get('/auth/me')
def get_profile(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    ensure_user_roles(db)
    user = load_user_profile(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail='User not found')
    return user


@router.get('/auth/security-log')
def get_security_log(
    limit: int = Query(20, ge=1, le=100),
    user_id: str = Depends(get_current_user_id),
    db=Depends(get_db),
):
    cur = db.cursor()
    cur.execute('SELECT email FROM users WHERE id = %s LIMIT 1;', (user_id,))
    user_row = cur.fetchone()
    if not user_row:
        raise HTTPException(status_code=404, detail='User not found')

    cur.execute(
        '''
        SELECT id, event_type, status, ip_address, details, created_at
        FROM auth_audit_logs
        WHERE user_id = %s OR LOWER(email) = LOWER(%s)
        ORDER BY created_at DESC
        LIMIT %s;
        ''',
        (user_id, user_row['email'], limit),
    )
    return [serialize_auth_log(row) for row in cur.fetchall()]


@router.patch('/auth/me')
def update_profile(
    request: Request,
    username: str | None = Body(None),
    email: EmailStr | None = Body(None),
    current_password: str | None = Body(None),
    new_password: str | None = Body(None),
    theme_mode: str | None = Body(None),
    dismissed_alerts: list[str] | None = Body(None),
    currency: str | None = Body(None),
    distance_unit: str | None = Body(None),
    volume_unit: str | None = Body(None),
    onboarding_complete: bool | None = Body(None),
    user_id: str = Depends(get_current_user_id),
    db=Depends(get_db),
):
    ensure_user_roles(db)
    cur = db.cursor()

    if username or email or new_password:
        if not current_password:
            raise HTTPException(status_code=400, detail='Current password required for this change')
        cur.execute('SELECT password_hash FROM users WHERE id = %s;', (user_id,))
        user_db = cur.fetchone()
        if not user_db or not pwd_context.verify(current_password, user_db['password_hash']):
            raise HTTPException(status_code=401, detail='Invalid current password')

    if new_password:
        validate_password_strength(new_password)

    updates = []
    values = []

    if username:
        updates.append('username = %s')
        values.append(username)
    if email:
        updates.append('email = %s')
        values.append(email)
    if new_password:
        updates.append('password_hash = %s')
        values.append(pwd_context.hash(new_password))
    if theme_mode and column_exists(db, 'users', 'theme_mode'):
        updates.append('theme_mode = %s')
        values.append(theme_mode)

    # A full replace rather than an append: the client sends the pruned list, so ids
    # for situations that no longer exist drop out instead of accumulating forever.
    if dismissed_alerts is not None and column_exists(db, 'users', 'dismissed_alerts'):
        updates.append('dismissed_alerts = %s')
        values.append(Json(dismissed_alerts))

    # Distance and volume are display conversions over canonical storage. Currency is
    # only a label: switching it does not restate past entries, because that would need
    # the exchange rate on each original date.
    if currency is not None and column_exists(db, 'users', 'currency'):
        if currency not in CURRENCY_CODES:
            raise HTTPException(status_code=400, detail=f'Unsupported currency: {currency}')
        updates.append('currency = %s')
        values.append(currency)

    if distance_unit is not None and column_exists(db, 'users', 'distance_unit'):
        if distance_unit not in DISTANCE_UNITS:
            raise HTTPException(status_code=400, detail=f'Unsupported distance unit: {distance_unit}')
        updates.append('distance_unit = %s')
        values.append(distance_unit)

    if volume_unit is not None and column_exists(db, 'users', 'volume_unit'):
        if volume_unit not in VOLUME_UNITS:
            raise HTTPException(status_code=400, detail=f'Unsupported volume unit: {volume_unit}')
        updates.append('volume_unit = %s')
        values.append(volume_unit)

    # Skipping sets this too. The flag means "we have asked", not "they answered".
    if onboarding_complete and column_exists(db, 'users', 'onboarded_at'):
        updates.append('onboarded_at = NOW()')

    if not updates:
        return {'message': 'No changes requested'}

    values.append(user_id)
    query = f"UPDATE users SET {', '.join(updates)} WHERE id = %s"

    try:
        cur.execute(query, tuple(values))
        changed_fields = []
        if username:
            changed_fields.append('username')
        if email:
            changed_fields.append('email')
        if new_password:
            changed_fields.append('password')
        if theme_mode and column_exists(db, 'users', 'theme_mode'):
            changed_fields.append('theme_mode')
        if dismissed_alerts is not None and column_exists(db, 'users', 'dismissed_alerts'):
            changed_fields.append('dismissed_alerts')
        for name, value in (('currency', currency), ('distance_unit', distance_unit), ('volume_unit', volume_unit)):
            if value is not None and column_exists(db, 'users', name):
                changed_fields.append(name)
        log_auth_event(db, 'profile_update', 'success', user_id=user_id, email=email, ip_address=get_client_ip(request), details={'fields': changed_fields})
        db.commit()
        return {'message': 'Profile updated successfully'}
    except psycopg2.IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail='Username or email already exists')
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))

@router.get('/settings/units')
def get_unit_options():
    """The choices offered in settings, so the client does not keep its own copy."""
    return {
        'currencies': SUPPORTED_CURRENCIES,
        'distance_units': [{'value': k, **v} for k, v in DISTANCE_UNITS.items()],
        'volume_units': [{'value': k, **v} for k, v in VOLUME_UNITS.items()],
    }
