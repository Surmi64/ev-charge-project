"""Attempt limits, kept in the database.

They used to live in a dict in process memory, which a restart emptied — so a
redeploy, or a crash an attacker could provoke, reset every counter — and which a
second API worker would not have shared. `rate_limit_events` is one row per attempt;
the worker prunes rows older than a day.

Keys are namespaced strings: `login:email:a@b.c`, `login:ip:1.2.3.4`, `register:ip:…`.
"""

from fastapi import HTTPException

WINDOW_SECONDS = 300
MAX_ATTEMPTS_PER_KEY = 8
# Per address, an IP sees every account tried from it — a shared office or a phone
# carrier's NAT can be many people, so the allowance is wider than per email.
MAX_ATTEMPTS_PER_IP = 30


def _normalize(value: str | None) -> str:
    return (value or 'unknown').strip().lower()


def count_recent(db, key: str, window_seconds: int) -> int:
    cur = db.cursor()
    cur.execute(
        'SELECT COUNT(*) AS n FROM rate_limit_events WHERE key = %s AND created_at > NOW() - make_interval(secs => %s);',
        (key, window_seconds),
    )
    return int(cur.fetchone()['n'])


def record(db, key: str) -> None:
    cur = db.cursor()
    cur.execute('INSERT INTO rate_limit_events (key) VALUES (%s);', (key,))


def enforce(db, key: str, limit: int, window_seconds: int, message: str) -> None:
    """Refuse with 429 once `key` has `limit` attempts inside the window; else count this one."""
    if count_recent(db, key, window_seconds) >= limit:
        raise HTTPException(status_code=429, detail=message)
    record(db, key)
    db.commit()


def _login_keys(email: str | None, ip: str | None) -> list[tuple[str, int]]:
    return [
        (f'login:email:{_normalize(email)}', MAX_ATTEMPTS_PER_KEY),
        (f'login:ip:{_normalize(ip)}', MAX_ATTEMPTS_PER_IP),
    ]


def check_login_rate_limit(db, email: str | None, ip: str | None = None):
    for key, limit in _login_keys(email, ip):
        if count_recent(db, key, WINDOW_SECONDS) >= limit:
            raise HTTPException(status_code=429, detail='Too many login attempts. Please wait a few minutes and try again.')


def register_login_failure(db, email: str | None, ip: str | None = None):
    for key, _limit in _login_keys(email, ip):
        record(db, key)


def clear_login_failures(db, email: str | None):
    cur = db.cursor()
    cur.execute('DELETE FROM rate_limit_events WHERE key = %s;', (f'login:email:{_normalize(email)}',))
