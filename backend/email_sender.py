"""Outgoing mail, behind one function so the transport can change in one place.

SMTP rather than a provider SDK: every transactional provider (Postmark, Brevo, SES)
offers an SMTP relay, so choosing one later is a matter of four environment variables.
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid

try:
    from backend.config import (
        IS_DEVELOPMENT, MAIL_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_SECURITY, SMTP_USERNAME,
    )
    from backend.logging_utils import log_event
except ModuleNotFoundError:
    from config import IS_DEVELOPMENT, MAIL_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_SECURITY, SMTP_USERNAME
    from logging_utils import log_event

logger = logging.getLogger('mileage.mail')
# The 'log' transport is how development reads its mail, so it must not be filtered out
# by a root logger left at WARNING.
logger.setLevel(logging.INFO)


def mail_transport() -> str | None:
    """'smtp', 'log' (development without a server), or None when mail cannot go out."""
    if SMTP_HOST:
        return 'smtp'
    if IS_DEVELOPMENT:
        return 'log'
    return None


def send_email(to: str, subject: str, text: str, html: str | None = None,
               unsubscribe_url: str | None = None) -> None:
    """Send one message. Raises on failure; the outbox decides whether to retry."""
    message = EmailMessage()
    message['From'] = MAIL_FROM
    message['To'] = to
    message['Subject'] = subject
    message['Message-ID'] = make_msgid(domain=MAIL_FROM.rsplit('@', 1)[-1].strip('> ') or None)
    if unsubscribe_url:
        # One-click unsubscribe in the mail client's own interface (RFC 8058), which the
        # larger providers now expect from anything sent in bulk.
        message['List-Unsubscribe'] = f'<{unsubscribe_url}>'
        message['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype='html')

    transport = mail_transport()
    if transport == 'log':
        log_event(logger, 'info', 'email_logged', to=to, subject=subject, body=text)
        return
    if transport is None:
        raise RuntimeError('No mail server is configured')

    if SMTP_SECURITY == 'ssl':
        server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20, context=ssl.create_default_context())
    else:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20)
    try:
        if SMTP_SECURITY == 'starttls':
            server.starttls(context=ssl.create_default_context())
        if SMTP_USERNAME:
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.send_message(message)
    finally:
        try:
            server.quit()
        except smtplib.SMTPException:
            pass
