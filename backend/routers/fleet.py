"""Fleets: letting other accounts into this one's records.

The owner invites by email, as a manager (every vehicle, can reshape the fleet) or a
driver (only the vehicles assigned, records and reads them). The invitee keeps their
own account; accepting adds a workspace they can switch into, and requests made there
carry `X-Mileage-Workspace` so `billing.get_workspace` binds them to the owner's
records — row level security does the rest, including keeping a driver to their cars.

Only the owner manages membership. The owner's plan covers everyone in the fleet.
Mail is queued like any account mail; the invite link is also returned to the owner,
so a fleet can be set up before outgoing mail works.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

try:
    from backend.account_lifecycle import send_mail
    from backend.auth_rate_limit import enforce
    from backend.auth_utils import create_refresh_token, get_current_user_id, hash_token
    from backend.billing import (
        WRITE_ALLOWED_STATUSES, Workspace, ensure_subscription, get_own_db, get_tenant_db, get_workspace,
    )
    from backend.db import get_db
    from backend.notifications import link
    from backend.schemas import FleetInvitationAccept, FleetInvitationCreate, FleetMemberUpdate
except ModuleNotFoundError:
    from account_lifecycle import send_mail
    from auth_rate_limit import enforce
    from auth_utils import create_refresh_token, get_current_user_id, hash_token
    from billing import (
        WRITE_ALLOWED_STATUSES, Workspace, ensure_subscription, get_own_db, get_tenant_db, get_workspace,
    )
    from db import get_db
    from notifications import link
    from schemas import FleetInvitationAccept, FleetInvitationCreate, FleetMemberUpdate

router = APIRouter(tags=['fleet'])

INVITATION_DAYS = 14
INVITATIONS_PER_DAY = 50
ROLE_LABELS = {'manager': 'manager', 'driver': 'driver'}

# What a member sees the owner's records through. Money, units and the figures behind
# cost per km belong to the records, so in a fleet workspace they are the owner's.
WORKSPACE_PREFERENCES = (
    'currency', 'distance_unit', 'volume_unit', 'climate_zone', 'reference_consumption_l_100km',
    'reference_fuel_price', 'fuel_comparison_enabled', 'cost_per_km_includes_expenses', 'onboarded_at',
)


def _now():
    return datetime.now(timezone.utc)


def _iso(value):
    return value.isoformat() if value else None


def _allow_invitation_lookup(cur) -> None:
    # Transaction-local: an invitation is read across accounts only inside the
    # statement that needs it, never for the rest of the request.
    cur.execute("SELECT set_config('app.fleet_invite', 'on', true);")


def _own_vehicles(cur) -> dict:
    cur.execute(
        "SELECT id, COALESCE(name, CONCAT(make, ' ', model)) AS name FROM vehicles ORDER BY name;"
    )
    return {row['id']: row['name'] for row in cur.fetchall()}


def _checked_vehicle_ids(cur, vehicle_ids: list[int]) -> list[int]:
    """The ids, deduplicated, after confirming each is one of the caller's vehicles."""
    wanted = sorted(set(vehicle_ids))
    if not wanted:
        return []
    cur.execute('SELECT id FROM vehicles WHERE id = ANY(%s);', (wanted,))
    found = {row['id'] for row in cur.fetchall()}
    if found != set(wanted):
        raise HTTPException(status_code=400, detail='One of those vehicles is not in this account.')
    return wanted


def _require_own_plan(db, user_id) -> None:
    subscription = ensure_subscription(db, user_id)
    if subscription.get('status') not in WRITE_ALLOWED_STATUSES:
        raise HTTPException(status_code=402, detail='Inviting people to a fleet needs an active plan.')


def _serialize_invitation(row, vehicles: dict | None = None, link_token: str | None = None) -> dict:
    data = {
        'id': row['id'],
        'email': row['email'],
        'role': row['role'],
        'vehicle_ids': list(row['vehicle_ids'] or []),
        'created_at': _iso(row['created_at']),
        'expires_at': _iso(row['expires_at']),
    }
    if vehicles is not None:
        data['vehicle_names'] = [vehicles[v] for v in data['vehicle_ids'] if v in vehicles]
    if link_token:
        data['link'] = link(f'/fleet/join?token={link_token}')
    return data


def _issue_invitation(cur, owner_id, owner_name: str, email: str, role: str, vehicle_ids: list[int]):
    token, _ = create_refresh_token()
    expires_at = _now() + timedelta(days=INVITATION_DAYS)
    # An invitation replaces any earlier one to the same address, so only one link works.
    cur.execute(
        'UPDATE fleet_invitations SET revoked_at = NOW() WHERE owner_id = %s AND lower(email) = lower(%s)'
        ' AND accepted_at IS NULL AND revoked_at IS NULL;',
        (owner_id, email),
    )
    cur.execute(
        """
        INSERT INTO fleet_invitations (owner_id, email, role, vehicle_ids, token_hash, invited_by, expires_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING *;
        """,
        (owner_id, email, role, vehicle_ids, hash_token(token), owner_id, expires_at),
    )
    invitation = cur.fetchone()
    scope = 'every vehicle' if role == 'manager' else (
        f'{len(vehicle_ids)} vehicle{"" if len(vehicle_ids) == 1 else "s"}' if vehicle_ids else 'no vehicles yet'
    )
    send_mail(
        cur, owner_id, email, f'{owner_name} invited you to their Mileage fleet', 'You are invited to a fleet',
        [
            f'{owner_name} would like you to join their fleet on Mileage as a {ROLE_LABELS[role]} ({scope}).',
            'Sign in or create a free account with this address, then accept. '
            f'The invitation is valid for {INVITATION_DAYS} days. If you were not expecting it, ignore this mail.',
        ],
        ('See the invitation', link(f'/fleet/join?token={token}')),
    )
    return invitation, token


def _member_rows(cur, owner_id, vehicles: dict) -> list[dict]:
    cur.execute(
        """
        SELECT fm.member_id, fm.role, fm.vehicle_ids, fm.created_at, u.username, u.email
        FROM fleet_members fm
        JOIN users u ON u.id = fm.member_id
        WHERE fm.owner_id = %s
        ORDER BY fm.role, lower(u.username);
        """,
        (owner_id,),
    )
    return [
        {
            'member_id': row['member_id'],
            'username': row['username'],
            'email': row['email'],
            'role': row['role'],
            'vehicle_ids': list(row['vehicle_ids'] or []),
            'vehicle_names': [vehicles[v] for v in (row['vehicle_ids'] or []) if v in vehicles],
            'joined_at': _iso(row['created_at']),
        }
        for row in cur.fetchall()
    ]


# --- the active workspace ----------------------------------------------------------------


@router.get('/fleet/context')
def workspace_context(workspace: Workspace = Depends(get_workspace), db=Depends(get_tenant_db)):
    """What the client needs to render the active workspace: whose it is, what the
    caller may do in it, and — in someone else's — the owner's display settings."""
    cur = db.cursor()
    cur.execute('SELECT username FROM users WHERE id = %s;', (workspace.tenant_id,))
    owner = cur.fetchone() or {}
    preferences = None
    if not workspace.is_own:
        cur.execute('SELECT * FROM users WHERE id = %s;', (workspace.tenant_id,))
        row = cur.fetchone() or {}
        preferences = {key: row.get(key) for key in WORKSPACE_PREFERENCES if key in row}
        preferences = {k: (_iso(v) if isinstance(v, datetime) else v) for k, v in preferences.items()}
        for key in ('reference_consumption_l_100km', 'reference_fuel_price'):
            if preferences.get(key) is not None:
                preferences[key] = float(preferences[key])
    cur.execute(
        'SELECT fm.owner_id, fm.role, u.username FROM fleet_members fm JOIN users u ON u.id = fm.owner_id'
        ' WHERE fm.member_id = %s ORDER BY lower(u.username);',
        (workspace.actor_id,),
    )
    fleets = [{'owner_id': row['owner_id'], 'owner_name': row['username'], 'role': row['role']} for row in cur.fetchall()]
    return {
        'tenant_id': workspace.tenant_id,
        'owner_name': owner.get('username'),
        'role': workspace.role,
        'is_own': workspace.is_own,
        'can_manage': workspace.can_manage,
        'vehicle_ids': list(workspace.vehicle_ids) if workspace.vehicle_ids is not None else None,
        'preferences': preferences,
        # The fleets the caller can switch into; empty means no switcher is drawn.
        'fleets': fleets,
    }


# --- the caller's own fleet and memberships ----------------------------------------------


@router.get('/fleet')
def fleet_overview(user_id: str = Depends(get_current_user_id), db=Depends(get_own_db)):
    cur = db.cursor()
    vehicles = _own_vehicles(cur)
    members = _member_rows(cur, user_id, vehicles)
    cur.execute(
        'SELECT * FROM fleet_invitations WHERE owner_id = %s AND accepted_at IS NULL AND revoked_at IS NULL'
        ' AND expires_at > NOW() ORDER BY created_at DESC;',
        (user_id,),
    )
    pending = [_serialize_invitation(row, vehicles) for row in cur.fetchall()]

    cur.execute(
        """
        SELECT fm.owner_id, fm.role, fm.vehicle_ids, fm.created_at, u.username
        FROM fleet_members fm
        JOIN users u ON u.id = fm.owner_id
        WHERE fm.member_id = %s
        ORDER BY lower(u.username);
        """,
        (user_id,),
    )
    memberships = [
        {
            'owner_id': row['owner_id'],
            'owner_name': row['username'],
            'role': row['role'],
            'vehicle_count': None if row['role'] == 'manager' else len(row['vehicle_ids'] or []),
            'joined_at': _iso(row['created_at']),
        }
        for row in cur.fetchall()
    ]

    # Invitations to this account's address, offered in the app once the address is
    # confirmed — the confirmation is what proves the invitation is meant for it.
    cur.execute('SELECT email, email_verified_at FROM users WHERE id = %s;', (user_id,))
    me = cur.fetchone()
    incoming = []
    if me and me.get('email_verified_at'):
        _allow_invitation_lookup(cur)
        cur.execute(
            """
            SELECT fi.id, fi.role, fi.vehicle_ids, fi.created_at, fi.expires_at, u.username AS owner_name
            FROM fleet_invitations fi
            JOIN users u ON u.id = fi.owner_id
            WHERE lower(fi.email) = lower(%s) AND fi.owner_id <> %s
              AND fi.accepted_at IS NULL AND fi.revoked_at IS NULL AND fi.expires_at > NOW()
              AND NOT EXISTS (SELECT 1 FROM fleet_members fm WHERE fm.owner_id = fi.owner_id AND fm.member_id = %s)
            ORDER BY fi.created_at DESC;
            """,
            (me['email'], user_id, user_id),
        )
        incoming = [
            {
                'id': row['id'],
                'owner_name': row['owner_name'],
                'role': row['role'],
                'vehicle_count': len(row['vehicle_ids'] or []),
                'expires_at': _iso(row['expires_at']),
            }
            for row in cur.fetchall()
        ]
        db.commit()

    return {
        'vehicles': [{'id': key, 'name': value} for key, value in vehicles.items()],
        'members': members,
        'invitations': pending,
        'memberships': memberships,
        'incoming': incoming,
    }


@router.post('/fleet/invitations', status_code=201)
def invite(payload: FleetInvitationCreate, user_id: str = Depends(get_current_user_id), db=Depends(get_own_db)):
    _require_own_plan(db, user_id)
    cur = db.cursor()
    cur.execute('SELECT username, email FROM users WHERE id = %s;', (user_id,))
    me = cur.fetchone()
    email = payload.email.strip()
    if email.lower() == (me['email'] or '').lower():
        raise HTTPException(status_code=400, detail='That is your own address — you already have this account.')
    cur.execute(
        'SELECT 1 FROM fleet_members fm JOIN users u ON u.id = fm.member_id'
        ' WHERE fm.owner_id = %s AND lower(u.email) = lower(%s);',
        (user_id, email),
    )
    if cur.fetchone():
        raise HTTPException(status_code=409, detail='That person is already in your fleet.')
    vehicle_ids = [] if payload.role == 'manager' else _checked_vehicle_ids(cur, payload.vehicle_ids)
    enforce(db, f'fleet-invite:{user_id}', INVITATIONS_PER_DAY, 24 * 3600,
            'That is a lot of invitations for one day. Try again tomorrow.')
    invitation, token = _issue_invitation(cur, user_id, me['username'], email, payload.role, vehicle_ids)
    db.commit()
    return _serialize_invitation(invitation, _own_vehicles(cur), token)


@router.post('/fleet/invitations/{invitation_id}/renew')
def renew_invitation(invitation_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_own_db)):
    """A fresh link (and mail) for a pending invitation; the old link stops working."""
    _require_own_plan(db, user_id)
    cur = db.cursor()
    cur.execute(
        'SELECT * FROM fleet_invitations WHERE id = %s AND owner_id = %s AND accepted_at IS NULL AND revoked_at IS NULL;',
        (invitation_id, user_id),
    )
    old = cur.fetchone()
    if not old:
        raise HTTPException(status_code=404, detail='Invitation not found')
    enforce(db, f'fleet-invite:{user_id}', INVITATIONS_PER_DAY, 24 * 3600,
            'That is a lot of invitations for one day. Try again tomorrow.')
    cur.execute('SELECT username FROM users WHERE id = %s;', (user_id,))
    invitation, token = _issue_invitation(
        cur, user_id, cur.fetchone()['username'], old['email'], old['role'], list(old['vehicle_ids'] or []),
    )
    db.commit()
    return _serialize_invitation(invitation, _own_vehicles(cur), token)


@router.delete('/fleet/invitations/{invitation_id}')
def revoke_invitation(invitation_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_own_db)):
    cur = db.cursor()
    cur.execute(
        'UPDATE fleet_invitations SET revoked_at = NOW() WHERE id = %s AND owner_id = %s'
        ' AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id;',
        (invitation_id, user_id),
    )
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail='Invitation not found')
    db.commit()
    return {'message': 'Invitation withdrawn'}


@router.get('/fleet/invitations/preview')
def preview_invitation(token: str = Query(..., max_length=200), db=Depends(get_db)):
    """Who is inviting, for the join page — readable before signing in, by the link alone."""
    cur = db.cursor()
    _allow_invitation_lookup(cur)
    cur.execute(
        """
        SELECT fi.email, fi.role, fi.vehicle_ids, fi.expires_at, fi.accepted_at, fi.revoked_at, u.username AS owner_name
        FROM fleet_invitations fi JOIN users u ON u.id = fi.owner_id
        WHERE fi.token_hash = %s;
        """,
        (hash_token(token),),
    )
    row = cur.fetchone()
    db.commit()
    if not row or row['revoked_at'] or row['accepted_at'] or row['expires_at'] <= _now():
        raise HTTPException(status_code=404, detail='This invitation is no longer valid. Ask for a new one.')
    return {
        'owner_name': row['owner_name'],
        'email': row['email'],
        'role': row['role'],
        'vehicle_count': len(row['vehicle_ids'] or []),
        'expires_at': _iso(row['expires_at']),
    }


@router.post('/fleet/invitations/accept')
def accept_invitation(payload: FleetInvitationAccept, user_id: str = Depends(get_current_user_id), db=Depends(get_own_db)):
    if not payload.token and not payload.invitation_id:
        raise HTTPException(status_code=400, detail='Missing invitation')
    cur = db.cursor()
    cur.execute('SELECT username, email, email_verified_at FROM users WHERE id = %s;', (user_id,))
    me = cur.fetchone()
    _allow_invitation_lookup(cur)
    if payload.token:
        # The link is the proof: whoever the owner sent it to may accept it, under
        # whichever account they sign in with.
        cur.execute('SELECT * FROM fleet_invitations WHERE token_hash = %s FOR UPDATE;', (hash_token(payload.token),))
    else:
        if not me.get('email_verified_at'):
            raise HTTPException(status_code=403, detail='Confirm your email address first, or use the link from the invitation.')
        cur.execute(
            'SELECT * FROM fleet_invitations WHERE id = %s AND lower(email) = lower(%s) FOR UPDATE;',
            (payload.invitation_id, me['email']),
        )
    invitation = cur.fetchone()
    if (not invitation or invitation['revoked_at'] or invitation['accepted_at']
            or invitation['expires_at'] <= _now()):
        db.rollback()
        raise HTTPException(status_code=404, detail='This invitation is no longer valid. Ask for a new one.')
    if str(invitation['owner_id']) == str(user_id):
        db.rollback()
        raise HTTPException(status_code=400, detail='That is your own fleet.')

    cur.execute(
        """
        INSERT INTO fleet_members (owner_id, member_id, role, vehicle_ids, invited_by)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (owner_id, member_id) DO UPDATE
        SET role = EXCLUDED.role, vehicle_ids = EXCLUDED.vehicle_ids, updated_at = NOW();
        """,
        (invitation['owner_id'], user_id, invitation['role'], list(invitation['vehicle_ids'] or []),
         invitation['invited_by']),
    )
    cur.execute(
        'UPDATE fleet_invitations SET accepted_at = NOW(), accepted_by = %s WHERE id = %s;',
        (user_id, invitation['id']),
    )
    cur.execute('SELECT username, email FROM users WHERE id = %s;', (invitation['owner_id'],))
    owner = cur.fetchone()
    send_mail(
        cur, invitation['owner_id'], owner['email'], f'{me["username"]} joined your fleet', 'A new fleet member',
        [f'{me["username"]} ({me["email"]}) accepted your invitation and joined your fleet as a '
         f'{ROLE_LABELS[invitation["role"]]}.',
         'You can change their role and vehicles, or remove them, under Fleet.'],
        ('Open Fleet', link('/fleet')),
    )
    db.commit()
    return {'owner_id': invitation['owner_id'], 'owner_name': owner['username'], 'role': invitation['role']}


@router.post('/fleet/invitations/{invitation_id}/decline')
def decline_invitation(invitation_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_own_db)):
    cur = db.cursor()
    cur.execute('SELECT email FROM users WHERE id = %s;', (user_id,))
    email = cur.fetchone()['email']
    _allow_invitation_lookup(cur)
    cur.execute(
        'UPDATE fleet_invitations SET revoked_at = NOW() WHERE id = %s AND lower(email) = lower(%s)'
        ' AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id;',
        (invitation_id, email),
    )
    if not cur.fetchone():
        db.rollback()
        raise HTTPException(status_code=404, detail='Invitation not found')
    db.commit()
    return {'message': 'Invitation declined'}


@router.patch('/fleet/members/{member_id}')
def update_member(member_id: int, payload: FleetMemberUpdate, user_id: str = Depends(get_current_user_id),
                  db=Depends(get_own_db)):
    cur = db.cursor()
    cur.execute('SELECT * FROM fleet_members WHERE owner_id = %s AND member_id = %s;', (user_id, member_id))
    member = cur.fetchone()
    if not member:
        raise HTTPException(status_code=404, detail='Member not found')
    role = payload.role or member['role']
    vehicle_ids = list(member['vehicle_ids'] or [])
    if payload.vehicle_ids is not None:
        vehicle_ids = _checked_vehicle_ids(cur, payload.vehicle_ids)
    cur.execute(
        'UPDATE fleet_members SET role = %s, vehicle_ids = %s, updated_at = NOW() WHERE id = %s;',
        (role, vehicle_ids, member['id']),
    )
    db.commit()
    return {'member_id': member_id, 'role': role, 'vehicle_ids': vehicle_ids}


@router.delete('/fleet/members/{member_id}')
def remove_member(member_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_own_db)):
    """Takes effect on the member's next request: the workspace is checked every time."""
    cur = db.cursor()
    cur.execute('DELETE FROM fleet_members WHERE owner_id = %s AND member_id = %s RETURNING id;', (user_id, member_id))
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail='Member not found')
    db.commit()
    return {'message': 'Removed from the fleet. What they recorded stays.'}


@router.delete('/fleet/memberships/{owner_id}')
def leave_fleet(owner_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_own_db)):
    cur = db.cursor()
    cur.execute('DELETE FROM fleet_members WHERE owner_id = %s AND member_id = %s RETURNING id;', (owner_id, user_id))
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail='You are not in that fleet.')
    db.commit()
    return {'message': 'You left the fleet.'}
