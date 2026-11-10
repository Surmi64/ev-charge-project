"""Ideas, bug reports and complaints: one way in, one inbox, answers by mail.

Submitting is never gated on the subscription — a lapsed account is exactly who sends
a complaint. Complaints carry a deadline (30 days for a written answer, the consumer
protection rule this is built for) and survive the account's deletion; ideas and bug
reports go with it.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from psycopg2.extras import Json

try:
    from backend.account_lifecycle import send_mail
    from backend.auth_rate_limit import enforce
    from backend.auth_utils import get_current_user_id
    from backend.billing import get_tenant_db
    from backend.db import get_db
    from backend.notifications import link
    from backend.routers.admin import require_admin_user
    from backend.schemas import FeedbackCreate, FeedbackReply, FeedbackStatusUpdate
except ModuleNotFoundError:
    from account_lifecycle import send_mail
    from auth_rate_limit import enforce
    from auth_utils import get_current_user_id
    from billing import get_tenant_db
    from db import get_db
    from notifications import link
    from routers.admin import require_admin_user
    from schemas import FeedbackCreate, FeedbackReply, FeedbackStatusUpdate

router = APIRouter(tags=['feedback'])

KINDS = {'idea': 'Idea', 'bug': 'Bug report', 'complaint': 'Complaint'}
STATUSES = {'new', 'in_progress', 'planned', 'answered', 'resolved', 'declined'}
COMPLAINT_ANSWER_DAYS = 30
SUBMISSIONS_PER_DAY = 10
CONTEXT_MAX_KEYS = 20


def _serialize(row, messages=None, admin=False) -> dict:
    item = {
        'id': row['id'],
        'kind': row['kind'],
        'status': row['status'],
        'subject': row['subject'],
        'body': row['body'],
        'created_at': row['created_at'].isoformat(),
        'updated_at': row['updated_at'].isoformat() if row.get('updated_at') else None,
        'due_at': row['due_at'].isoformat() if row.get('due_at') else None,
    }
    if admin:
        item['context'] = row.get('context') or {}
        item['contact_email'] = row.get('contact_email')
        item['username'] = row.get('username')
        item['account_deleted'] = row.get('user_id') is None
    if messages is not None:
        item['messages'] = [
            {
                'id': message['id'],
                'from_admin': message['from_admin'],
                'body': message['body'],
                'created_at': message['created_at'].isoformat(),
            }
            for message in messages
        ]
    return item


def _messages_by_feedback(cur, feedback_ids: list[int]) -> dict[int, list]:
    if not feedback_ids:
        return {}
    cur.execute(
        'SELECT * FROM feedback_messages WHERE feedback_id = ANY(%s) ORDER BY created_at, id;',
        (feedback_ids,),
    )
    grouped: dict[int, list] = {}
    for message in cur.fetchall():
        grouped.setdefault(message['feedback_id'], []).append(message)
    return grouped


@router.post('/feedback', status_code=201)
def submit_feedback(payload: FeedbackCreate, request: Request, user_id: str = Depends(get_current_user_id),
                    db=Depends(get_tenant_db)):
    if payload.kind not in KINDS:
        raise HTTPException(status_code=400, detail='Kind must be idea, bug or complaint')
    enforce(db, f'feedback:user:{user_id}', SUBMISSIONS_PER_DAY, 86400,
            'That is a lot of messages for one day. Try again tomorrow, or reply to an earlier one.')

    # The client's context is kept small and flat: it is diagnostic, not a payload.
    context = {
        str(key)[:40]: str(value)[:300]
        for key, value in list((payload.context or {}).items())[:CONTEXT_MAX_KEYS]
    }
    context['user_agent'] = (request.headers.get('user-agent') or '')[:300]

    cur = db.cursor()
    cur.execute('SELECT email, username FROM users WHERE id = %s;', (user_id,))
    account = cur.fetchone() or {}
    cur.execute(
        """
        INSERT INTO feedback (user_id, contact_email, kind, subject, body, context, due_at)
        VALUES (%s, %s, %s, %s, %s, %s, CASE WHEN %s THEN NOW() + make_interval(days => %s) END)
        RETURNING *;
        """,
        (user_id, account.get('email'), payload.kind, payload.subject.strip(), payload.body.strip(), Json(context),
         payload.kind == 'complaint', COMPLAINT_ANSWER_DAYS),
    )
    row = cur.fetchone()

    if account.get('email'):
        paragraphs = [f'We received your {KINDS[payload.kind].lower()}: "{row["subject"]}".']
        if payload.kind == 'complaint':
            paragraphs.append(
                f'You will get a written answer within {COMPLAINT_ANSWER_DAYS} days, '
                f'by {row["due_at"].date().isoformat()} at the latest.'
            )
        else:
            paragraphs.append('Every message is read. You will hear back when there is something to say.')
        send_mail(cur, user_id, account['email'], f'We got your message: {row["subject"]}', 'Thanks — message received',
                  paragraphs, ('See your messages', link('/feedback')))

    # Every admin hears about it, so nothing waits on someone opening the inbox.
    cur.execute("SELECT id, email FROM users WHERE role = 'admin';")
    for admin in cur.fetchall():
        send_mail(
            cur, user_id, admin['email'], f'[{KINDS[payload.kind]}] {row["subject"]}', f'New {KINDS[payload.kind].lower()}',
            [f'From {account.get("username") or account.get("email")}:', row['body'][:1500]],
            ('Open the inbox', link(f'/admin?tab=feedback&id={row["id"]}')),
        )
    db.commit()
    return _serialize(row, [])


@router.get('/feedback')
def my_feedback(user_id: str = Depends(get_current_user_id), db=Depends(get_tenant_db)):
    cur = db.cursor()
    cur.execute('SELECT * FROM feedback WHERE user_id = %s ORDER BY created_at DESC;', (user_id,))
    rows = cur.fetchall()
    messages = _messages_by_feedback(cur, [row['id'] for row in rows])
    return [_serialize(row, messages.get(row['id'], [])) for row in rows]


@router.post('/feedback/{feedback_id}/messages', status_code=201)
def reply_as_user(feedback_id: int, payload: FeedbackReply, user_id: str = Depends(get_current_user_id),
                  db=Depends(get_tenant_db)):
    enforce(db, f'feedback-reply:user:{user_id}', 30, 86400, 'Too many replies today. Try again tomorrow.')
    cur = db.cursor()
    cur.execute('SELECT id, subject, kind FROM feedback WHERE id = %s AND user_id = %s;', (feedback_id, user_id))
    item = cur.fetchone()
    if not item:
        raise HTTPException(status_code=404, detail='Message not found')
    cur.execute(
        'INSERT INTO feedback_messages (feedback_id, user_id, author_id, from_admin, body) VALUES (%s, %s, %s, FALSE, %s);',
        (feedback_id, user_id, user_id, payload.body.strip()),
    )
    # A reply reopens the conversation for the inbox.
    cur.execute(
        "UPDATE feedback SET status = CASE WHEN status IN ('answered', 'resolved') THEN 'in_progress' ELSE status END, "
        'updated_at = NOW() WHERE id = %s;',
        (feedback_id,),
    )
    db.commit()
    return {'message': 'Reply sent'}


# --- admin inbox -----------------------------------------------------------------------------

@router.get('/admin/feedback')
def admin_list_feedback(
    status: str | None = Query(None),
    kind: str | None = Query(None),
    admin_user=Depends(require_admin_user),
    db=Depends(get_db),
):
    """The inbox: complaints with the nearest deadline first, then everything newest first."""
    cur = db.cursor()
    filters, params = [], []
    if status == 'open':
        filters.append("f.status IN ('new', 'in_progress', 'planned')")
    elif status:
        filters.append('f.status = %s')
        params.append(status)
    if kind:
        filters.append('f.kind = %s')
        params.append(kind)
    where = f"WHERE {' AND '.join(filters)}" if filters else ''
    cur.execute(
        f"""
        SELECT f.*, u.username,
               (SELECT COUNT(*) FROM feedback_messages m WHERE m.feedback_id = f.id) AS message_count
        FROM feedback f LEFT JOIN users u ON u.id = f.user_id
        {where}
        ORDER BY (f.kind = 'complaint' AND f.status IN ('new', 'in_progress')) DESC,
                 f.due_at NULLS LAST, f.created_at DESC
        LIMIT 500;
        """,
        params,
    )
    rows = cur.fetchall()
    result = []
    for row in rows:
        item = _serialize(row, admin=True)
        item['message_count'] = int(row['message_count'])
        result.append(item)
    return result


@router.get('/admin/feedback/{feedback_id}')
def admin_get_feedback(feedback_id: int, admin_user=Depends(require_admin_user), db=Depends(get_db)):
    cur = db.cursor()
    cur.execute('SELECT f.*, u.username FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = %s;', (feedback_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail='Not found')
    return _serialize(row, _messages_by_feedback(cur, [feedback_id]).get(feedback_id, []), admin=True)


@router.post('/admin/feedback/{feedback_id}/messages', status_code=201)
def admin_reply(feedback_id: int, payload: FeedbackReply, admin_user=Depends(require_admin_user), db=Depends(get_db)):
    """Answer a submission. The answer is mailed to the sender and kept on the thread."""
    cur = db.cursor()
    cur.execute('SELECT * FROM feedback WHERE id = %s;', (feedback_id,))
    item = cur.fetchone()
    if not item:
        raise HTTPException(status_code=404, detail='Not found')
    cur.execute(
        'INSERT INTO feedback_messages (feedback_id, user_id, author_id, from_admin, body) VALUES (%s, %s, %s, TRUE, %s);',
        (feedback_id, item['user_id'], admin_user['id'], payload.body.strip()),
    )
    cur.execute(
        "UPDATE feedback SET status = CASE WHEN status IN ('new', 'in_progress') THEN 'answered' ELSE status END, "
        'updated_at = NOW() WHERE id = %s;',
        (feedback_id,),
    )
    to = item.get('contact_email')
    if to and item.get('user_id'):
        send_mail(
            cur, item['user_id'], to, f'Re: {item["subject"]}', f'Re: {item["subject"]}',
            [payload.body.strip()[:4000]],
            ('Reply in Mileage', link('/feedback')),
        )
    db.commit()
    return {'message': 'Answer sent' if to else 'Answer saved; the account no longer exists, so nothing was mailed'}


@router.patch('/admin/feedback/{feedback_id}')
def admin_set_status(feedback_id: int, payload: FeedbackStatusUpdate, admin_user=Depends(require_admin_user),
                     db=Depends(get_db)):
    if payload.status not in STATUSES:
        raise HTTPException(status_code=400, detail='Unknown status')
    cur = db.cursor()
    cur.execute('UPDATE feedback SET status = %s, updated_at = NOW() WHERE id = %s;', (payload.status, feedback_id))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail='Not found')
    db.commit()
    return {'status': payload.status}

