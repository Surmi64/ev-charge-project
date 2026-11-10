"""Two-step sign-in: time-based one-time codes (RFC 6238) and recovery codes.

Written out rather than pulled in as a dependency: TOTP is an HMAC over a counter and
a few lines of truncation, and every authenticator app (Google, Microsoft, 1Password,
Aegis, Bitwarden) speaks the same SHA-1 / 6 digits / 30 seconds profile used here.
`scripts/qa-mfa.py` checks the implementation against the RFC's own test vectors.

Sign-in with two steps works through a short-lived *challenge*: the password step
answers with a token signed under a key derived from, but different to, the access
token key, so the challenge can never be presented as an access token. Only the code
step opens a session.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from datetime import datetime, timedelta
from urllib.parse import quote

from jose import JWTError, jwt

try:
    from backend.config import ALGORITHM, SECRET_KEY
except ModuleNotFoundError:
    from config import ALGORITHM, SECRET_KEY

ISSUER = 'Mileage'
STEP_SECONDS = 30
DIGITS = 6
# One step either side: phones drift, and a code typed in its last second arrives in
# the next window.
DRIFT_STEPS = 1
RECOVERY_CODE_COUNT = 10
CHALLENGE_MINUTES = 5
_CHALLENGE_KEY = f'{SECRET_KEY}:mfa-challenge'
# No 0/O, 1/I/L: recovery codes are read off paper.
_RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'


def generate_secret() -> str:
    """160 random bits, base32 without padding — what authenticator apps expect."""
    return base64.b32encode(secrets.token_bytes(20)).decode('ascii').rstrip('=')


def _key(secret: str) -> bytes:
    padded = secret.upper() + '=' * (-len(secret) % 8)
    return base64.b32decode(padded)


def code_at(secret: str, step: int, digits: int = DIGITS, digest=hashlib.sha1) -> str:
    mac = hmac.new(_key(secret), struct.pack('>Q', step), digest).digest()
    offset = mac[-1] & 0x0F
    value = struct.unpack('>I', mac[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** digits)).zfill(digits)


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // STEP_SECONDS)


def verify_code(secret: str, code: str, last_step: int | None, now: float | None = None) -> int | None:
    """The time step `code` belongs to, or None.

    A step at or before `last_step` has already been used to sign in and is refused,
    so a code read over someone's shoulder is worth nothing once it has been typed.
    """
    candidate = ''.join(ch for ch in (code or '') if ch.isdigit())
    if len(candidate) != DIGITS:
        return None
    step = current_step(now)
    for offset in range(-DRIFT_STEPS, DRIFT_STEPS + 1):
        attempt = step + offset
        if last_step is not None and attempt <= last_step:
            continue
        if hmac.compare_digest(code_at(secret, attempt), candidate):
            return attempt
    return None


def provisioning_uri(secret: str, account_label: str) -> str:
    label = quote(f'{ISSUER}:{account_label}')
    return f'otpauth://totp/{label}?secret={secret}&issuer={quote(ISSUER)}&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}'


# --- recovery codes -----------------------------------------------------------------------

def normalize_recovery_code(code: str) -> str:
    return ''.join(ch for ch in (code or '').lower() if ch.isalnum())


def hash_recovery_code(code: str) -> str:
    return hashlib.sha256(normalize_recovery_code(code).encode('ascii')).hexdigest()


def generate_recovery_codes() -> list[str]:
    """Ten codes of ten characters (about 49 bits each), shown as xxxxx-xxxxx."""
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = ''.join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(10))
        codes.append(f'{raw[:5]}-{raw[5:]}')
    return codes


def looks_like_recovery_code(code: str) -> bool:
    return len(normalize_recovery_code(code)) == 10 and not normalize_recovery_code(code).isdigit()


def replace_recovery_codes(cur, user_id) -> list[str]:
    codes = generate_recovery_codes()
    cur.execute('DELETE FROM mfa_recovery_codes WHERE user_id = %s;', (user_id,))
    for code in codes:
        cur.execute(
            'INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (%s, %s);',
            (user_id, hash_recovery_code(code)),
        )
    return codes


def use_recovery_code(cur, user_id, code: str) -> bool:
    cur.execute(
        """
        UPDATE mfa_recovery_codes SET used_at = NOW()
        WHERE id = (
            SELECT id FROM mfa_recovery_codes
            WHERE user_id = %s AND code_hash = %s AND used_at IS NULL
            LIMIT 1
        )
        RETURNING id;
        """,
        (user_id, hash_recovery_code(code)),
    )
    return cur.fetchone() is not None


def remaining_recovery_codes(cur, user_id) -> int:
    cur.execute('SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id = %s AND used_at IS NULL;', (user_id,))
    return int(cur.fetchone()['n'])


def check_second_factor(cur, user: dict, code: str) -> str | None:
    """Accept an authenticator code or an unused recovery code for `user`.

    `user` needs id, totp_secret and totp_last_step. Returns which kind matched
    ('totp' or 'recovery'), or None. A matched TOTP step is recorded so it cannot be
    used a second time.
    """
    if not user.get('totp_secret'):
        return None
    step = verify_code(user['totp_secret'], code, user.get('totp_last_step'))
    if step is not None:
        cur.execute('UPDATE users SET totp_last_step = %s WHERE id = %s;', (step, user['id']))
        return 'totp'
    if looks_like_recovery_code(code) and use_recovery_code(cur, user['id'], code):
        return 'recovery'
    return None


# --- sign-in challenge ----------------------------------------------------------------------

def create_challenge(user_id) -> str:
    now = datetime.utcnow()
    return jwt.encode(
        {'sub': str(user_id), 'typ': 'mfa', 'iat': now, 'exp': now + timedelta(minutes=CHALLENGE_MINUTES)},
        _CHALLENGE_KEY,
        algorithm=ALGORITHM,
    )


def read_challenge(token: str) -> str | None:
    try:
        payload = jwt.decode(token, _CHALLENGE_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    if payload.get('typ') != 'mfa':
        return None
    return payload.get('sub')
