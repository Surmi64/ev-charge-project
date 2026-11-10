"""Account mail and the housekeeping that runs around an account's life.

Verification, password reset and the notices an account holder must get (password
changed, address changed, deletion scheduled) are queued on the notification outbox
as 'system' mail, so they share its retries and never block the request.

`maintenance` runs hourly on the notification worker's connection:

* purges accounts whose 30-day deletion grace has run out — complaints survive, with
  the account detached, because their answer has to be kept;
* sends the trial reminders, 7 days and 1 day before the end, once each;
* prunes what is only kept for a while: the security log after a year, rate-limit
  attempts after a day, spent tokens after a week, sent mail after 90 days.
"""

import html
import logging
from datetime import datetime, timedelta, timezone

from psycopg2.extras import Json

try:
    from backend.auth_utils import create_refresh_token, hash_token
    from backend.logging_utils import log_event
    from backend.notifications import enqueue_system_email, link
except ModuleNotFoundError:
    from auth_utils import create_refresh_token, hash_token
    from logging_utils import log_event
    from notifications import enqueue_system_email, link

logger = logging.getLogger('mileage.lifecycle')

# Bumped whenever the terms change, so the record says which text a sign-up accepted.
TERMS_VERSION = '2026-11-draft'
VERIFY_TOKEN_MINUTES = 48 * 60
DELETION_GRACE_DAYS = 30
AUDIT_RETENTION_DAYS = 365
SENT_MAIL_RETENTION_DAYS = 90
TRIAL_REMINDER_DAYS = (7, 1)


def compose(title: str, paragraphs: list[str], button: tuple[str, str] | None = None,
            footer: str | None = None) -> tuple[str, str]:
    """(text, html) for a plain account mail: a heading, a few paragraphs, one button."""
    text_parts = [title, ''] + paragraphs
    if button:
        text_parts += ['', f'{button[0]}: {button[1]}']
    if footer:
        text_parts += ['', footer]
    esc = html.escape
    body = f'<h2 style="margin:0 0 12px;font-size:18px;">{esc(title)}</h2>'
    body += ''.join(f'<p>{esc(paragraph)}</p>' for paragraph in paragraphs)
    if button:
        body += (
            f'<p><a href="{esc(button[1])}" style="display:inline-block;background:#1f6feb;color:#ffffff;'
            f'padding:10px 16px;border-radius:8px;text-decoration:none;">{esc(button[0])}</a></p>'
        )
    html_doc = (
        '<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;'
        'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2330;">'
        f'<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;">{body}</div>'
        + (f'<p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#6b7280;">{esc(footer)}</p>' if footer else '')
        + '</body></html>'
    )
    return '\n'.join(text_parts), html_doc


def send_mail(cur, user_id, to: str, subject: str, title: str, paragraphs: list[str],
              button: tuple[str, str] | None = None) -> None:
    footer = 'Mileage account mail. You get these because this address belongs to a Mileage account.'
    text, html_doc = compose(title, paragraphs, button, footer)
    enqueue_system_email(cur, user_id, to, subject, text, html_doc)


def start_email_verification(cur, user_id, email: str) -> None:
    """Issue a fresh verification link for `email`, retiring any earlier one."""
    cur.execute(
        'UPDATE email_verification_tokens SET used_at = NOW() WHERE user_id = %s AND used_at IS NULL;',
        (user_id,),
    )
    token, expires_at = create_refresh_token(VERIFY_TOKEN_MINUTES)
    cur.execute(
        'INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at) VALUES (%s, %s, %s, %s);',
        (user_id, email, hash_token(token), expires_at),
    )
    send_mail(
        cur, user_id, email, 'Confirm your email address', 'Confirm your email address',
        ['Confirm that this address belongs to your Mileage account. The link works for 48 hours.'],
        ('Confirm address', link(f'/verify-email?token={token}')),
    )


def send_password_reset(cur, user_id, email: str, token: str, minutes: int) -> None:
    send_mail(
        cur, user_id, email, 'Reset your Mileage password', 'Reset your password',
        [
            f'Someone asked to reset the password of this Mileage account. The link works for {minutes} minutes and only once.',
            'If it was not you, ignore this message: your password stays as it is.',
        ],
        ('Choose a new password', link(f'/reset-password?token={token}')),
    )


def notify(cur, user_id, email: str, subject: str, paragraphs: list[str]) -> None:
    """A notice with no action: password changed, address changed, deletion scheduled."""
    send_mail(cur, user_id, email, subject, subject, paragraphs)


# --- maintenance ------------------------------------------------------------------------------

def _purge_accounts(cur) -> int:
    cur.execute('SELECT id, email FROM users WHERE deletion_scheduled_for IS NOT NULL AND deletion_scheduled_for <= NOW();')
    accounts = cur.fetchall()
    for account in accounts:
        # Ideas and bug reports go with the account; complaints stay, detached, because
        # the answer to a consumer complaint has to be kept (feedback.user_id SET NULL).
        cur.execute("DELETE FROM feedback WHERE user_id = %s AND kind <> 'complaint';", (account['id'],))
        cur.execute('DELETE FROM users WHERE id = %s;', (account['id'],))
        cur.execute(
            "INSERT INTO auth_audit_logs (email, event_type, status, details) VALUES (%s, 'account_deleted', 'success', %s);",
            (account['email'], Json({'user_id': account['id'], 'reason': 'self_service'})),
        )
    return len(accounts)


def _trial_reminders(cur) -> int:
    cur.execute(
        """
        SELECT s.user_id, s.trial_ends_at, u.email, u.lifecycle_emails
        FROM subscriptions s
        JOIN users u ON u.id = s.user_id
        WHERE s.status = 'trialing' AND u.role <> 'admin'
          AND s.trial_ends_at > NOW() AND s.trial_ends_at <= NOW() + INTERVAL '7 days'
          AND u.deletion_scheduled_for IS NULL;
        """
    )
    sent = 0
    now = datetime.now(timezone.utc)
    for row in cur.fetchall():
        left = row['trial_ends_at'] - now
        days = 1 if left <= timedelta(days=1) else 7
        key = f"trial-{days}:{row['trial_ends_at'].date().isoformat()}"
        if key in (row['lifecycle_emails'] or []):
            continue
        when = row['trial_ends_at'].date().isoformat()
        send_mail(
            cur, row['user_id'], row['email'],
            'Your Mileage trial ends tomorrow' if days == 1 else 'Your Mileage trial ends in a week',
            'Your trial is ending',
            [
                f'Your free trial ends on {when}. After that your records stay readable and exportable, '
                'but new entries need a plan.',
                'Plans are EUR 5 a month or EUR 50 a year.',
            ],
            ('See plans', link('/billing')),
        )
        cur.execute(
            "UPDATE users SET lifecycle_emails = lifecycle_emails || %s::jsonb WHERE id = %s;",
            (Json([key]), row['user_id']),
        )
        sent += 1
    return sent


def _prune(cur) -> None:
    cur.execute('DELETE FROM auth_audit_logs WHERE created_at < NOW() - make_interval(days => %s);', (AUDIT_RETENTION_DAYS,))
    cur.execute("DELETE FROM rate_limit_events WHERE created_at < NOW() - INTERVAL '1 day';")
    cur.execute("DELETE FROM password_reset_tokens WHERE expires_at < NOW() - INTERVAL '7 days';")
    cur.execute("DELETE FROM email_verification_tokens WHERE expires_at < NOW() - INTERVAL '7 days';")
    cur.execute(
        "DELETE FROM notification_outbox WHERE status <> 'pending' AND created_at < NOW() - make_interval(days => %s);",
        (SENT_MAIL_RETENTION_DAYS,),
    )


def maintenance(conn) -> None:
    cur = conn.cursor()
    purged = _purge_accounts(cur)
    reminders = _trial_reminders(cur)
    _prune(cur)
    conn.commit()
    if purged or reminders:
        log_event(logger, 'info', 'maintenance_done', purged_accounts=purged, trial_reminders=reminders)
