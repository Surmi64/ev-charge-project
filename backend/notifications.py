"""New-record notifications: who hears about a charge or fill-up, and the worker that tells them.

A saved session only ever writes outbox rows (`enqueue_session_notifications`), inside
the request's own transaction, so a notification exists exactly when its record does.
Sending happens here, on a background thread, with retries — a slow or absent mail
server never slows or fails the save.

The worker connects like the API does, as the app role, and sets `app.notifications`,
which the two notification tables accept in place of a tenant. Everything else it reads
— the sessions behind a digest — it reads with `app.user_id` set to that one account,
so the ordinary tenant policies still decide what it can see.
"""

import html
import logging
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg2
from psycopg2.extras import Json, RealDictCursor

try:
    from backend.config import (
        APP_BASE_URL, APP_TIMEZONE, DB_APP_PASS, DB_APP_USER, DB_HOST, DB_NAME, DB_PORT,
        DIGEST_HOUR, DISTANCE_UNITS, SUPPORTED_CURRENCIES, VOLUME_UNITS,
    )
    from backend.db import get_vehicle_column
    from backend.email_sender import mail_transport, send_email
    from backend.logging_utils import log_event
except ModuleNotFoundError:
    from config import (
        APP_BASE_URL, APP_TIMEZONE, DB_APP_PASS, DB_APP_USER, DB_HOST, DB_NAME, DB_PORT,
        DIGEST_HOUR, DISTANCE_UNITS, SUPPORTED_CURRENCIES, VOLUME_UNITS,
    )
    from db import get_vehicle_column
    from email_sender import mail_transport, send_email
    from logging_utils import log_event

logger = logging.getLogger('mileage.notifications')

POLL_SECONDS = 30
# Account purges, trial reminders and log pruning: hourly is plenty for any of them.
MAINTENANCE_SECONDS = 3600
BATCH_SIZE = 20
MAX_ATTEMPTS = 5
# An instant notice that could not go out for this long is no longer news; it is dropped
# rather than delivered days late. Digests and confirmations are kept regardless.
INSTANT_MAX_AGE = timedelta(days=2)
# A digest lists at most this many records and then says how many more there were, so a
# CSV import of three hundred rows does not become a three-hundred-row email.
DIGEST_ROW_LIMIT = 50

CURRENCY_SYMBOLS = {c['code']: c['symbol'] for c in SUPPORTED_CURRENCIES}
ZERO_DECIMAL_CURRENCIES = {'HUF', 'JPY', 'KRW', 'ISK', 'CLP'}


def new_token() -> str:
    return secrets.token_urlsafe(32)


def link(path: str) -> str:
    return f'{APP_BASE_URL}{path}'


# --- formatting ---------------------------------------------------------------------------
# Mail cannot use the client's formatters, so this is the server's small copy of them:
# the account's currency label, its distance and volume units, nothing converted but the
# units themselves — the same rule the app follows.

def _money(amount, currency: str) -> str:
    value = float(amount or 0)
    decimals = 0 if currency in ZERO_DECIMAL_CURRENCIES else 2
    return f'{currency} {value:,.{decimals}f}'


def _number(value, decimals: int = 1) -> str:
    return f'{float(value):,.{decimals}f}'


def _profile(cur, user_id) -> dict:
    # users sits outside RLS, so this needs its own predicate rather than a policy.
    cur.execute(
        'SELECT username, email, currency, distance_unit, volume_unit FROM users WHERE id = %s;',
        (user_id,),
    )
    row = cur.fetchone() or {}
    return {
        'username': row.get('username') or row.get('email') or 'Your account',
        'email': row.get('email'),
        'currency': row.get('currency') or 'EUR',
        'distance_unit': row.get('distance_unit') if row.get('distance_unit') in DISTANCE_UNITS else 'km',
        'volume_unit': row.get('volume_unit') if row.get('volume_unit') in VOLUME_UNITS else 'l',
    }


def _session_rows(cur, vehicle_column: str, where: str, params: tuple) -> list[dict]:
    # vehicle_column comes from get_vehicle_column, the one name interpolated into SQL.
    cur.execute(
        f"""
        SELECT cs.id, cs.session_type, cs.start_time, cs.kwh, cs.fuel_liters, cs.cost_amount,
               cs.odometer, cs.source, cs.{vehicle_column} AS vehicle_id,
               COALESCE(v.name, CONCAT(v.make, ' ', v.model)) AS vehicle_name,
               p.name AS place_name
        FROM charging_sessions cs
        JOIN vehicles v ON v.id = cs.{vehicle_column}
        LEFT JOIN places p ON p.id = cs.place_id
        WHERE {where}
        ORDER BY cs.start_time, cs.id;
        """,
        params,
    )
    return cur.fetchall()


def _describe(row: dict, profile: dict) -> dict:
    """One record as the strings a mail shows, in the account's own units."""
    distance = DISTANCE_UNITS[profile['distance_unit']]
    volume = VOLUME_UNITS[profile['volume_unit']]
    tz = ZoneInfo(APP_TIMEZONE)
    if row['session_type'] == 'fueling':
        quantity = (
            f"{_number(float(row['fuel_liters']) * volume['per_litre'], 2)} {volume['short']}"
            if row.get('fuel_liters') is not None else None
        )
    else:
        quantity = f"{_number(row['kwh'], 2)} kWh" if row.get('kwh') is not None else None
    odometer = (
        f"{_number(float(row['odometer']) * distance['per_km'], 0)} {distance['short']}"
        if row.get('odometer') is not None else None
    )
    return {
        'kind': 'Fill-up' if row['session_type'] == 'fueling' else 'Charge',
        'vehicle': row['vehicle_name'],
        'when': row['start_time'].astimezone(tz).strftime('%Y-%m-%d %H:%M'),
        'where': row.get('place_name') or row.get('source') or None,
        'quantity': quantity,
        'cost': _money(row['cost_amount'], profile['currency']),
        'cost_value': float(row['cost_amount'] or 0),
        'odometer': odometer,
    }


# --- enqueueing (request side) --------------------------------------------------------------

def enqueue_session_notifications(db, user_id, session_id: int) -> None:
    """Queue an instant notice of one new session for every recipient who wants one.

    Runs inside the request's transaction, under a savepoint: a problem here is logged
    and undone on its own, and the record is saved regardless. A notification is never
    worth losing a charge over.
    """
    cur = db.cursor()
    cur.execute('SAVEPOINT notify_session;')
    try:
        rows = _session_rows(cur, get_vehicle_column(db), 'cs.id = %s AND cs.user_id = %s', (session_id, user_id))
        if not rows:
            cur.execute('RELEASE SAVEPOINT notify_session;')
            return
        session = rows[0]
        cur.execute(
            """
            SELECT id FROM notification_recipients
            WHERE user_id = %s AND mode = 'instant' AND confirmed_at IS NOT NULL
              AND (vehicle_ids IS NULL OR %s = ANY(vehicle_ids));
            """,
            (user_id, session['vehicle_id']),
        )
        recipients = cur.fetchall()
        if recipients:
            item = _describe(session, _profile(cur, user_id))
            for recipient in recipients:
                cur.execute(
                    "INSERT INTO notification_outbox (user_id, recipient_id, kind, payload) VALUES (%s, %s, 'session', %s);",
                    (user_id, recipient['id'], Json(item)),
                )
        cur.execute('RELEASE SAVEPOINT notify_session;')
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see docstring
        cur.execute('ROLLBACK TO SAVEPOINT notify_session;')
        log_event(logger, 'error', 'notification_enqueue_failed', user_id=user_id, session_id=session_id, error=str(exc))


def enqueue_system_email(cur, user_id, to: str, subject: str, text: str, html_body: str | None = None) -> None:
    """Queue one account mail — verification, reset, a notice — to a plain address.

    Account mail is queued from requests that have no tenant (sign-up, password reset)
    or an admin's (a feedback answer), so the row goes in through the outbox's
    `app.notifications` escape — set for this transaction only, so nothing else the
    request does afterwards inherits it.
    """
    cur.execute("SELECT set_config('app.notifications', 'on', true);")
    cur.execute(
        "INSERT INTO notification_outbox (user_id, kind, payload) VALUES (%s, 'system', %s);",
        (user_id, Json({'to': to, 'subject': subject, 'text': text, 'html': html_body})),
    )


def enqueue_confirmation(cur, user_id, recipient_id: int, token: str, account_name: str) -> None:
    cur.execute(
        "INSERT INTO notification_outbox (user_id, recipient_id, kind, payload) VALUES (%s, %s, 'confirm', %s);",
        (user_id, recipient_id, Json({'token': token, 'account': account_name})),
    )


def enqueue_test(cur, user_id, recipient_id: int, account_name: str) -> None:
    cur.execute(
        "INSERT INTO notification_outbox (user_id, recipient_id, kind, payload) VALUES (%s, %s, 'test', %s);",
        (user_id, recipient_id, Json({'account': account_name})),
    )


# --- rendering ------------------------------------------------------------------------------

def _wrap_html(body: str, footer: str) -> str:
    return (
        '<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;'
        'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2330;">'
        '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;">'
        f'{body}</div>'
        f'<p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#6b7280;">{footer}</p>'
        '</body></html>'
    )


def _detail_lines(item: dict) -> list[tuple[str, str]]:
    lines = [('Vehicle', item['vehicle']), ('When', item['when'])]
    if item.get('where'):
        lines.append(('Where', item['where']))
    if item.get('quantity'):
        lines.append(('Amount', item['quantity']))
    lines.append(('Cost', item['cost']))
    if item.get('odometer'):
        lines.append(('Odometer', item['odometer']))
    return lines


def render(kind: str, payload: dict, unsubscribe_url: str) -> tuple[str, str, str]:
    """(subject, text, html) for one outbox row."""
    esc = html.escape
    footer_text = f'You get these because someone added this address to a Mileage account. Unsubscribe: {unsubscribe_url}'
    footer_html = (
        'You get these because someone added this address to a Mileage account. '
        f'<a href="{esc(unsubscribe_url)}" style="color:#6b7280;">Unsubscribe</a>'
    )

    if kind == 'confirm':
        account = payload.get('account') or 'A Mileage account'
        url = link(f"/api/notifications/confirm?token={payload['token']}")
        subject = f'Confirm notifications from {account}'
        text = (
            f'{account} would like to email you whenever a charge or fill-up is recorded.\n\n'
            f'Confirm here: {url}\n\n'
            'If you do not know this account, ignore this message and nothing more will be sent.'
        )
        body = (
            f'<h2 style="margin:0 0 12px;font-size:18px;">Confirm notifications</h2>'
            f'<p><strong>{esc(account)}</strong> would like to email you whenever a charge or fill-up is recorded.</p>'
            f'<p><a href="{esc(url)}" style="display:inline-block;background:#1f6feb;color:#ffffff;'
            'padding:10px 16px;border-radius:8px;text-decoration:none;">Confirm</a></p>'
            '<p style="color:#6b7280;">If you do not know this account, ignore this message and nothing more will be sent.</p>'
        )
        footer = 'You received this because this address was entered on a Mileage account.'
        return subject, text, _wrap_html(body, esc(footer))

    if kind == 'test':
        account = payload.get('account') or 'your Mileage account'
        subject = 'Mileage test notification'
        text = f'This is a test from {account}. Notifications to this address are working.\n\n{footer_text}'
        body = (
            '<h2 style="margin:0 0 12px;font-size:18px;">Notifications are working</h2>'
            f'<p>This is a test from <strong>{esc(account)}</strong>.</p>'
        )
        return subject, text, _wrap_html(body, footer_html)

    if kind == 'session':
        subject = f"{payload['kind']} recorded: {payload['vehicle']}, {payload['cost']}"
        lines = _detail_lines(payload)
        text = '\n'.join(f'{label}: {value}' for label, value in lines)
        text += f"\n\nOpen Mileage: {link('/activity')}\n\n{footer_text}"
        rows = ''.join(
            f'<tr><td style="padding:4px 16px 4px 0;color:#6b7280;">{esc(label)}</td>'
            f'<td style="padding:4px 0;">{esc(value)}</td></tr>'
            for label, value in lines
        )
        body = (
            f'<h2 style="margin:0 0 12px;font-size:18px;">{esc(payload["kind"])} recorded</h2>'
            f'<table style="border-collapse:collapse;font-size:14px;">{rows}</table>'
            f'<p style="margin-top:20px;"><a href="{esc(link("/activity"))}">Open in Mileage</a></p>'
        )
        return subject, text, _wrap_html(body, footer_html)

    if kind == 'digest':
        items = payload['items']
        count = payload['count']
        period = payload['period']
        label = 'Weekly' if payload.get('mode') == 'weekly' else 'Daily'
        subject = f"{label} summary: {count} new record{'' if count == 1 else 's'}"
        text_lines = [f"{period}: {count} new record{'' if count == 1 else 's'}, {payload['total']} in total.", '']
        for item in items:
            parts = [item['when'], item['vehicle'], item['kind']]
            if item.get('quantity'):
                parts.append(item['quantity'])
            parts.append(item['cost'])
            if item.get('where'):
                parts.append(item['where'])
            text_lines.append(' · '.join(parts))
        if count > len(items):
            text_lines.append(f'… and {count - len(items)} more in Mileage.')
        text = '\n'.join(text_lines) + f"\n\nOpen Mileage: {link('/activity')}\n\n{footer_text}"
        rows = ''.join(
            '<tr>'
            f'<td style="padding:6px 8px 6px 0;white-space:nowrap;">{esc(item["when"])}</td>'
            f'<td style="padding:6px 8px;">{esc(item["vehicle"])}<br>'
            f'<span style="color:#6b7280;">{esc(item.get("where") or item["kind"])}</span></td>'
            f'<td style="padding:6px 8px;text-align:right;white-space:nowrap;">{esc(item.get("quantity") or "")}</td>'
            f'<td style="padding:6px 0 6px 8px;text-align:right;white-space:nowrap;">{esc(item["cost"])}</td>'
            '</tr>'
            for item in items
        )
        more = (
            f'<p style="color:#6b7280;">… and {count - len(items)} more in Mileage.</p>'
            if count > len(items) else ''
        )
        body = (
            f'<h2 style="margin:0 0 4px;font-size:18px;">{esc(period)}</h2>'
            f'<p style="margin:0 0 16px;color:#6b7280;">{count} new record{"" if count == 1 else "s"}, '
            f'{esc(payload["total"])} in total</p>'
            f'<table style="border-collapse:collapse;font-size:14px;width:100%;">{rows}</table>{more}'
            f'<p style="margin-top:20px;"><a href="{esc(link("/activity"))}">Open in Mileage</a></p>'
        )
        return subject, text, _wrap_html(body, footer_html)

    raise ValueError(f'Unknown notification kind: {kind}')


# --- worker ---------------------------------------------------------------------------------

def _connect():
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_APP_USER, password=DB_APP_PASS,
        cursor_factory=RealDictCursor,
    )
    cur = conn.cursor()
    cur.execute("SET app.notifications = 'on';")
    # The maintenance pass reads plan state for trial reminders; subscriptions take the
    # same admin escape the user-management pages use.
    cur.execute("SET app.admin = 'on';")
    conn.commit()
    return conn


def process_outbox(conn) -> int:
    """Send what is due. Returns how many rows were handled."""
    if mail_transport() is None:
        return 0
    cur = conn.cursor()
    cur.execute(
        """
        SELECT o.id, o.kind, o.payload, o.attempts, o.created_at,
               r.email, r.confirmed_at, r.unsubscribe_token
        FROM notification_outbox o
        LEFT JOIN notification_recipients r ON r.id = o.recipient_id
        WHERE o.status = 'pending' AND o.send_after <= NOW()
        ORDER BY o.id
        LIMIT %s
        FOR UPDATE OF o SKIP LOCKED;
        """,
        (BATCH_SIZE,),
    )
    rows = cur.fetchall()
    now = datetime.now(timezone.utc)
    for row in rows:
        try:
            # Account mail (verification, reset, notices) carries its own address and is
            # never subject to a subscriber's confirmation or unsubscribe.
            if row['kind'] == 'system':
                payload = row['payload']
                send_email(payload['to'], payload['subject'], payload['text'], payload.get('html'))
                cur.execute(
                    "UPDATE notification_outbox SET status = 'sent', sent_at = NOW(), attempts = attempts + 1 WHERE id = %s;",
                    (row['id'],),
                )
                continue
            # A recipient can be unconfirmed again only by being re-added; everything but
            # the confirmation itself waits for a yes.
            if row['kind'] != 'confirm' and row['confirmed_at'] is None:
                raise PermissionError('Recipient has not confirmed')
            if row['kind'] == 'session' and now - row['created_at'] > INSTANT_MAX_AGE:
                cur.execute(
                    "UPDATE notification_outbox SET status = 'failed', last_error = 'expired' WHERE id = %s;",
                    (row['id'],),
                )
                continue
            unsubscribe_url = link(f"/api/notifications/unsubscribe?token={row['unsubscribe_token']}")
            subject, text, body = render(row['kind'], row['payload'], unsubscribe_url)
            send_email(
                row['email'], subject, text, body,
                unsubscribe_url=None if row['kind'] == 'confirm' else unsubscribe_url,
            )
            cur.execute(
                "UPDATE notification_outbox SET status = 'sent', sent_at = NOW(), attempts = attempts + 1 WHERE id = %s;",
                (row['id'],),
            )
        except PermissionError as exc:
            cur.execute(
                "UPDATE notification_outbox SET status = 'failed', last_error = %s WHERE id = %s;",
                (str(exc), row['id']),
            )
        except Exception as exc:  # noqa: BLE001 - any transport error is retried
            attempts = row['attempts'] + 1
            if attempts >= MAX_ATTEMPTS:
                cur.execute(
                    "UPDATE notification_outbox SET status = 'failed', attempts = %s, last_error = %s WHERE id = %s;",
                    (attempts, str(exc)[:500], row['id']),
                )
            else:
                cur.execute(
                    """
                    UPDATE notification_outbox
                    SET attempts = %s, last_error = %s, send_after = NOW() + make_interval(mins => %s)
                    WHERE id = %s;
                    """,
                    (attempts, str(exc)[:500], 2 ** attempts, row['id']),
                )
            log_event(logger, 'warning', 'notification_send_failed', outbox_id=row['id'], attempts=attempts, error=str(exc))
    conn.commit()
    return len(rows)


def digest_boundaries(now_local: datetime) -> dict[str, datetime]:
    """The most recent moment each digest was due: today's (or yesterday's) send hour,
    and that hour on the most recent Monday."""
    today = now_local.replace(hour=DIGEST_HOUR, minute=0, second=0, microsecond=0)
    daily = today if now_local >= today else today - timedelta(days=1)
    monday = today - timedelta(days=today.weekday())
    weekly = monday if now_local >= monday else monday - timedelta(days=7)
    return {'daily': daily, 'weekly': weekly}


def build_digests(conn, now: datetime | None = None) -> int:
    """Queue every digest that has come due. Returns how many recipients were settled."""
    tz = ZoneInfo(APP_TIMEZONE)
    now_local = (now or datetime.now(timezone.utc)).astimezone(tz)
    boundaries = digest_boundaries(now_local)
    cur = conn.cursor()
    settled = 0
    for mode, boundary in boundaries.items():
        cur.execute(
            """
            SELECT id, user_id, vehicle_ids, COALESCE(last_digest_at, created_at) AS since
            FROM notification_recipients
            WHERE mode = %s AND confirmed_at IS NOT NULL
              AND COALESCE(last_digest_at, created_at) < %s
            FOR UPDATE SKIP LOCKED;
            """,
            (mode, boundary),
        )
        for recipient in cur.fetchall():
            # Sessions are tenant data: read them as that account and nobody else.
            cur.execute('SET app.user_id = %s;', (str(recipient['user_id']),))
            vehicle_column = get_vehicle_column(conn)
            where = 'cs.user_id = %s AND cs.created_at >= %s AND cs.created_at < %s'
            params = [recipient['user_id'], recipient['since'], boundary]
            if recipient['vehicle_ids']:
                where += f' AND cs.{vehicle_column} = ANY(%s)'
                params.append(recipient['vehicle_ids'])
            rows = _session_rows(cur, vehicle_column, where, tuple(params))
            if rows:
                profile = _profile(cur, recipient['user_id'])
                items = [_describe(row, profile) for row in rows]
                # The exact window, because a 07:00-to-07:00 day is not a calendar day and
                # calling it one would put a late-evening charge under the wrong date.
                start = recipient['since'].astimezone(tz)
                period = f"{start.strftime('%Y-%m-%d %H:%M')} – {boundary.strftime('%Y-%m-%d %H:%M')}"
                payload = {
                    'mode': mode,
                    'period': period,
                    'count': len(items),
                    'total': _money(sum(item['cost_value'] for item in items), profile['currency']),
                    'items': items[:DIGEST_ROW_LIMIT],
                }
                cur.execute(
                    "INSERT INTO notification_outbox (user_id, recipient_id, kind, payload) VALUES (%s, %s, 'digest', %s);",
                    (recipient['user_id'], recipient['id'], Json(payload)),
                )
            cur.execute('RESET app.user_id;')
            # Advanced even when nothing happened, so a quiet week is not re-read forever.
            cur.execute(
                'UPDATE notification_recipients SET last_digest_at = %s WHERE id = %s;',
                (boundary, recipient['id']),
            )
            settled += 1
    conn.commit()
    return settled


def run_worker(stop: threading.Event) -> None:
    if mail_transport() is None:
        log_event(logger, 'warning', 'notifications_mail_unconfigured',
                  detail='SMTP_HOST is not set; notifications are queued but not sent')
    conn = None
    next_maintenance = 0.0
    while not stop.is_set():
        try:
            if conn is None or conn.closed:
                conn = _connect()
            build_digests(conn)
            if time.monotonic() >= next_maintenance:
                run_maintenance(conn)
                next_maintenance = time.monotonic() + MAINTENANCE_SECONDS
            while process_outbox(conn) == BATCH_SIZE and not stop.is_set():
                pass
        except Exception as exc:  # noqa: BLE001 - the worker must outlive any one failure
            log_event(logger, 'error', 'notifications_worker_error', error=str(exc))
            try:
                if conn is not None:
                    conn.close()
            except Exception:  # noqa: BLE001
                pass
            conn = None
        stop.wait(POLL_SECONDS)
    if conn is not None:
        conn.close()


def run_maintenance(conn) -> None:
    # Imported here: account_lifecycle builds on this module's queue.
    try:
        from backend.account_lifecycle import maintenance
    except ModuleNotFoundError:
        from account_lifecycle import maintenance
    maintenance(conn)


def start_worker() -> threading.Event:
    stop = threading.Event()
    threading.Thread(target=run_worker, args=(stop,), name='notifications-worker', daemon=True).start()
    return stop
