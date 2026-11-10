from fastapi import APIRouter, Depends

try:
    from backend.billing import Workspace, ensure_subscription, get_tenant_db, get_workspace, serialize_subscription
    from backend.config import PLAN_PRICES, TRIAL_DAYS
except ModuleNotFoundError:
    from billing import Workspace, ensure_subscription, get_tenant_db, get_workspace, serialize_subscription
    from config import PLAN_PRICES, TRIAL_DAYS

router = APIRouter(tags=['billing'])


@router.get('/billing/me')
def get_my_subscription(workspace: Workspace = Depends(get_workspace), db=Depends(get_tenant_db)):
    """The plan behind the active workspace: the caller's own, or in a fleet the owner's,
    since that is the one that decides whether anything can be recorded there."""
    data = serialize_subscription(ensure_subscription(db, workspace.tenant_id))
    data['managed_by_fleet_owner'] = not workspace.is_own
    return data


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
