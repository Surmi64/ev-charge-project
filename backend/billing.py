"""Subscription state, trial handling and the write gate.

No payment provider is wired up yet: `provider*` columns stay NULL and an admin
flips a subscription to active manually. The gating below is provider-agnostic, so
adding Stripe or Paddle later means filling those columns from a webhook and
leaving the rest of the application untouched.
"""

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException

try:
    from backend.auth_utils import get_current_user_id
    from backend.config import PLAN_PRICES, TRIAL_DAYS
    from backend.db import get_db, set_tenant, table_exists
except ModuleNotFoundError:
    from auth_utils import get_current_user_id
    from config import PLAN_PRICES, TRIAL_DAYS
    from db import get_db, set_tenant, table_exists

# Statuses that may create or modify records. Everything else is read-only, which
# still allows viewing and CSV export so a lapsed user keeps access to their data.
WRITE_ALLOWED_STATUSES = {'trialing', 'active'}


def _now():
    return datetime.now(timezone.utc)


def ensure_subscription(db, user_id) -> dict:
    """Return the user's subscription, starting a trial if they have none."""
    if not table_exists(db, 'subscriptions'):
        # Database predates the billing migration: treat as unrestricted.
        return {
            'plan': 'trial',
            'status': 'trialing',
            'trial_ends_at': None,
            'current_period_end': None,
            'cancel_at_period_end': False,
        }

    cur = db.cursor()
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
            (user_id, TRIAL_DAYS),
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


def get_tenant_db(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    """Database handle bound to the caller, for every endpoint touching user data.

    Row level security reads `app.user_id`, so a query that forgets its WHERE clause
    returns the caller's rows only instead of everyone's.
    """
    set_tenant(db, user_id)
    return db


def require_write_access(user_id: str = Depends(get_current_user_id), db=Depends(get_tenant_db)):
    """Block mutations once the trial or paid period has lapsed.

    402 rather than 403: the resource exists and the caller owns it, they just need
    to pay. Reads and CSV export intentionally do not use this dependency.
    """
    subscription = ensure_subscription(db, user_id)
    if subscription.get('status') not in WRITE_ALLOWED_STATUSES:
        raise HTTPException(
            status_code=402,
            detail='Your subscription has ended. Your data stays readable and exportable, but new entries need an active plan.',
        )
    return subscription
