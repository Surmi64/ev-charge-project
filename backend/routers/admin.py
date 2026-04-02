from fastapi import APIRouter, Depends, HTTPException, Request

try:
    from backend.auth_utils import create_refresh_token, hash_token
    from backend.config import IS_DEVELOPMENT, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
    from backend.auth_utils import get_current_user_id
    from backend.db import column_exists, get_db
    from backend.routers.auth import ensure_password_reset_tokens_table, ensure_user_roles, get_client_ip, log_auth_event
    from backend.schemas import UserRoleUpdateRequest
except ModuleNotFoundError:
    from auth_utils import create_refresh_token, hash_token
    from config import IS_DEVELOPMENT, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
    from auth_utils import get_current_user_id
    from db import column_exists, get_db
    from routers.auth import ensure_password_reset_tokens_table, ensure_user_roles, get_client_ip, log_auth_event
    from schemas import UserRoleUpdateRequest

router = APIRouter(prefix='/admin', tags=['admin'])

ALLOWED_USER_ROLES = {'admin', 'user'}


def require_admin_user(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    ensure_user_roles(db)
    cur = db.cursor()
    cur.execute('SELECT id, username, email, role FROM users WHERE id = %s LIMIT 1;', (user_id,))
    user = cur.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail='User not found')
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail='Admin access required')
    return user


@router.get('/users')
def list_users(admin_user=Depends(require_admin_user), db=Depends(get_db)):
    ensure_user_roles(db)
    cur = db.cursor()
    if column_exists(db, 'users', 'last_login_at'):
        cur.execute(
            '''
            SELECT id, username, email, role, created_at, last_login_at
            FROM users
            ORDER BY created_at ASC;
            '''
        )
    else:
        cur.execute(
            '''
            SELECT id, username, email, role, created_at, NULL::timestamptz AS last_login_at
            FROM users
            ORDER BY created_at ASC;
            '''
        )
    return cur.fetchall()


@router.patch('/users/{target_user_id}/role')
def update_user_role(
    target_user_id: int,
    payload: UserRoleUpdateRequest,
    request: Request,
    admin_user=Depends(require_admin_user),
    db=Depends(get_db),
):
    ensure_user_roles(db)
    next_role = payload.role.strip().lower()
    if next_role not in ALLOWED_USER_ROLES:
        raise HTTPException(status_code=400, detail='Unsupported role')

    cur = db.cursor()
    cur.execute('SELECT id, email, role FROM users WHERE id = %s LIMIT 1;', (target_user_id,))
    target_user = cur.fetchone()
    if not target_user:
        raise HTTPException(status_code=404, detail='Target user not found')

    if target_user['email'].lower() == 'surmi64@gmail.com' and next_role != 'admin':
        raise HTTPException(status_code=400, detail='Primary admin role cannot be removed from surmi64@gmail.com')

    if target_user['id'] == admin_user['id'] and next_role != 'admin':
        raise HTTPException(status_code=400, detail='You cannot remove your own admin role')

    cur.execute('UPDATE users SET role = %s WHERE id = %s;', (next_role, target_user_id))
    log_auth_event(
        db,
        'user_role_update',
        'success',
        user_id=admin_user['id'],
        email=admin_user['email'],
        ip_address=get_client_ip(request),
        details={'target_user_id': target_user_id, 'previous_role': target_user['role'], 'new_role': next_role},
    )
    db.commit()
    return {'message': 'User role updated successfully'}


@router.post('/users/{target_user_id}/reset-password-token')
def create_user_reset_token(
    target_user_id: int,
    request: Request,
    admin_user=Depends(require_admin_user),
    db=Depends(get_db),
):
    ensure_user_roles(db)
    ensure_password_reset_tokens_table(db)
    cur = db.cursor()
    cur.execute('SELECT id, email FROM users WHERE id = %s LIMIT 1;', (target_user_id,))
    target_user = cur.fetchone()
    if not target_user:
        raise HTTPException(status_code=404, detail='Target user not found')

    reset_token, expires_at = create_refresh_token(PASSWORD_RESET_TOKEN_EXPIRE_MINUTES)
    cur.execute(
        '''
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE user_id = %s AND used_at IS NULL AND expires_at > NOW();
        ''',
        (target_user['id'],),
    )
    cur.execute(
        '''
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES (%s, %s, %s);
        ''',
        (target_user['id'], hash_token(reset_token), expires_at),
    )
    log_auth_event(
        db,
        'admin_reset_password_token_created',
        'success',
        user_id=admin_user['id'],
        email=admin_user['email'],
        ip_address=get_client_ip(request),
        details={'target_user_id': target_user['id'], 'target_email': target_user['email']},
    )
    db.commit()

    response = {
        'message': 'Password reset token created successfully.',
        'target_user_id': target_user['id'],
        'target_email': target_user['email'],
        'expires_at': expires_at.isoformat(),
    }
    if IS_DEVELOPMENT:
        response['reset_token'] = reset_token
    return response


@router.post('/users/{target_user_id}/revoke-sessions')
def revoke_user_sessions(
    target_user_id: int,
    request: Request,
    admin_user=Depends(require_admin_user),
    db=Depends(get_db),
):
    cur = db.cursor()
    cur.execute('SELECT id, email FROM users WHERE id = %s LIMIT 1;', (target_user_id,))
    target_user = cur.fetchone()
    if not target_user:
        raise HTTPException(status_code=404, detail='Target user not found')

    cur.execute('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = %s AND revoked_at IS NULL;', (target_user_id,))
    revoked_count = cur.rowcount
    log_auth_event(
        db,
        'admin_revoke_sessions',
        'success',
        user_id=admin_user['id'],
        email=admin_user['email'],
        ip_address=get_client_ip(request),
        details={'target_user_id': target_user_id, 'target_email': target_user['email'], 'revoked_sessions': revoked_count},
    )
    db.commit()
    return {'message': 'User sessions revoked successfully', 'revoked_sessions': revoked_count}