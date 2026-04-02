from collections import defaultdict, deque
from time import monotonic

from fastapi import HTTPException

WINDOW_SECONDS = 300
MAX_ATTEMPTS_PER_KEY = 8

_attempts = defaultdict(deque)


def _normalize_key(value: str | None) -> str:
    return (value or 'unknown').strip().lower()


def _prune(queue: deque, now: float):
    while queue and now - queue[0] > WINDOW_SECONDS:
        queue.popleft()


def check_login_rate_limit(email: str | None):
    now = monotonic()
    key = _normalize_key(email)
    queue = _attempts[key]
    _prune(queue, now)
    if len(queue) >= MAX_ATTEMPTS_PER_KEY:
        raise HTTPException(status_code=429, detail='Too many login attempts. Please wait a few minutes and try again.')


def register_login_failure(email: str | None):
    now = monotonic()
    key = _normalize_key(email)
    queue = _attempts[key]
    _prune(queue, now)
    queue.append(now)


def clear_login_failures(email: str | None):
    key = _normalize_key(email)
    _attempts.pop(key, None)