"""Subscription state, trial handling and the write gate.

No payment provider is wired up yet: `provider*` columns stay NULL and an admin
flips a subscription to active manually. The gating below is provider-agnostic, so
adding Stripe or Paddle later means filling those columns from a webhook and
leaving the rest of the application untouched.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request

try:
    from backend.auth_utils import get_current_user_id
    from backend.config import PLAN_PRICES, TRIAL_DAYS
    from backend.site_settings import get_site_setting
    from backend.db import get_db, set_tenant, table_exists
except ModuleNotFoundError:
    from auth_utils import get_current_user_id
    from config import PLAN_PRICES, TRIAL_DAYS
    from site_settings import get_site_setting
    from db import get_db, set_tenant, table_exists

# Statuses that may create or modify records. Everything else is read-only, which
# still allows viewing and CSV export so a lapsed user keeps access to their data.
WRITE_ALLOWED_STATUSES = {'trialing', 'active'}

# What an admin account sees in place of its subscription row. Admins run the
# service, so their plan never lapses; nothing is written, so demoting the account
# back to 'user' returns it to whatever its stored row says.
ADMIN_SUBSCRIPTION = {
    'plan': 'admin',
    'status': 'active',
    'trial_ends_at': None,
    'current_period_end': None,
    'cancel_at_period_end': False,
    'exempt': True,
}


def _now():
    return datetime.now(timezone.utc)


def ensure_subscription(db, user_id) -> dict:
    """Return the user's subscription, starting a trial if they have none."""
    cur = db.cursor()
    cur.execute('SELECT role FROM users WHERE id = %s LIMIT 1;', (user_id,))
    user = cur.fetchone()
    if user and user.get('role') == 'admin':
        return dict(ADMIN_SUBSCRIPTION)

    if not table_exists(db, 'subscriptions'):
        # Database predates the billing migration: treat as unrestricted.
        return {
            'plan': 'trial',
            'status': 'trialing',
            'trial_ends_at': None,
            'current_period_end': None,
            'cancel_at_period_end': False,
        }

    cur.execute('SELECT * FROM subscriptions WHERE user_id = %s LIMIT 1;', (user_id,))
    subscription = cur.fetchone()

    if not subscription:
        cur.execute(
            """
            INSERT INTO subscriptions (user_id, plan, status, trial_ends_at)
            VALUES (%s, 'trial', 'trialing', NOW() + make_interval(days => %s))
            ON CONFLICT (user_id) DO NOTHING
            RETURNING *;
            """,
            # Admin-set trial length where one exists, the deployed TRIAL_DAYS
            # otherwise. Read per trial creation rather than cached, so changing it in
            # the admin page applies to the very next sign-up.
            (user_id, get_site_setting(db, 'trial_days')),
        )
        subscription = cur.fetchone()
        db.commit()
        if not subscription:
            cur.execute('SELECT * FROM subscriptions WHERE user_id = %s LIMIT 1;', (user_id,))
            subscription = cur.fetchone()

    return expire_if_elapsed(db, subscription)


def expire_if_elapsed(db, subscription: dict) -> dict:
    """Move a lapsed trial or period into 'expired' the first time we notice."""
    if not subscription or subscription.get('status') not in WRITE_ALLOWED_STATUSES:
        return subscription

    now = _now()
    deadline = (
        subscription.get('trial_ends_at')
        if subscription.get('status') == 'trialing'
        else subscription.get('current_period_end')
    )
    if not deadline or deadline > now:
        return subscription

    cur = db.cursor()
    cur.execute(
        "UPDATE subscriptions SET status = 'expired', updated_at = NOW() WHERE user_id = %s RETURNING *;",
        (subscription['user_id'],),
    )
    updated = cur.fetchone()
    db.commit()
    return updated or subscription


def serialize_subscription(subscription: dict) -> dict:
    status = subscription.get('status', 'trialing')
    now = _now()
    deadline = subscription.get('trial_ends_at') if status == 'trialing' else subscription.get('current_period_end')
    days_remaining = None
    if deadline:
        days_remaining = max(0, (deadline - now).days)

    return {
        'plan': subscription.get('plan'),
        'status': status,
        'trial_ends_at': subscription['trial_ends_at'].isoformat() if subscription.get('trial_ends_at') else None,
        'current_period_end': subscription['current_period_end'].isoformat() if subscription.get('current_period_end') else None,
        'cancel_at_period_end': bool(subscription.get('cancel_at_period_end')),
        'can_write': status in WRITE_ALLOWED_STATUSES,
        'days_remaining': days_remaining,
        'exempt': bool(subscription.get('exempt')),
        'prices': PLAN_PRICES,
    }


def start_paid_period(db, user_id, plan: str) -> dict:
    """Activate a paid plan. Called by the admin endpoint today, by a provider webhook later."""
    if plan not in PLAN_PRICES:
        raise HTTPException(status_code=400, detail=f'Unknown plan: {plan}')

    period = timedelta(days=365) if plan == 'yearly' else timedelta(days=30)
    now = _now()
    cur = db.cursor()
    cur.execute(
        """
        UPDATE subscriptions
        SET plan = %s, status = 'active', current_period_start = %s, current_period_end = %s,
            cancel_at_period_end = FALSE, updated_at = NOW()
        WHERE user_id = %s
        RETURNING *;
        """,
        (plan, now, now + period, user_id),
    )
    updated = cur.fetchone()
    if not updated:
        raise HTTPException(status_code=404, detail='Subscription not found')
    db.commit()
    return updated


# The workspace a request acts in. Absent, or the caller's own id, means their own
# account; another id means that account's fleet, which the caller must belong to.
WORKSPACE_HEADER = 'X-Mileage-Workspace'
FLEET_MANAGING_ROLES = {'owner', 'manager'}


@dataclass(frozen=True)
class Workspace:
    """Who is asking (`actor_id`) and whose records they are working on (`tenant_id`).

    The same person for an ordinary account. For a fleet member the tenant is the fleet
    owner: the records, settings and subscription are the owner's, and the member is
    let in as a `manager` (all of them) or a `driver` (only `vehicle_ids`).
    """

    actor_id: int
    tenant_id: int
    role: str
    vehicle_ids: tuple | None = None

    @property
    def is_own(self) -> bool:
        return self.actor_id == self.tenant_id

    @property
    def can_manage(self) -> bool:
        return self.role in FLEET_MANAGING_ROLES


def _bind(db, actor_id: int, tenant_id: int, vehicle_ids) -> None:
    # Session-level, like set_tenant: handlers commit mid-request. The connection is
    # fresh per request, so nothing carries over to the next one.
    scope = '' if vehicle_ids is None else '{' + ','.join(str(int(v)) for v in vehicle_ids) + '}'
    cur = db.cursor()
    cur.execute(
        "SELECT set_config('app.actor_id', %s, false), set_config('app.vehicle_ids', %s, false);",
        (str(actor_id), scope),
    )
    set_tenant(db, tenant_id)


def get_workspace(request: Request, user_id: str = Depends(get_current_user_id), db=Depends(get_db)) -> Workspace:
    """Resolve the workspace header and bind the connection to it.

    A driver's assigned vehicles go into `app.vehicle_ids`, which the vehicle-bound
    policies read: the database, not each query, keeps a driver to their own cars. A
    stale header (membership ended) answers 403 with `X-Mileage-Workspace-Invalid`, so
    the client can drop back to the caller's own account instead of looping.
    """
    actor_id = int(user_id)
    raw = (request.headers.get(WORKSPACE_HEADER) or '').strip()
    if not raw or raw == str(actor_id):
        _bind(db, actor_id, actor_id, None)
        return Workspace(actor_id=actor_id, tenant_id=actor_id, role='owner')

    invalid = HTTPException(
        status_code=403,
        detail='You are no longer a member of that fleet.',
        headers={'X-Mileage-Workspace-Invalid': '1'},
    )
    try:
        owner_id = int(raw)
    except ValueError:
        raise invalid
    cur = db.cursor()
    cur.execute("SELECT set_config('app.actor_id', %s, false);", (str(actor_id),))
    cur.execute(
        'SELECT role, vehicle_ids FROM fleet_members WHERE owner_id = %s AND member_id = %s;',
        (owner_id, actor_id),
    )
    membership = cur.fetchone()
    if not membership:
        raise invalid
    vehicle_ids = None if membership['role'] == 'manager' else tuple(membership['vehicle_ids'] or ())
    _bind(db, actor_id, owner_id, vehicle_ids)
    return Workspace(actor_id=actor_id, tenant_id=owner_id, role=membership['role'], vehicle_ids=vehicle_ids)


def get_tenant_db(workspace: Workspace = Depends(get_workspace), db=Depends(get_db)):
    """Database handle bound to the active workspace, for every endpoint touching records.

    Row level security reads `app.user_id` (and `app.vehicle_ids` for a driver), so a
    query that forgets its WHERE clause still returns only what the caller may see.
    """
    return db


def get_tenant_user_id(workspace: Workspace = Depends(get_workspace)) -> str:
    """The account whose records the request works on: the caller, or their fleet's owner.

    Data routers filter and insert with this rather than the caller's id, which is what
    lets a fleet member work inside the owner's records without touching each query.
    """
    return str(workspace.tenant_id)


def get_own_db(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    """Database handle bound to the caller's own account, whatever workspace is active.

    For what belongs to the person rather than to the records they are working on:
    their profile, export, feedback, fleet memberships.
    """
    _bind(db, int(user_id), int(user_id), None)
    return db


def require_fleet_manager(workspace: Workspace = Depends(get_workspace)) -> Workspace:
    """Refuse drivers: they record and read their own cars, but do not reshape the fleet."""
    if not workspace.can_manage:
        raise HTTPException(
            status_code=403,
            detail='Drivers can record and view their own vehicles. Ask the fleet owner or a manager for this.',
        )
    return workspace


def require_write_access(workspace: Workspace = Depends(get_workspace), db=Depends(get_tenant_db)):
    """Block mutations once the trial or paid period has lapsed.

    402 rather than 403: the resource exists and the caller owns it, they just need
    to pay. Reads and CSV export intentionally do not use this dependency. In a fleet
    it is the owner's plan that counts — members do not pay separately — while the
    address that has to be confirmed is still the caller's own.
    """
    subscription = ensure_subscription(db, workspace.tenant_id)
    user_id = workspace.actor_id
    if subscription.get('status') not in WRITE_ALLOWED_STATUSES:
        raise HTTPException(
            status_code=402,
            detail='Your subscription has ended. Your data stays readable and exportable, but new entries need an active plan.',
        )
    # 403, not 402: nothing to pay, one link to click. Admins are exempt, as from the plan.
    if not subscription.get('exempt') and get_site_setting(db, 'require_email_verification'):
        cur = db.cursor()
        cur.execute('SELECT email_verified_at FROM users WHERE id = %s;', (user_id,))
        row = cur.fetchone()
        if row and row.get('email_verified_at') is None:
            raise HTTPException(
                status_code=403,
                detail='Confirm your email address first — the link is in your inbox, and the banner above can send a new one.',
            )
    return subscription
