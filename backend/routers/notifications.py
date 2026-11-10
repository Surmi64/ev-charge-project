import html
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
import psycopg2

try:
    from backend.auth_utils import get_current_user_id, hash_token
    from backend.billing import get_tenant_db, require_write_access
    from backend.db import get_db
    from backend.notifications import enqueue_confirmation, enqueue_test, new_token
    from backend.schemas import NotificationRecipientCreate, NotificationRecipientUpdate
except ModuleNotFoundError:
    from auth_utils import get_current_user_id, hash_token
    from billing import get_tenant_db, require_write_access
    from db import get_db
    from notifications import enqueue_confirmation, enqueue_test, new_token
    from schemas import NotificationRecipientCreate, NotificationRecipientUpdate

router = APIRouter(tags=['notifications'])

MODES = {'instant', 'daily', 'weekly'}
# Enough for an owner, a fleet manager and a bookkeeper several times over; a cap at all
# keeps the feature from becoming a way to mail many strangers from one account.
MAX_RECIPIENTS = 10
RESEND_COOLDOWN_SECONDS = 60
TESTS_PER_TEN_MINUTES = 3


def _serialize(row) -> dict:
    return {
        'id': row['id'],
        'email': row['email'],
        'mode': row['mode'],
        'vehicle_ids': list(row['vehicle_ids']) if row.get('vehicle_ids') else None,
        'confirmed': row['confirmed_at'] is not None,
        'confirmed_at': row['confirmed_at'].isoformat() if row.get('confirmed_at') else None,
        'created_at': row['created_at'].isoformat() if row.get('created_at') else None,
    }


def _account(cur, user_id) -> dict:
    cur.execute('SELECT username, email FROM users WHERE id = %s;', (user_id,))
    return cur.fetchone() or {}


def _check_mode(mode: str) -> str:
    if mode not in MODES:
        raise HTTPException(status_code=400, detail='Mode must be instant, daily or weekly')
    return mode


def _check_vehicles(cur, user_id, vehicle_ids):
    """An empty list is refused rather than read as 'none': that recipient would never
    hear anything, which is what deleting them is for."""
    if vehicle_ids is None:
        return None
    ids = sorted(set(vehicle_ids))
    if not ids:
        raise HTTPException(status_code=400, detail='Pick at least one vehicle, or all of them')
    cur.execute('SELECT id FROM vehicles WHERE user_id = %s AND id = ANY(%s);', (user_id, ids))
    if len(cur.fetchall()) != len(ids):
        raise HTTPException(status_code=400, detail='Unknown vehicle')
    return ids


def _get(cur, user_id, recipient_id):
    cur.execute('SELECT * FROM notification_recipients WHERE id = %s AND user_id = %s;', (recipient_id, user_id))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail='Recipient not found')
    return row


@router.get('/notifications/recipients')
def list_recipients(user_id: str = Depends(get_current_user_id), db=Depends(get_tenant_db)):
    cur = db.cursor()
    cur.execute('SELECT * FROM notification_recipients WHERE user_id = %s ORDER BY created_at, id;', (user_id,))
    return [_serialize(row) for row in cur.fetchall()]


@router.post('/notifications/recipients', status_code=201)
def add_recipient(payload: NotificationRecipientCreate, user_id: str = Depends(get_current_user_id),
                  _subscription=Depends(require_write_access), db=Depends(get_tenant_db)):
    cur = db.cursor()
    mode = _check_mode(payload.mode)
    vehicle_ids = _check_vehicles(cur, user_id, payload.vehicle_ids)
    cur.execute('SELECT COUNT(*) AS n FROM notification_recipients WHERE user_id = %s;', (user_id,))
    if cur.fetchone()['n'] >= MAX_RECIPIENTS:
        raise HTTPException(status_code=400, detail=f'An account can have at most {MAX_RECIPIENTS} recipients')

    account = _account(cur, user_id)
    email = str(payload.email).strip()
    # The account's own address is already proven by the login; any other address has
    # to say yes before it receives anything.
    own = bool(account.get('email')) and email.lower() == account['email'].lower()
    confirm_token = None if own else new_token()
    try:
        cur.execute(
            """
            INSERT INTO notification_recipients
                (user_id, email, mode, vehicle_ids, confirmed_at, confirm_token_hash, confirm_sent_at, unsubscribe_token)
            VALUES (%s, %s, %s, %s, CASE WHEN %s THEN NOW() END, %s, CASE WHEN %s THEN NULL ELSE NOW() END, %s)
            RETURNING *;
            """,
            (user_id, email, mode, vehicle_ids, own, hash_token(confirm_token) if confirm_token else None,
             own, new_token()),
        )
        row = cur.fetchone()
        if confirm_token:
            enqueue_confirmation(cur, user_id, row['id'], confirm_token, account.get('username') or account.get('email'))
        db.commit()
    except psycopg2.IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail='That address is already on the list')
    return _serialize(row)


@router.patch('/notifications/recipients/{recipient_id}')
def update_recipient(recipient_id: int, payload: NotificationRecipientUpdate, user_id: str = Depends(get_current_user_id),
                     _subscription=Depends(require_write_access), db=Depends(get_tenant_db)):
    cur = db.cursor()
    _get(cur, user_id, recipient_id)
    changes = payload.model_dump(exclude_unset=True)
    updates, values = [], []
    if 'mode' in changes:
        updates.append('mode = %s')
        values.append(_check_mode(changes['mode']))
        # A switch of cadence starts the new one from now, rather than sending a digest
        # of everything since the recipient was first added.
        updates.append('last_digest_at = NOW()')
    if 'vehicle_ids' in changes:
        updates.append('vehicle_ids = %s')
        values.append(_check_vehicles(cur, user_id, changes['vehicle_ids']))
    if not updates:
        return _serialize(_get(cur, user_id, recipient_id))
    cur.execute(
        f"UPDATE notification_recipients SET {', '.join(updates)} WHERE id = %s AND user_id = %s RETURNING *;",
        (*values, recipient_id, user_id),
    )
    row = cur.fetchone()
    db.commit()
    return _serialize(row)


@router.delete('/notifications/recipients/{recipient_id}')
def delete_recipient(recipient_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_tenant_db)):
    # Not gated on the subscription: stopping mail must always be possible.
    cur = db.cursor()
    cur.execute('DELETE FROM notification_recipients WHERE id = %s AND user_id = %s;', (recipient_id, user_id))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail='Recipient not found')
    db.commit()
    return {'message': 'Recipient removed'}


@router.post('/notifications/recipients/{recipient_id}/resend')
def resend_confirmation(recipient_id: int, user_id: str = Depends(get_current_user_id),
                        _subscription=Depends(require_write_access), db=Depends(get_tenant_db)):
    cur = db.cursor()
    row = _get(cur, user_id, recipient_id)
    if row['confirmed_at'] is not None:
        raise HTTPException(status_code=400, detail='This address has already confirmed')
    cur.execute(
        "SELECT confirm_sent_at > NOW() - make_interval(secs => %s) AS recent FROM notification_recipients WHERE id = %s;",
        (RESEND_COOLDOWN_SECONDS, recipient_id),
    )
    if cur.fetchone()['recent']:
        raise HTTPException(status_code=429, detail='A confirmation was just sent. Try again in a minute.')
    token = new_token()
    cur.execute(
        'UPDATE notification_recipients SET confirm_token_hash = %s, confirm_sent_at = NOW() WHERE id = %s;',
        (hash_token(token), recipient_id),
    )
    account = _account(cur, user_id)
    enqueue_confirmation(cur, user_id, recipient_id, token, account.get('username') or account.get('email'))
    db.commit()
    return {'message': 'Confirmation sent'}


@router.post('/notifications/recipients/{recipient_id}/test')
def send_test(recipient_id: int, user_id: str = Depends(get_current_user_id),
              _subscription=Depends(require_write_access), db=Depends(get_tenant_db)):
    cur = db.cursor()
    row = _get(cur, user_id, recipient_id)
    if row['confirmed_at'] is None:
        raise HTTPException(status_code=400, detail='This address has not confirmed yet')
    cur.execute(
        """
        SELECT COUNT(*) AS n FROM notification_outbox
        WHERE user_id = %s AND kind = 'test' AND created_at > NOW() - INTERVAL '10 minutes';
        """,
        (user_id,),
    )
    if cur.fetchone()['n'] >= TESTS_PER_TEN_MINUTES:
        raise HTTPException(status_code=429, detail='Too many test messages. Try again in a few minutes.')
    account = _account(cur, user_id)
    enqueue_test(cur, user_id, recipient_id, account.get('username') or account.get('email'))
    db.commit()
    return {'message': 'Test message queued'}


# --- links opened from a mail, with no session --------------------------------------------------
# Each GET only shows a page with a button; the change happens on POST. Mail scanners
# fetch every link in a message to check it, and a GET that acted would confirm or
# unsubscribe on the recipient's behalf before they ever saw the mail. The form posts
# back to the same path by a relative URL, since behind the proxy the backend does not
# see the public one.

def _page(title: str, message: str, action: str | None = None, button: str | None = None) -> HTMLResponse:
    esc = html.escape
    form = (
        f'<form method="post" action="{esc(action)}"><button type="submit" style="background:#1f6feb;color:#fff;'
        f'border:0;border-radius:8px;padding:10px 18px;font-size:15px;cursor:pointer;">{esc(button)}</button></form>'
        if action else ''
    )
    return HTMLResponse(
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>{esc(title)}</title></head>'
        '<body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2330;">'
        '<div style="max-width:480px;margin:48px auto;background:#fff;border-radius:12px;padding:24px;">'
        f'<h1 style="margin:0 0 12px;font-size:20px;">{esc(title)}</h1><p>{esc(message)}</p>{form}</div></body></html>'
    )


def _mail_db(db):
    cur = db.cursor()
    cur.execute("SET app.notifications = 'on';")
    return cur


@router.get('/notifications/confirm', response_class=HTMLResponse)
def confirm_page(token: str, db=Depends(get_db)):
    cur = _mail_db(db)
    cur.execute(
        'SELECT r.email, u.username FROM notification_recipients r JOIN users u ON u.id = r.user_id WHERE r.confirm_token_hash = %s;',
        (hash_token(token),),
    )
    row = cur.fetchone()
    if not row:
        return _page('Link no longer valid', 'This confirmation link has already been used or has been replaced by a newer one.')
    return _page(
        'Confirm notifications',
        f"{row['username']} would like to email {row['email']} whenever a charge or fill-up is recorded.",
        action=f'?token={quote(token)}', button='Confirm',
    )


@router.post('/notifications/confirm', response_class=HTMLResponse)
def confirm(token: str, db=Depends(get_db)):
    cur = _mail_db(db)
    cur.execute(
        """
        UPDATE notification_recipients SET confirmed_at = NOW(), confirm_token_hash = NULL, last_digest_at = NOW()
        WHERE confirm_token_hash = %s RETURNING email;
        """,
        (hash_token(token),),
    )
    row = cur.fetchone()
    db.commit()
    if not row:
        return _page('Link no longer valid', 'This confirmation link has already been used or has been replaced by a newer one.')
    return _page('Confirmed', f"{row['email']} will now receive notifications. Every message has an unsubscribe link.")


@router.get('/notifications/unsubscribe', response_class=HTMLResponse)
def unsubscribe_page(token: str, db=Depends(get_db)):
    cur = _mail_db(db)
    cur.execute('SELECT email FROM notification_recipients WHERE unsubscribe_token = %s;', (token,))
    row = cur.fetchone()
    if not row:
        return _page('Already unsubscribed', 'This address no longer receives these notifications.')
    return _page('Unsubscribe', f"Stop sending notifications to {row['email']}?", action=f'?token={quote(token)}', button='Unsubscribe')


@router.post('/notifications/unsubscribe', response_class=HTMLResponse)
def unsubscribe(token: str, db=Depends(get_db)):
    # Also the target of the one-click List-Unsubscribe POST a mail client sends.
    cur = _mail_db(db)
    cur.execute('DELETE FROM notification_recipients WHERE unsubscribe_token = %s RETURNING email;', (token,))
    row = cur.fetchone()
    db.commit()
    if not row:
        return _page('Already unsubscribed', 'This address no longer receives these notifications.')
    return _page('Unsubscribed', f"{row['email']} will not receive these notifications any more.")
