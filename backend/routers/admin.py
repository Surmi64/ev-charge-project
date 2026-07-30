from fastapi import APIRouter, Depends, HTTPException, Request

try:
    from backend.auth_utils import create_refresh_token, hash_token
    from backend.config import IS_DEVELOPMENT, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
    from backend.auth_utils import get_current_user_id
    from backend.db import column_exists, get_db
    from backend.routers.auth import ensure_user_roles, get_client_ip, log_auth_event
    from backend.schemas import SubscriptionUpdateRequest, UserRoleUpdateRequest
    from backend.billing import serialize_subscription, start_paid_period
    from backend.config import BOOTSTRAP_ADMIN_EMAIL, PLAN_PRICES, TRIAL_DAYS
    from backend.site_settings import SETTING_DEFINITIONS, get_site_settings, save_site_settings
except ModuleNotFoundError:
    from auth_utils import create_refresh_token, hash_token
    from config import IS_DEVELOPMENT, PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
    from auth_utils import get_current_user_id
    from db import column_exists, get_db
    from routers.auth import ensure_user_roles, get_client_ip, log_auth_event
    from schemas import SubscriptionUpdateRequest, UserRoleUpdateRequest
    from billing import serialize_subscription, start_paid_period
    from config import BOOTSTRAP_ADMIN_EMAIL, PLAN_PRICES, TRIAL_DAYS
    from site_settings import SETTING_DEFINITIONS, get_site_settings, save_site_settings

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

    # Admin endpoints never call get_tenant_db, so `app.user_id` stays unset and the
    # row level security policies on vehicles / charging_sessions / expenses /
    # vehicle_events / recurring_expense_reminders match nothing. An admin therefore
    # cannot read another account's records even by writing a query that omits a
    # WHERE clause. `app.admin` only unlocks the subscriptions table, which carries
    # plan state rather than user content.
    cur.execute("SET app.admin = 'on';")
    return user


# The vehicle_events reconciliation endpoint that used to live here has been removed:
# it ran across every tenant's rows, which an admin is no longer permitted to touch.
# Run scripts/reconcile-events.sh against the database instead.


@router.get('/subscriptions')
def list_subscriptions(admin_user=Depends(require_admin_user), db=Depends(get_db)):
    """Plan state per account. Deliberately returns no vehicle or cost data."""
    cur = db.cursor()
    cur.execute(
        """
        SELECT u.id AS user_id, u.username, u.email, u.role,
               s.plan, s.status, s.trial_ends_at, s.current_period_end, s.cancel_at_period_end
        FROM users u
        LEFT JOIN subscriptions s ON s.user_id = u.id
        ORDER BY u.created_at ASC;
        """
    )
    return [
        {
            **row,
            'trial_ends_at': row['trial_ends_at'].isoformat() if row.get('trial_ends_at') else None,
            'current_period_end': row['current_period_end'].isoformat() if row.get('current_period_end') else None,
        }
        for row in cur.fetchall()
    ]


@router.patch('/subscriptions/{target_user_id}')
def update_subscription(
    target_user_id: int,
    payload: SubscriptionUpdateRequest,
    admin_user=Depends(require_admin_user),
    db=Depends(get_db),
):
    """Manual plan control, standing in for a payment provider webhook.

    Once a provider is connected this becomes a support-only override rather than
    the primary way subscriptions change.
    """
    cur = db.cursor()
    cur.execute('SELECT id FROM users WHERE id = %s LIMIT 1;', (target_user_id,))
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail='User not found')

    cur.execute(
        """
        INSERT INTO subscriptions (user_id, plan, status, trial_ends_at)
        VALUES (%s, 'trial', 'trialing', NOW() + make_interval(days => %s))
        ON CONFLICT (user_id) DO NOTHING;
        """,
        (target_user_id, TRIAL_DAYS),
    )

    try:
        if payload.plan in PLAN_PRICES:
            updated = start_paid_period(db, target_user_id, payload.plan)
        else:
            if payload.status not in {'trialing', 'active', 'past_due', 'canceled', 'expired'}:
                raise HTTPException(status_code=400, detail='Unknown subscription status')
            cur.execute(
                'UPDATE subscriptions SET status = %s, updated_at = NOW() WHERE user_id = %s RETURNING *;',
                (payload.status, target_user_id),
            )
            updated = cur.fetchone()
            db.commit()

        log_auth_event(
            db, 'subscription_update', 'success', user_id=admin_user['id'],
            email=admin_user['email'], details={'target_user_id': target_user_id,
                                                'plan': payload.plan, 'status': payload.status},
        )
        db.commit()
        return serialize_subscription(updated)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


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

    if BOOTSTRAP_ADMIN_EMAIL and target_user['email'].lower() == BOOTSTRAP_ADMIN_EMAIL.lower() and next_role != 'admin':
        raise HTTPException(status_code=400, detail='The bootstrap admin account cannot be demoted')

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

@router.get('/site-settings')
def read_site_settings(admin=Depends(require_admin_user), db=Depends(get_db)):
    return {
        'settings': get_site_settings(db),
        # What the deployment would fall back to, so the form can show which values
        # are an admin's choice and which are simply inherited from the environment.
        'defaults': {key: definition['env_default']() for key, definition in SETTING_DEFINITIONS.items()},
    }


@router.patch('/site-settings')
def update_site_settings(payload: dict, request: Request, admin=Depends(require_admin_user), db=Depends(get_db)):
    updates = payload.get('settings') if isinstance(payload.get('settings'), dict) else payload
    if not isinstance(updates, dict) or not updates:
        raise HTTPException(status_code=400, detail='No settings supplied')

    try:
        settings = save_site_settings(db, updates, admin_user_id=admin['id'])
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))

    log_auth_event(
        db, 'site_settings_update', 'success', user_id=admin['id'], email=admin['email'],
        ip_address=get_client_ip(request), details={'keys': sorted(updates.keys())},
    )
    db.commit()
    return {'settings': settings}
