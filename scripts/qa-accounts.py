#!/usr/bin/env python3
"""Account flows and tenant isolation, against the running dev stack.

Deeper than smoke-dev.sh: two throwaway accounts are created, and the script checks
that neither can reach the other's records, then walks the account lifecycle —
verification, sessions, export, feedback and its answer, scheduled deletion and its
cancellation, the login limit. Both accounts are removed at the end, pass or fail.

    python3 scripts/qa-accounts.py

Needs registration open (Admin > Site settings), like the smoke test, and the
containers from docker-compose-dev.yaml: the admin token and the mail it reads back
come from `docker exec`. Development only — it deletes the accounts it made.
"""

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = 'http://localhost:4646'
STAMP = str(int(time.time()))
PASSWORD = 'Qa-Test1234'
FAILURES = []


def call(method, path, body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read() or b'null')
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b'null')


def sql(query):
    result = subprocess.run(
        ['docker', 'exec', 'mileage-postgres-dev', 'psql', '-U', 'ev_user', '-d', 'ev_charger', '-tAc', query],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def admin_token():
    result = subprocess.run(
        ['docker', 'exec', 'mileage-backend-dev', 'python', '-c',
         "from auth_utils import create_access_token as c; print(c({'sub': '1'}))"],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def check(label, condition, detail=''):
    print(f"  {'ok  ' if condition else 'FAIL'} {label}{f' — {detail}' if detail and not condition else ''}")
    if not condition:
        FAILURES.append(label)


def register(name):
    email = f'qa-{name}-{STAMP}@example.com'
    status, body = call('POST', '/auth/register', {
        'username': f'qa-{name}-{STAMP}', 'email': email, 'password': PASSWORD, 'terms_accepted': True,
    })
    if status == 403:
        print('Registration is closed on this instance; open it under Admin > Site settings to run this.')
        sys.exit(0)
    if status != 201:
        print(f'Could not register {email}: {status} {body}')
        sys.exit(1)
    return email, sign_in(email)


def sign_in(email):
    """Log in, keeping the refresh token the server sets as a cookie beside the body."""
    request = urllib.request.Request(
        API + '/auth/login', data=json.dumps({'email': email, 'password': PASSWORD}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST',
    )
    with urllib.request.urlopen(request) as response:
        session = json.loads(response.read())
        for line in response.headers.get_all('set-cookie') or []:
            name, _, rest = line.partition('=')
            if name.strip() == 'mileage_refresh':
                session['refresh_token'] = rest.partition(';')[0]
    return session


def main():
    emails = []
    try:
        print('[1/5] Two accounts')
        email_a, session_a = register('a')
        email_b, session_b = register('b')
        emails += [email_a, email_b]
        token_a, token_b = session_a['access_token'], session_b['access_token']
        check('terms recorded on sign-up', sql(f"SELECT terms_version IS NOT NULL FROM users WHERE email = '{email_a}'") == 't')

        print('[2/5] Tenant isolation')
        status, vehicle = call('POST', '/vehicles', {
            'name': 'QA car', 'make': 'QA', 'model': 'Test', 'fuel_type': 'electric',
        }, token_a)
        check('A creates a vehicle', status in (200, 201), str(vehicle))
        vehicle_id = (vehicle or {}).get('vehicle_id')
        check('vehicle id returned', isinstance(vehicle_id, int), str(vehicle))
        _, b_vehicles = call('GET', '/vehicles', token=token_b)
        check("B does not see A's vehicle", all(v.get('id') != vehicle_id for v in (b_vehicles or [])))
        status, _ = call('POST', '/charging_sessions', {
            'vehicle_id': vehicle_id, 'start_time': '2026-01-01T10:00:00+00:00', 'kwh': 10, 'cost_amount': 1000,
            'source': 'QA',
        }, token_b)
        check("B cannot record on A's vehicle", status in (400, 403, 404), str(status))
        call('POST', '/feedback', {'kind': 'idea', 'subject': 'QA idea', 'body': 'An idea from account A.'}, token_a)
        _, b_feedback = call('GET', '/feedback', token=token_b)
        check("B does not see A's feedback", not b_feedback)
        _, export_b = call('GET', '/auth/export', token=token_b)
        check("B's export holds none of A's data", not export_b.get('vehicles') and not export_b.get('feedback'))

        print('[3/5] Verification and sessions')
        text = sql(
            "SELECT payload->>'text' FROM notification_outbox WHERE kind = 'system' "
            f"AND payload->>'to' = '{email_a}' AND payload->>'subject' LIKE 'Confirm%' ORDER BY id DESC LIMIT 1"
        )
        token = text.split('token=')[1].split()[0] if 'token=' in text else ''
        check('confirmation mail queued', bool(token))
        check('link confirms the address', call('POST', '/auth/verify-email', {'token': token})[0] == 200)
        check('link works only once', call('POST', '/auth/verify-email', {'token': token})[0] == 400)
        call('POST', '/auth/login', {'email': email_a, 'password': PASSWORD})
        _, sessions = call('GET', '/auth/sessions', token=token_a)
        check('session list marks this device', sum(1 for s in sessions if s['current']) == 1)
        _, revoked = call('POST', '/auth/sessions/revoke-others', token=token_a)
        check('other sessions signed out', revoked.get('count', 0) >= 1, str(revoked))

        print('[4/5] Feedback answered by an admin')
        call('POST', '/feedback', {'kind': 'complaint', 'subject': f'QA complaint {STAMP}',
                                   'body': 'A complaint from account A.'}, token_a)
        admin = admin_token()
        _, inbox = call('GET', '/admin/feedback?kind=complaint', token=admin)
        mine = [item for item in inbox if item['subject'] == f'QA complaint {STAMP}']
        check('complaint in the inbox with a deadline', bool(mine) and bool(mine[0]['due_at']))
        if mine:
            call('POST', f"/admin/feedback/{mine[0]['id']}/messages", {'body': 'QA answer.'}, admin)
            _, thread = call('GET', '/feedback', token=token_a)
            answered = [item for item in thread if item['kind'] == 'complaint']
            check('answer reaches the sender', answered and answered[0]['status'] == 'answered')

        print('[5/5] Deletion and the login limit')
        check('deletion needs the password', call('POST', '/auth/delete-account', {'password': 'wrong'}, token_a)[0] == 401)
        status, scheduled = call('POST', '/auth/delete-account', {'password': PASSWORD}, token_a)
        check('deletion scheduled', status == 200 and scheduled.get('deletion_scheduled_for'))
        check('every session revoked', call('POST', '/auth/refresh', {'refresh_token': session_a['refresh_token']})[0] == 401)
        _, again = call('POST', '/auth/login', {'email': email_a, 'password': PASSWORD})
        check('signing in shows the pending deletion', bool(again['user'].get('deletion_scheduled_for')))
        check('deletion can be cancelled', call('POST', '/auth/cancel-deletion', token=again['access_token'])[0] == 200)
        statuses = [call('POST', '/auth/login', {'email': email_b, 'password': 'wrong'})[0] for _ in range(9)]
        check('login limit kicks in', statuses[-1] == 429, str(statuses))
    finally:
        for email in emails:
            sql(f"DELETE FROM feedback WHERE contact_email = '{email}'")
            sql(f"DELETE FROM users WHERE email = '{email}'")
            sql(f"DELETE FROM rate_limit_events WHERE key LIKE '%{email}%'")
        print('  cleaned up', len(emails), 'accounts')

    print('PASSED' if not FAILURES else f'FAILED: {", ".join(FAILURES)}')
    sys.exit(1 if FAILURES else 0)


if __name__ == '__main__':
    main()
