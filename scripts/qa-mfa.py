#!/usr/bin/env python3
"""Sign-in hardening, against the running dev stack: the refresh cookie and two-step sign-in.

* The refresh token leaves only as an httpOnly, SameSite=Strict cookie — never in a body —
  and rotates; the token it replaced works for the grace period and nothing older does.
* TOTP: the server's codes match RFC 6238's own test vectors; setup needs the password;
  sign-in then takes a second step whose challenge is useless as an access token; a code
  cannot be replayed; recovery codes work once each; switching off needs password + code.
* The admin requirement cannot be switched on by an admin who would be locked out by it,
  and once on it keeps admins without two-step sign-in out of the admin pages.

    python3 scripts/qa-mfa.py

Same needs as qa-accounts.py: registration open, the dev containers running. The
accounts are removed and the site setting restored at the end, pass or fail.
"""

import base64
import hashlib
import hmac
import json
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = 'http://localhost:4646'
STAMP = str(int(time.time()))
PASSWORD = 'Qa-Test1234'
COOKIE = 'mileage_refresh'
FAILURES = []


def call(method, path, body=None, token=None, cookie=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if cookie:
        headers['Cookie'] = f'{COOKIE}={cookie}'
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read() or b'null'), response.headers
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b'null'), error.headers


def set_cookie(headers):
    """(value, attributes) of the refresh cookie a response set, or (None, '')."""
    for line in headers.get_all('set-cookie') or []:
        name, _, rest = line.partition('=')
        if name.strip() == COOKIE:
            value, _, attributes = rest.partition(';')
            return value.strip().strip('"'), attributes.lower()
    return None, ''


def sql(query):
    result = subprocess.run(
        ['docker', 'exec', 'mileage-postgres-dev', 'psql', '-U', 'ev_user', '-d', 'ev_charger', '-tAc', query],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def check(label, condition, detail=''):
    print(f"  {'ok  ' if condition else 'FAIL'} {label}{f' — {detail}' if detail and not condition else ''}")
    if not condition:
        FAILURES.append(label)


def totp(secret, step):
    """An independent implementation, so the server is not checked against itself."""
    key = base64.b32decode(secret + '=' * (-len(secret) % 8))
    mac = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    return str((struct.unpack('>I', mac[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000).zfill(6)


def register(name):
    email = f'qa-mfa-{name}-{STAMP}@example.com'
    status, body, _ = call('POST', '/auth/register', {
        'username': f'qa-mfa-{name}-{STAMP}', 'email': email, 'password': PASSWORD, 'terms_accepted': True,
    })
    if status == 403:
        print('Registration is closed on this instance; open it under Admin > Site settings to run this.')
        sys.exit(0)
    if status != 201:
        print(f'Could not register {email}: {status} {body}')
        sys.exit(1)
    return email


def main():
    emails = []
    setting_before = sql("SELECT value::text FROM site_settings WHERE key = 'require_admin_mfa'")
    try:
        print('TOTP implementation')
        vectors = subprocess.run(
            ['docker', 'exec', 'mileage-backend-dev', 'python', '-c',
             "import base64, mfa; s = base64.b32encode(b'12345678901234567890').decode();"
             "print(all(mfa.code_at(s, t // 30, 8) == c for t, c in "
             "[(59, '94287082'), (1111111109, '07081804'), (1234567890, '89005924'), (2000000000, '69279037')]))"],
            capture_output=True, text=True,
        )
        check('RFC 6238 test vectors', vectors.stdout.strip() == 'True', vectors.stderr.strip()[-200:])

        print('Refresh cookie')
        email = register('a')
        emails.append(email)
        status, session, headers = call('POST', '/auth/login', {'email': email, 'password': PASSWORD})
        token0, attributes = set_cookie(headers)
        check('sign-in succeeds', status == 200, status)
        check('no refresh token in the body', 'refresh_token' not in session)
        check('refresh cookie set', bool(token0))
        check('cookie is httpOnly', 'httponly' in attributes, attributes)
        check('cookie is SameSite=Strict', 'samesite=strict' in attributes, attributes)
        check('cookie is Secure', 'secure' in attributes, attributes)
        check('cookie is scoped to /api/auth', 'path=/api/auth' in attributes, attributes)
        access = session['access_token']

        status, body, headers = call('POST', '/auth/refresh', cookie=token0)
        token1, _ = set_cookie(headers)
        check('refresh by cookie', status == 200 and bool(body.get('access_token')), status)
        check('refresh rotates the cookie', token1 and token1 != token0)
        check('refresh body has no token', 'refresh_token' not in (body or {}))

        status, _, headers = call('POST', '/auth/refresh', cookie=token0)
        token2, _ = set_cookie(headers)
        check('replaced token honoured inside the grace period', status == 200, status)
        status, _, _ = call('POST', '/auth/refresh', cookie=token1)
        check('the token in between is still the previous one', status == 200, status)
        status, _, headers = call('POST', '/auth/refresh', cookie=token0)
        check('a token two rotations old is refused', status == 401, status)
        _, attributes = set_cookie(headers)
        check('a refused refresh clears the cookie', 'max-age=0' in attributes or 'expires=thu, 01 jan 1970' in attributes, attributes)

        sql(f"UPDATE user_sessions SET rotated_at = NOW() - INTERVAL '1 hour' WHERE user_id = (SELECT id FROM users WHERE email = '{email}')")
        status, body, headers = call('POST', '/auth/refresh', {'refresh_token': 'nonsense'})
        check('body token still accepted (legacy / scripts), wrong one refused', status == 401, status)
        _, _, headers = call('POST', '/auth/login', {'email': email, 'password': PASSWORD})
        token_b, _ = set_cookie(headers)
        status, body, headers = call('POST', '/auth/refresh', {'refresh_token': token_b})
        check('body token accepted and traded for a cookie', status == 200 and bool(set_cookie(headers)[0]), status)
        status, _, headers = call('POST', '/auth/logout', cookie=set_cookie(headers)[0])
        check('logout by cookie', status == 200)
        check('logout clears the cookie', 'max-age=0' in set_cookie(headers)[1] or 'expires=thu, 01 jan 1970' in set_cookie(headers)[1])

        print('Two-step sign-in')
        check('profile says off', call('GET', '/auth/me', token=access)[1].get('mfa_enabled') is False)
        status, _, _ = call('POST', '/auth/mfa/setup', {'password': 'wrong'}, token=access)
        check('setup needs the password', status == 401, status)
        status, setup, _ = call('POST', '/auth/mfa/setup', {'password': PASSWORD}, token=access)
        check('setup returns a secret and an otpauth URI', status == 200 and setup['otpauth_uri'].startswith('otpauth://totp/'), status)
        secret = setup['secret']
        status, _, _ = call('POST', '/auth/mfa/enable', {'code': '000000' if totp(secret, int(time.time()) // 30) != '000000' else '111111'}, token=access)
        check('a wrong code does not enable it', status == 400, status)

        # A second device, signed in before two-step sign-in; enabling signs it out.
        _, other, headers = call('POST', '/auth/login', {'email': email, 'password': PASSWORD})
        other_cookie, _ = set_cookie(headers)
        step = int(time.time()) // 30
        status, enabled, _ = call('POST', '/auth/mfa/enable', {'code': totp(secret, step)}, token=access)
        check('the right code enables it', status == 200, status)
        codes = enabled.get('recovery_codes') or []
        check('ten recovery codes', len(codes) == 10 and len(set(codes)) == 10)
        check('other devices signed out', call('POST', '/auth/refresh', cookie=other_cookie)[0] == 401)
        check('this device stays signed in', call('GET', '/auth/me', token=access)[0] == 200)
        check('profile says on', call('GET', '/auth/me', token=access)[1].get('mfa_enabled') is True)
        status, state, _ = call('GET', '/auth/mfa', token=access)
        check('status shows 10 codes left', status == 200 and state['recovery_codes_remaining'] == 10, state)
        stored = sql(f"SELECT COUNT(*) FROM mfa_recovery_codes WHERE user_id = (SELECT id FROM users WHERE email = '{email}') AND code_hash = '{codes[0]}'")
        check('recovery codes stored hashed', stored == '0')

        status, challenge, headers = call('POST', '/auth/login', {'email': email, 'password': PASSWORD})
        check('password step answers with a challenge', status == 200 and challenge.get('mfa_required') is True, challenge)
        check('no session before the code', 'access_token' not in challenge and not set_cookie(headers)[0])
        check('challenge is not an access token', call('GET', '/auth/me', token=challenge['mfa_token'])[0] == 401)
        status, _, _ = call('POST', '/auth/login/mfa', {'mfa_token': challenge['mfa_token'], 'code': totp(secret, step)})
        check('the code used to enable cannot be replayed', status == 401, status)
        status, signed, headers = call('POST', '/auth/login/mfa', {'mfa_token': challenge['mfa_token'], 'code': totp(secret, step + 1)})
        check('the next code signs in', status == 200 and bool(signed.get('access_token')) and bool(set_cookie(headers)[0]), status)
        status, _, _ = call('POST', '/auth/login/mfa', {'mfa_token': challenge['mfa_token'], 'code': totp(secret, step + 1)})
        check('and cannot be used twice', status == 401, status)
        status, _, _ = call('POST', '/auth/login/mfa', {'mfa_token': challenge['mfa_token'], 'code': codes[0].upper().replace('-', ' ')})
        check('a recovery code signs in (case and separators ignored)', status == 200, status)
        status, _, _ = call('POST', '/auth/login/mfa', {'mfa_token': challenge['mfa_token'], 'code': codes[0]})
        check('a recovery code works once', status == 401, status)
        check('a tampered challenge is refused', call('POST', '/auth/login/mfa', {'mfa_token': challenge['mfa_token'][:-2] + 'xx', 'code': codes[1]})[0] == 401)
        sql(f"DELETE FROM rate_limit_events WHERE key LIKE 'mfa:%'")
        for _ in range(5):
            call('POST', '/auth/login/mfa', {'mfa_token': challenge['mfa_token'], 'code': '123456'})
        status, _, _ = call('POST', '/auth/login/mfa', {'mfa_token': challenge['mfa_token'], 'code': codes[1]})
        check('wrong codes are limited per account', status == 429, status)
        sql(f"DELETE FROM rate_limit_events WHERE key LIKE 'mfa:%'")

        status, fresh, _ = call('POST', '/auth/mfa/recovery-codes', {'code': codes[1]}, token=access)
        check('new recovery codes need a code, and replace the old', status == 200 and len(fresh['recovery_codes']) == 10, status)
        status, _, _ = call('POST', '/auth/login/mfa', {'mfa_token': challenge['mfa_token'], 'code': codes[2]})
        check('old recovery codes stop working', status == 401, status)
        codes = fresh['recovery_codes']

        status, _, _ = call('POST', '/auth/mfa/disable', {'password': PASSWORD, 'code': '123456'}, token=access)
        check('switching off needs a valid code', status == 400, status)
        status, _, _ = call('POST', '/auth/mfa/disable', {'password': 'wrong', 'code': codes[0]}, token=access)
        check('switching off needs the password', status == 401, status)
        status, _, _ = call('POST', '/auth/mfa/disable', {'password': PASSWORD, 'code': codes[0]}, token=access)
        check('switching off with both', status == 200, status)
        status, session, _ = call('POST', '/auth/login', {'email': email, 'password': PASSWORD})
        check('sign-in is one step again', status == 200 and 'access_token' in session, status)

        print('Admin requirement')
        admin_email = register('admin')
        emails.append(admin_email)
        sql(f"UPDATE users SET role = 'admin' WHERE email = '{admin_email}'")
        _, admin, _ = call('POST', '/auth/login', {'email': admin_email, 'password': PASSWORD})
        admin_token = admin['access_token']
        status, _, _ = call('PATCH', '/admin/site-settings', {'require_admin_mfa': True}, token=admin_token)
        check('an admin without it cannot require it', status == 400, status)
        _, setup, _ = call('POST', '/auth/mfa/setup', {'password': PASSWORD}, token=admin_token)
        call('POST', '/auth/mfa/enable', {'code': totp(setup['secret'], int(time.time()) // 30)}, token=admin_token)
        status, _, _ = call('PATCH', '/admin/site-settings', {'require_admin_mfa': True}, token=admin_token)
        check('an admin with it can', status == 200, status)
        status, state, _ = call('GET', '/auth/mfa', token=admin_token)
        check('status says required', state.get('required') is True)
        status, _, _ = call('POST', '/auth/mfa/disable', {'password': PASSWORD, 'code': '000000'}, token=admin_token)
        check('a required admin cannot switch it off', status == 400, status)
        sql(f"UPDATE users SET role = 'admin' WHERE email = '{email}'")
        status, _, headers = call('GET', '/admin/users', token=access)
        check('an admin without it is kept out', status == 403 and headers.get('X-Mileage-Mfa-Required') == '1', status)
        status, users, _ = call('GET', '/admin/users', token=admin_token)
        check('an admin with it gets in, and sees who has it', status == 200 and any(u['email'] == admin_email and u['mfa_enabled'] for u in users), status)
        user_id = sql(f"SELECT id FROM users WHERE email = '{email}'")
        sql(f"UPDATE users SET role = 'user' WHERE email = '{email}'")
        _, setup, _ = call('POST', '/auth/mfa/setup', {'password': PASSWORD}, token=access)
        call('POST', '/auth/mfa/enable', {'code': totp(setup['secret'], int(time.time()) // 30)}, token=access)
        status, _, _ = call('POST', f'/admin/users/{user_id}/reset-mfa', token=admin_token)
        check('admin resets someone else\'s', status == 200, status)
        check('which switches it off and signs them out', sql(f"SELECT totp_enabled_at IS NULL FROM users WHERE id = {user_id}") == 't'
              and sql(f"SELECT COUNT(*) FROM user_sessions WHERE user_id = {user_id} AND revoked_at IS NULL") == '0')
    finally:
        if setting_before:
            sql(f"UPDATE site_settings SET value = '{setting_before}'::jsonb WHERE key = 'require_admin_mfa'")
        else:
            sql("DELETE FROM site_settings WHERE key = 'require_admin_mfa'")
        sql("DELETE FROM rate_limit_events WHERE key LIKE 'mfa%' OR key LIKE 'register%'")
        for address in emails:
            sql(f"DELETE FROM users WHERE email = '{address}'")

    print()
    if FAILURES:
        print(f'FAILED: {len(FAILURES)} check(s)')
        sys.exit(1)
    print('PASSED')


if __name__ == '__main__':
    main()
