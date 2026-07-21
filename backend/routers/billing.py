from fastapi import APIRouter, Depends

try:
    from backend.auth_utils import get_current_user_id
    from backend.billing import ensure_subscription, get_tenant_db, serialize_subscription
    from backend.config import PLAN_PRICES, TRIAL_DAYS
except ModuleNotFoundError:
    from auth_utils import get_current_user_id
    from billing import ensure_subscription, get_tenant_db, serialize_subscription
    from config import PLAN_PRICES, TRIAL_DAYS

router = APIRouter(tags=['billing'])


@router.get('/billing/me')
def get_my_subscription(user_id: str = Depends(get_current_user_id), db=Depends(get_tenant_db)):
    """The caller's own subscription. Row level security keeps this to one row."""
    return serialize_subscription(ensure_subscription(db, user_id))


@router.get('/billing/plans')
def get_plans():
    """Public pricing, so the frontend does not hardcode amounts."""
    return {
        'trial_days': TRIAL_DAYS,
        'plans': [
            {
                'id': 'monthly',
                'name': 'Monthly',
                'amount_cents': PLAN_PRICES['monthly']['amount_cents'],
                'currency': PLAN_PRICES['monthly']['currency'],
                'interval': 'month',
            },
            {
                'id': 'yearly',
                'name': 'Yearly',
                'amount_cents': PLAN_PRICES['yearly']['amount_cents'],
                'currency': PLAN_PRICES['yearly']['currency'],
                'interval': 'year',
                # 12 * 5 = 60 against 50, i.e. two months free.
                'savings_percent': round(
                    (1 - PLAN_PRICES['yearly']['amount_cents'] / (PLAN_PRICES['monthly']['amount_cents'] * 12)) * 100
                ),
            },
        ],
    }
