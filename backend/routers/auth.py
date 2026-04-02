from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
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
    from backend.config import IS_DEVELOPMENT, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
    from backend.db import column_exists, get_db, table_exists
    from backend.schemas import ForgotPasswordRequest, LogoutRequest, RefreshTokenRequest, ResetPasswordRequest, UserLogin, UserRegister
except ModuleNotFoundError:
    from auth_rate_limit import check_login_rate_limit, clear_login_failures, register_login_failure
    from auth_utils import create_access_token, create_refresh_token, get_current_user_id, hash_token, pwd_context, validate_password_strength
    from config import IS_DEVELOPMENT, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
    from db import column_exists, get_db, table_exists
    from schemas import ForgotPasswordRequest, LogoutRequest, RefreshTokenRequest, ResetPasswordRequest, UserLogin, UserRegister

router = APIRouter(tags=['auth'])

ALLOWED_USER_ROLES = {'admin', 'user'}


def get_client_ip(request: Request | None):
    if not request or not request.client:
        return None
    return request.client.host


def ensure_user_roles(db):
    if column_exists(db, 'users', 'role'):
        cur = db.cursor()
        cur.execute("UPDATE users SET role = 'admin' WHERE LOWER(email) = LOWER(%s);", ('surmi64@gmail.com',))
        db.commit()
        return

    cur = db.cursor()
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';")
    cur.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'users_role_chk'
            ) THEN
                ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN ('admin', 'user'));
            END IF;
        END $$;
        """
    )
    cur.execute("UPDATE users SET role = 'admin' WHERE LOWER(email) = LOWER(%s);", ('surmi64@gmail.com',))
    db.commit()


def ensure_user_sessions_table(db):
    if table_exists(db, 'user_sessions'):
        return

    cur = db.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS user_sessions (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash VARCHAR(255) NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            last_used_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    cur.execute('CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_token_hash_uidx ON user_sessions (token_hash);')
    cur.execute('CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);')
    db.commit()


def ensure_auth_audit_logs_table(db):
    if table_exists(db, 'auth_audit_logs'):
        return

    cur = db.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_audit_logs (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
            email VARCHAR(255),
            event_type VARCHAR(50) NOT NULL,
            status VARCHAR(20) NOT NULL,
            ip_address VARCHAR(64),
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    cur.execute('CREATE INDEX IF NOT EXISTS auth_audit_logs_user_id_idx ON auth_audit_logs (user_id, created_at DESC);')
    cur.execute('CREATE INDEX IF NOT EXISTS auth_audit_logs_event_type_idx ON auth_audit_logs (event_type, created_at DESC);')
    db.commit()


def ensure_password_reset_tokens_table(db):
    if table_exists(db, 'password_reset_tokens'):
        return

    cur = db.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash VARCHAR(255) NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    cur.execute('CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_token_hash_uidx ON password_reset_tokens (token_hash);')
    cur.execute('CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens (user_id, created_at DESC);')
    db.commit()


def log_auth_event(db, event_type: str, status: str, user_id=None, email=None, ip_address=None, details=None):
    ensure_auth_audit_logs_table(db)
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


def build_auth_payload(db_user: dict, access_token: str, refresh_token: str):
    return {
        'access_token': access_token,
        'refresh_token': refresh_token,
        'token_type': 'bearer',
        'user': {'id': db_user['id'], 'username': db_user['username'], 'email': db_user['email'], 'role': db_user.get('role', 'user')},
    }


def create_session_tokens(db, db_user: dict):
    ensure_user_sessions_table(db)
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
    return build_auth_payload(db_user, access_token, refresh_token)


def is_session_expired(expires_at):
    if not expires_at:
        return True
    if getattr(expires_at, 'tzinfo', None):
        return expires_at <= datetime.now(timezone.utc)
    return expires_at <= datetime.utcnow()


@router.post('/auth/register', status_code=201)
def register(user: UserRegister, request: Request, db=Depends(get_db)):
    ensure_user_roles(db)
    validate_password_strength(user.password)
    pwd_hash = pwd_context.hash(user.password)
    cur = db.cursor()
    try:
        cur.execute(
            'INSERT INTO users (username, email, password_hash, role) VALUES (%s, %s, %s, %s) RETURNING id;',
            (user.username, user.email, pwd_hash, 'admin' if user.email.lower() == 'surmi64@gmail.com' else 'user'),
        )
        user_id = cur.fetchone()['id']
        db.commit()
        log_auth_event(db, 'register', 'success', user_id=user_id, email=user.email, ip_address=get_client_ip(request))
        db.commit()
        return {'message': 'User registered successfully', 'user_id': user_id}
    except psycopg2.IntegrityError:
        db.rollback()
        log_auth_event(db, 'register', 'failed', email=user.email, ip_address=get_client_ip(request), details={'reason': 'duplicate_user'})
        db.commit()
        raise HTTPException(status_code=409, detail='Username or email already exists')
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post('/auth/login')
def login(user: UserLogin, request: Request, db=Depends(get_db)):
    check_login_rate_limit(user.email)
    ensure_user_roles(db)
    ensure_user_sessions_table(db)
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
    ensure_user_sessions_table(db)
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

    return build_auth_payload(
        {'id': session['user_id'], 'username': session['username'], 'email': session['email']},
        access_token,
        new_refresh_token,
    )


@router.post('/auth/logout')
def logout(payload: LogoutRequest, request: Request, db=Depends(get_db)):
    ensure_user_sessions_table(db)
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
    ensure_password_reset_tokens_table(db)
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
    ensure_password_reset_tokens_table(db)
    ensure_user_sessions_table(db)
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
    cur = db.cursor()
    if column_exists(db, 'users', 'theme_mode'):
        cur.execute('SELECT id, username, email, role, created_at, theme_mode FROM users WHERE id = %s;', (user_id,))
    else:
        cur.execute('SELECT id, username, email, role, created_at FROM users WHERE id = %s;', (user_id,))
    user = cur.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail='User not found')
    user.setdefault('theme_mode', 'dark')
    user.setdefault('role', 'user')
    return user


@router.get('/auth/security-log')
def get_security_log(
    limit: int = Query(20, ge=1, le=100),
    user_id: str = Depends(get_current_user_id),
    db=Depends(get_db),
):
    ensure_auth_audit_logs_table(db)
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
        log_auth_event(db, 'profile_update', 'success', user_id=user_id, email=email, ip_address=get_client_ip(request), details={'fields': changed_fields})
        db.commit()
        return {'message': 'Profile updated successfully'}
    except psycopg2.IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail='Username or email already exists')
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))