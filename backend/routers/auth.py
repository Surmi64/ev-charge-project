import json
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import EmailStr
import psycopg2
from psycopg2.extras import Json

try:
    from backend.account_lifecycle import (
        DELETION_GRACE_DAYS, TERMS_VERSION, notify, send_password_reset, start_email_verification,
    )
    from backend.auth_rate_limit import check_login_rate_limit, clear_login_failures, enforce, register_login_failure
    from backend.auth_utils import (
        create_access_token,
        create_refresh_token,
        get_current_session_id,
        get_current_user_id,
        hash_token,
        pwd_context,
        validate_password_strength,
    )
    from backend.climate import ZONES as CLIMATE_ZONES, zone_options
    from backend.config import BOOTSTRAP_ADMIN_EMAIL, CURRENCY_CODES, DEFAULT_THEME_PALETTE, DISTANCE_UNITS, THEME_PALETTES, SUPPORTED_CURRENCIES, VOLUME_UNITS, IS_DEVELOPMENT, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
    from backend.db import column_exists, get_db, table_exists
    from backend.site_settings import get_site_settings
    from backend.billing import get_own_db
    from backend.schemas import (
        AccountDeletionRequest, ForgotPasswordRequest, LogoutRequest, RefreshTokenRequest, ResetPasswordRequest,
        UserLogin, UserRegister, VerifyEmailRequest,
    )
except ModuleNotFoundError:
    from account_lifecycle import DELETION_GRACE_DAYS, TERMS_VERSION, notify, send_password_reset, start_email_verification
    from auth_rate_limit import check_login_rate_limit, clear_login_failures, enforce, register_login_failure
    from climate import ZONES as CLIMATE_ZONES, zone_options
    from auth_utils import create_access_token, create_refresh_token, get_current_session_id, get_current_user_id, hash_token, pwd_context, validate_password_strength
    from config import BOOTSTRAP_ADMIN_EMAIL, CURRENCY_CODES, DEFAULT_THEME_PALETTE, DISTANCE_UNITS, THEME_PALETTES, SUPPORTED_CURRENCIES, VOLUME_UNITS, IS_DEVELOPMENT, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
    from db import column_exists, get_db, table_exists
    from site_settings import get_site_settings
    from billing import get_own_db
    from schemas import (
        AccountDeletionRequest, ForgotPasswordRequest, LogoutRequest, RefreshTokenRequest, ResetPasswordRequest,
        UserLogin, UserRegister, VerifyEmailRequest,
    )

router = APIRouter(tags=['auth'])

ALLOWED_USER_ROLES = {'admin', 'user'}


def get_client_ip(request: Request | None):
    """The caller's address as the frontend proxy saw it.

    The API is only reachable through that proxy (it binds to loopback in deployment),
    which sets X-Real-IP from the address it resolved itself. The connection's own peer
    is the proxy container, the same for everyone.
    """
    if not request:
        return None
    forwarded = (request.headers.get('x-real-ip') or '').strip()
    if forwarded:
        return forwarded[:64]
    return request.client.host if request.client else None


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
    if column_exists(db, 'users', 'theme_palette'):
        columns.append('theme_palette')
    if column_exists(db, 'users', 'dismissed_alerts'):
        columns.append('dismissed_alerts')
    for preference in ('currency', 'distance_unit', 'volume_unit', 'climate_zone',
                       'reference_consumption_l_100km', 'reference_fuel_price',
                       'fuel_comparison_enabled', 'cost_per_km_includes_expenses', 'onboarded_at',
                       'email_verified_at', 'deletion_scheduled_for'):
        if column_exists(db, 'users', preference):
            columns.append(preference)

    cur.execute(f"SELECT {', '.join(columns)} FROM users WHERE id = %s;", (user_id,))
    user = cur.fetchone()
    if not user:
        return None

    user.setdefault('theme_mode', 'dark')
    user.setdefault('theme_palette', DEFAULT_THEME_PALETTE)
    user.setdefault('role', 'user')
    user.setdefault('dismissed_alerts', [])
    user.setdefault('currency', 'EUR')
    user.setdefault('distance_unit', 'km')
    user.setdefault('volume_unit', 'l')
    # Left as None rather than defaulted: the client has to be able to tell an account
    # that answered "temperate continental" from one that was never asked.
    user.setdefault('climate_zone', None)
    # Left as None on purpose: "not answered" has to stay distinguishable from a real
    # figure, because an unanswered fuel price means the comparison is not drawn at all.
    for reference in ('reference_consumption_l_100km', 'reference_fuel_price'):
        value = user.get(reference)
        user[reference] = float(value) if value is not None else None
    user.setdefault('fuel_comparison_enabled', True)
    user.setdefault('cost_per_km_includes_expenses', False)
    user['onboarded_at'] = user['onboarded_at'].isoformat() if user.get('onboarded_at') else None
    # Unverified and "no deletion pending" both read as None; the client shows a banner
    # for the first only when verification is on, and for the second whenever it is set.
    for stamp in ('email_verified_at', 'deletion_scheduled_for'):
        user[stamp] = user[stamp].isoformat() if user.get(stamp) else None
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


def create_session_tokens(db, db_user: dict, request: Request | None = None):
    refresh_token, refresh_expires_at = create_refresh_token()
    refresh_hash = hash_token(refresh_token)

    cur = db.cursor()
    # Where the session was opened, so the account can recognise it in its session
    # list. Stored only for that list; the security log keeps its own copy of the IP.
    user_agent = (request.headers.get('user-agent') or '')[:255] if request else None
    if column_exists(db, 'user_sessions', 'user_agent'):
        cur.execute(
            """
            INSERT INTO user_sessions (user_id, token_hash, expires_at, last_used_at, user_agent, ip_address)
            VALUES (%s, %s, %s, NOW(), %s, %s)
            RETURNING id;
            """,
            (db_user['id'], refresh_hash, refresh_expires_at, user_agent, get_client_ip(request)),
        )
    else:
        cur.execute(
            """
            INSERT INTO user_sessions (user_id, token_hash, expires_at, last_used_at)
            VALUES (%s, %s, %s, NOW())
            RETURNING id;
            """,
            (db_user['id'], refresh_hash, refresh_expires_at),
        )
    session_id = cur.fetchone()['id']
    db.commit()
    access_token = create_access_token(data={'sub': str(db_user['id']), 'sid': session_id})
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

    # Per address: a sign-up form is the cheapest thing on the site to script.
    enforce(db, f'register:ip:{get_client_ip(request)}', 10, 3600, 'Too many sign-ups from this network. Try again in an hour.')
    if not user.terms_accepted:
        raise HTTPException(status_code=400, detail='Please accept the terms and the privacy notice to create an account.')

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
        if column_exists(db, 'users', 'terms_accepted_at'):
            cur.execute(
                'UPDATE users SET terms_accepted_at = NOW(), terms_version = %s WHERE id = %s;',
                (TERMS_VERSION, user_id),
            )
            start_email_verification(cur, user_id, user.email)
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
    check_login_rate_limit(db, user.email, get_client_ip(request))
    ensure_user_roles(db)
    cur = db.cursor()
    cur.execute('SELECT * FROM users WHERE LOWER(email) = LOWER(%s);', (user.email,))
    db_user = cur.fetchone()

    if not db_user or not pwd_context.verify(user.password, db_user['password_hash']):
        register_login_failure(db, user.email, get_client_ip(request))
        log_auth_event(db, 'login', 'failed', email=user.email, ip_address=get_client_ip(request), details={'reason': 'invalid_credentials'})
        db.commit()
        raise HTTPException(status_code=401, detail='Invalid email or password')

    clear_login_failures(db, user.email)

    if column_exists(db, 'users', 'last_login_at'):
        cur.execute('UPDATE users SET last_login_at = NOW() WHERE id = %s;', (db_user['id'],))
        db.commit()

    payload = create_session_tokens(db, db_user, request)
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
    access_token = create_access_token(data={'sub': str(session['user_id']), 'sid': session['id']})
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
    too_many = 'Too many reset requests. Try again later.'
    enforce(db, f'forgot:email:{str(payload.email).lower()}', 5, 3600, too_many)
    enforce(db, f'forgot:ip:{get_client_ip(request)}', 20, 3600, too_many)
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
    send_password_reset(cur, db_user['id'], db_user['email'], reset_token, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES)
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
    notify(cur, reset_row['user_id'], reset_row['email'], 'Your Mileage password was changed', [
        'The password of your Mileage account was just reset, and every device was signed out.',
        'If this was not you, reset it again straight away and reply to this message.',
    ])
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
        WHERE (user_id = %s OR LOWER(email) = LOWER(%s))
          -- Token refreshes run every few minutes in an open tab and buried the
          -- sign-ins and password changes this list exists to show.
          AND event_type <> 'refresh'
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
    theme_palette: str | None = Body(None),
    dismissed_alerts: list[str] | None = Body(None),
    currency: str | None = Body(None),
    distance_unit: str | None = Body(None),
    volume_unit: str | None = Body(None),
    climate_zone: str | None = Body(None),
    reference_consumption_l_100km: float | None = Body(None),
    reference_fuel_price: float | None = Body(None),
    fuel_comparison_enabled: bool | None = Body(None),
    cost_per_km_includes_expenses: bool | None = Body(None),
    onboarding_complete: bool | None = Body(None),
    user_id: str = Depends(get_current_user_id),
    db=Depends(get_db),
):
    ensure_user_roles(db)
    cur = db.cursor()

    # The email is where a reset link goes and the password is the password, so
    # both need proof of the current one. The display name does not.
    previous_email = None
    if email or new_password:
        if not current_password:
            raise HTTPException(status_code=400, detail='Current password required for this change')
        cur.execute('SELECT password_hash, email FROM users WHERE id = %s;', (user_id,))
        user_db = cur.fetchone()
        previous_email = user_db['email'] if user_db else None
        if not user_db or not pwd_context.verify(current_password, user_db['password_hash']):
            raise HTTPException(status_code=401, detail='Invalid current password')

    if new_password:
        validate_password_strength(new_password)

    updates = []
    values = []

    if username:
        updates.append('username = %s')
        values.append(username)
    email_changed = bool(email) and (previous_email or '').lower() != str(email).lower()
    if email:
        updates.append('email = %s')
        values.append(email)
        # A new address is unproven until its own link is clicked.
        if email_changed and column_exists(db, 'users', 'email_verified_at'):
            updates.append('email_verified_at = NULL')
    if new_password:
        updates.append('password_hash = %s')
        values.append(pwd_context.hash(new_password))
    if theme_mode and column_exists(db, 'users', 'theme_mode'):
        updates.append('theme_mode = %s')
        values.append(theme_mode)

    # Rejected rather than stored as given: the client falls back to the default when
    # it reads an id it does not know, so an accepted typo would look like the setting
    # silently refusing to take.
    if theme_palette and column_exists(db, 'users', 'theme_palette'):
        if theme_palette not in THEME_PALETTES:
            raise HTTPException(status_code=400, detail=f'Unknown theme palette: {theme_palette}')
        updates.append('theme_palette = %s')
        values.append(theme_palette)

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

    # Rejected rather than silently defaulted: an unrecognised zone stored here would
    # read back as "answered" while forecasting on the fallback curve, which is exactly
    # the confusion the nullable column exists to avoid.
    if climate_zone is not None and column_exists(db, 'users', 'climate_zone'):
        if climate_zone not in CLIMATE_ZONES:
            raise HTTPException(status_code=400, detail=f'Unsupported climate zone: {climate_zone}')
        updates.append('climate_zone = %s')
        values.append(climate_zone)

    # Bounds mirror the CHECK constraints rather than trusting them to produce a usable
    # error: a violated constraint surfaces as a 500, and these are user-entered numbers.
    if reference_consumption_l_100km is not None and column_exists(db, 'users', 'reference_consumption_l_100km'):
        if not 1 <= reference_consumption_l_100km <= 50:
            raise HTTPException(status_code=400, detail='Reference consumption must be between 1 and 50 l/100 km')
        updates.append('reference_consumption_l_100km = %s')
        values.append(reference_consumption_l_100km)

    if reference_fuel_price is not None and column_exists(db, 'users', 'reference_fuel_price'):
        if reference_fuel_price <= 0:
            raise HTTPException(status_code=400, detail='Fuel price must be greater than zero')
        updates.append('reference_fuel_price = %s')
        values.append(reference_fuel_price)

    if fuel_comparison_enabled is not None and column_exists(db, 'users', 'fuel_comparison_enabled'):
        updates.append('fuel_comparison_enabled = %s')
        values.append(fuel_comparison_enabled)

    if cost_per_km_includes_expenses is not None and column_exists(db, 'users', 'cost_per_km_includes_expenses'):
        updates.append('cost_per_km_includes_expenses = %s')
        values.append(cost_per_km_includes_expenses)

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
        if theme_palette and column_exists(db, 'users', 'theme_palette'):
            changed_fields.append('theme_palette')
        if dismissed_alerts is not None and column_exists(db, 'users', 'dismissed_alerts'):
            changed_fields.append('dismissed_alerts')
        for name, value in (('currency', currency), ('distance_unit', distance_unit), ('volume_unit', volume_unit), ('climate_zone', climate_zone),
                            ('reference_consumption_l_100km', reference_consumption_l_100km),
                            ('reference_fuel_price', reference_fuel_price),
                            ('fuel_comparison_enabled', fuel_comparison_enabled),
                            ('cost_per_km_includes_expenses', cost_per_km_includes_expenses)):
            if value is not None and column_exists(db, 'users', name):
                changed_fields.append(name)
        if email_changed and column_exists(db, 'users', 'terms_accepted_at'):
            start_email_verification(cur, user_id, str(email))
            notify(cur, user_id, previous_email, 'Your Mileage email address was changed', [
                f'The sign-in address of your Mileage account was changed to {email}.',
                'If this was not you, reset your password straight away and reply to this message.',
            ])
        elif new_password and previous_email and column_exists(db, 'users', 'terms_accepted_at'):
            notify(cur, user_id, previous_email, 'Your Mileage password was changed', [
                'The password of your Mileage account was just changed from the account page.',
                'If this was not you, reset it straight away and reply to this message.',
            ])
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
        # Not a unit, but it belongs to the same settings screen and the same rule: the
        # client should not carry its own copy of a list the backend computes from.
        'climate_zones': zone_options(),
    }


# --- email verification ----------------------------------------------------------------------

@router.post('/auth/verify-email')
def verify_email(payload: VerifyEmailRequest, request: Request, db=Depends(get_db)):
    """Mark an address proven. Only the address the link was issued for: a link sent
    before the account changed its email again proves nothing about the new one."""
    cur = db.cursor()
    cur.execute(
        """
        SELECT t.id, t.user_id, t.email, t.expires_at, t.used_at, u.email AS current_email
        FROM email_verification_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = %s;
        """,
        (hash_token(payload.token),),
    )
    row = cur.fetchone()
    invalid = 'This confirmation link is no longer valid. Sign in and send a new one from your account.'
    if not row or row['used_at'] is not None or is_session_expired(row['expires_at']):
        raise HTTPException(status_code=400, detail=invalid)
    if row['email'].lower() != (row['current_email'] or '').lower():
        cur.execute('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = %s;', (row['id'],))
        db.commit()
        raise HTTPException(status_code=400, detail=invalid)
    cur.execute('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = %s;', (row['id'],))
    cur.execute('UPDATE users SET email_verified_at = NOW() WHERE id = %s;', (row['user_id'],))
    log_auth_event(db, 'verify_email', 'success', user_id=row['user_id'], email=row['email'], ip_address=get_client_ip(request))
    db.commit()
    return {'message': 'Email address confirmed', 'email': row['email']}


@router.post('/auth/verify-email/resend')
def resend_verification(request: Request, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    enforce(db, f'verify-resend:user:{user_id}', 1, 60, 'A confirmation was just sent. Try again in a minute.')
    enforce(db, f'verify-resend-day:user:{user_id}', 5, 86400, 'Too many confirmation emails today. Try again tomorrow.')
    cur = db.cursor()
    cur.execute('SELECT email, email_verified_at FROM users WHERE id = %s;', (user_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail='User not found')
    if row['email_verified_at'] is not None:
        return {'message': 'This address is already confirmed'}
    start_email_verification(cur, user_id, row['email'])
    db.commit()
    return {'message': f"Confirmation sent to {row['email']}"}


# --- sessions --------------------------------------------------------------------------------

@router.get('/auth/sessions')
def list_sessions(user_id: str = Depends(get_current_user_id), session_id: int | None = Depends(get_current_session_id),
                  db=Depends(get_db)):
    """Where the account is signed in: every refresh session not revoked or expired."""
    cur = db.cursor()
    device = ', user_agent, ip_address' if column_exists(db, 'user_sessions', 'user_agent') else ''
    cur.execute(
        f"""
        SELECT id, created_at, last_used_at, expires_at{device}
        FROM user_sessions
        WHERE user_id = %s AND revoked_at IS NULL AND expires_at > NOW()
        ORDER BY COALESCE(last_used_at, created_at) DESC;
        """,
        (user_id,),
    )
    return [
        {
            'id': row['id'],
            'created_at': row['created_at'].isoformat() if row.get('created_at') else None,
            'last_used_at': row['last_used_at'].isoformat() if row.get('last_used_at') else None,
            'user_agent': row.get('user_agent'),
            'ip_address': row.get('ip_address'),
            'current': row['id'] == session_id,
        }
        for row in cur.fetchall()
    ]


@router.delete('/auth/sessions/{target_session_id}')
def revoke_session(target_session_id: int, request: Request, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    cur.execute(
        'UPDATE user_sessions SET revoked_at = NOW() WHERE id = %s AND user_id = %s AND revoked_at IS NULL;',
        (target_session_id, user_id),
    )
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail='Session not found')
    log_auth_event(db, 'revoke_session', 'success', user_id=user_id, ip_address=get_client_ip(request),
                   details={'session_id': target_session_id})
    db.commit()
    return {'message': 'Signed out of that device'}


@router.post('/auth/sessions/revoke-others')
def revoke_other_sessions(request: Request, user_id: str = Depends(get_current_user_id),
                          session_id: int | None = Depends(get_current_session_id), db=Depends(get_db)):
    if session_id is None:
        raise HTTPException(status_code=400, detail='Sign in again first, so this device can be told apart from the others.')
    cur = db.cursor()
    cur.execute(
        'UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = %s AND id <> %s AND revoked_at IS NULL;',
        (user_id, session_id),
    )
    count = cur.rowcount
    log_auth_event(db, 'revoke_other_sessions', 'success', user_id=user_id, ip_address=get_client_ip(request),
                   details={'count': count})
    db.commit()
    return {'message': f"Signed out of {count} other device{'' if count == 1 else 's'}", 'count': count}


# --- data export and deletion ----------------------------------------------------------------

def _export_value(value):
    """JSON for what psycopg2 hands back: numerics as numbers, timestamps as ISO text."""
    if isinstance(value, Decimal):
        return float(value)
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    return str(value)


@router.get('/auth/export')
def export_account(user_id: str = Depends(get_current_user_id), db=Depends(get_own_db)):
    """Everything the account holds, as one JSON document — the GDPR copy of the data.

    Never gated on the subscription, like the CSV export: a lapsed account keeps the
    right to its own records. Secrets (password hash, token hashes) are left out.
    """
    cur = db.cursor()
    profile = load_user_profile(db, user_id)
    tables = {
        'vehicles': 'SELECT * FROM vehicles WHERE user_id = %s ORDER BY id;',
        'charging_sessions': 'SELECT * FROM charging_sessions WHERE user_id = %s ORDER BY start_time, id;',
        'expenses': 'SELECT * FROM expenses WHERE user_id = %s ORDER BY date, id;',
        'recurring_expense_reminders': 'SELECT * FROM recurring_expense_reminders WHERE user_id = %s ORDER BY id;',
        'places': 'SELECT * FROM places WHERE user_id = %s ORDER BY id;',
        'notification_recipients': 'SELECT id, email, mode, vehicle_ids, confirmed_at, created_at FROM notification_recipients WHERE user_id = %s ORDER BY id;',
        'feedback': 'SELECT id, kind, status, subject, body, created_at FROM feedback WHERE user_id = %s ORDER BY id;',
        'subscription': 'SELECT plan, status, trial_ends_at, current_period_start, current_period_end, created_at FROM subscriptions WHERE user_id = %s;',
    }
    data = {'exported_at': datetime.now(timezone.utc).isoformat(), 'profile': profile}
    for name, query in tables.items():
        table = query.split(' FROM ')[1].split()[0]
        if table_exists(db, table):
            cur.execute(query, (user_id,))
            data[name] = [dict(row) for row in cur.fetchall()]
    return JSONResponse(
        content=json.loads(json.dumps(data, default=_export_value)),
        headers={'Content-Disposition': 'attachment; filename="mileage-export.json"'},
    )


@router.post('/auth/delete-account')
def schedule_account_deletion(payload: AccountDeletionRequest, request: Request, user_id: str = Depends(get_current_user_id),
                              db=Depends(get_db)):
    """Delete the account after a grace period, signing every device out now.

    Thirty days rather than at once: a mistake, or a session someone else got hold of,
    stays recoverable — signing in and cancelling is enough. After that the worker
    removes the account and everything under it.
    """
    cur = db.cursor()
    cur.execute('SELECT email, password_hash, role FROM users WHERE id = %s;', (user_id,))
    row = cur.fetchone()
    if not row or not pwd_context.verify(payload.password, row['password_hash']):
        raise HTTPException(status_code=401, detail='Invalid password')
    if row['role'] == 'admin':
        raise HTTPException(status_code=400, detail='An admin account cannot delete itself. Hand the role to someone else first.')
    cur.execute(
        "UPDATE users SET deletion_scheduled_for = NOW() + make_interval(days => %s) WHERE id = %s RETURNING deletion_scheduled_for;",
        (DELETION_GRACE_DAYS, user_id),
    )
    when = cur.fetchone()['deletion_scheduled_for']
    cur.execute('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = %s AND revoked_at IS NULL;', (user_id,))
    notify(cur, user_id, row['email'], 'Your Mileage account will be deleted', [
        f'Your account and all its records will be deleted on {when.date().isoformat()}.',
        'Changed your mind? Sign in before then and cancel the deletion from the banner at the top.',
    ])
    log_auth_event(db, 'delete_account', 'scheduled', user_id=user_id, email=row['email'], ip_address=get_client_ip(request),
                   details={'scheduled_for': when.isoformat()})
    db.commit()
    return {'message': 'Account scheduled for deletion', 'deletion_scheduled_for': when.isoformat()}


@router.post('/auth/cancel-deletion')
def cancel_account_deletion(request: Request, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    cur.execute(
        'UPDATE users SET deletion_scheduled_for = NULL WHERE id = %s AND deletion_scheduled_for IS NOT NULL RETURNING email;',
        (user_id,),
    )
    row = cur.fetchone()
    if not row:
        return {'message': 'No deletion was scheduled'}
    notify(cur, user_id, row['email'], 'Your Mileage account will not be deleted', [
        'The scheduled deletion of your account was cancelled. Everything stays as it was.',
    ])
    log_auth_event(db, 'delete_account', 'cancelled', user_id=user_id, email=row['email'], ip_address=get_client_ip(request))
    db.commit()
    return {'message': 'Deletion cancelled'}
