#!/usr/bin/env python3
"""Fleets, against the running dev stack: an owner, a manager, a driver and an outsider.

Checks what each one can reach inside the owner's workspace — above all that a driver
sees and records only the vehicles assigned to them, which the database enforces —
plus invitations by link and in-app, reassignment, removal and leaving. The four
accounts are removed at the end, pass or fail.

    python3 scripts/qa-fleet.py

Same needs as qa-accounts.py: registration open, the dev containers running.
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


def call(method, path, body=None, token=None, workspace=None, raw=False):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if workspace is not None:
        headers['X-Mileage-Workspace'] = str(workspace)
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as response:
            payload = json.loads(response.read() or b'null')
            return (response.status, payload, response.headers) if raw else (response.status, payload)
    except urllib.error.HTTPError as error:
        payload = json.loads(error.read() or b'null')
        return (error.code, payload, error.headers) if raw else (error.code, payload)


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


def register(name):
    email = f'qa-fleet-{name}-{STAMP}@example.com'
    status, body = call('POST', '/auth/register', {
        'username': f'qa-{name}-{STAMP}', 'email': email, 'password': PASSWORD, 'terms_accepted': True,
    })
    if status == 403:
        print('Registration is closed on this instance; open it under Admin > Site settings to run this.')
        sys.exit(0)
    if status != 201:
        print(f'Could not register {email}: {status} {body}')
        sys.exit(1)
    _, session = call('POST', '/auth/login', {'email': email, 'password': PASSWORD})
    return email, session['access_token'], session['user']['id']


def record(token, vehicle_id, workspace=None, kwh=10):
    return call('POST', '/charging_sessions', {
        'vehicle_id': vehicle_id, 'start_time': '2026-03-01T10:00:00+00:00', 'kwh': kwh, 'cost_amount': 1000,
        'source': 'QA',
    }, token, workspace)


def main():
    emails = []
    try:
        print('[1/6] Accounts and the owner\'s vehicles')
        owner_email, owner, owner_id = register('owner')
        manager_email, manager, manager_id = register('manager')
        driver_email, driver, driver_id = register('driver')
        outsider_email, outsider, _ = register('outsider')
        emails += [owner_email, manager_email, driver_email, outsider_email]
        vehicles = []
        for name in ('QA van one', 'QA van two'):
            _, created = call('POST', '/vehicles', {'name': name, 'make': 'QA', 'model': 'Van', 'fuel_type': 'electric'}, owner)
            vehicles.append(created['vehicle_id'])
        v1, v2 = vehicles
        check('owner records on both', record(owner, v1)[0] == 201 and record(owner, v2)[0] == 201)

        print('[2/6] Invitations')
        status, invite_d = call('POST', '/fleet/invitations', {'email': driver_email, 'role': 'driver', 'vehicle_ids': [v1]}, owner)
        check('driver invited, link returned', status == 201 and 'token=' in invite_d.get('link', ''), str(invite_d))
        token_d = invite_d['link'].split('token=')[1]
        check('own address refused', call('POST', '/fleet/invitations', {'email': owner_email, 'role': 'driver'}, owner)[0] == 400)
        check("someone else's vehicle refused",
              call('POST', '/fleet/invitations', {'email': outsider_email, 'role': 'driver', 'vehicle_ids': [999999]}, owner)[0] == 400)
        status, preview = call('GET', f'/fleet/invitations/preview?token={token_d}')
        check('preview names the owner', status == 200 and preview['owner_name'] == f'qa-owner-{STAMP}', str(preview))
        status, accepted = call('POST', '/fleet/invitations/accept', {'token': token_d}, driver)
        check('driver accepts by link', status == 200 and accepted['owner_id'] == owner_id, str(accepted))
        check('link works once', call('POST', '/fleet/invitations/accept', {'token': token_d}, driver)[0] == 404)

        call('POST', '/fleet/invitations', {'email': manager_email, 'role': 'manager'}, owner)
        _, overview = call('GET', '/fleet', token=manager)
        check('unconfirmed address sees no in-app invitation', overview['incoming'] == [])
        text = sql(
            "SELECT payload->>'text' FROM notification_outbox WHERE kind = 'system' "
            f"AND payload->>'to' = '{manager_email}' AND payload->>'subject' LIKE 'Confirm%' ORDER BY id DESC LIMIT 1"
        )
        call('POST', '/auth/verify-email', {'token': text.split('token=')[1].split()[0]})
        _, overview = call('GET', '/fleet', token=manager)
        check('confirmed address sees it', len(overview['incoming']) == 1, str(overview['incoming']))
        status, _ = call('POST', '/fleet/invitations/accept', {'invitation_id': overview['incoming'][0]['id']}, manager)
        check('manager accepts in the app', status == 200)
        _, overview = call('GET', '/fleet', token=owner)
        check('owner sees two members, nothing pending',
              len(overview['members']) == 2 and not overview['invitations'], str(overview))

        print('[3/6] The driver')
        _, context = call('GET', '/fleet/context', token=driver, workspace=owner_id)
        check('context says driver, with owner settings', context['role'] == 'driver' and context['preferences'] is not None and len(context['fleets']) == 1)
        _, seen = call('GET', '/vehicles', token=driver, workspace=owner_id)
        check('sees only the assigned vehicle', [v['id'] for v in seen] == [v1], str([v['id'] for v in seen]))
        _, feed = call('GET', '/activity', token=driver, workspace=owner_id)
        check('records only of that vehicle', feed and all(item['vehicle_id'] == v1 for item in feed))
        check('cannot record on the other', record(driver, v2, owner_id)[0] in (400, 403, 404))
        status, created = record(driver, v1, owner_id, kwh=22)
        check('records on the assigned one', status == 201, str(created))
        check('recorded under the owner, by the driver', sql(
            f"SELECT user_id = {owner_id} AND recorded_by = {driver_id} FROM charging_sessions WHERE id = {created['session_id']}"
        ) == 't')
        check('cannot add a vehicle', call('POST', '/vehicles', {'name': 'x', 'make': 'x', 'model': 'x', 'fuel_type': 'electric'}, driver, owner_id)[0] == 403)
        check('cannot see notification recipients', call('GET', '/notifications/recipients', token=driver, workspace=owner_id)[0] == 403)
        status, summary = call('GET', '/analytics/summary', token=driver, workspace=owner_id)
        check('analytics answer', status == 200)
        _, plan = call('GET', '/billing/me', token=driver, workspace=owner_id)
        check("plan is the owner's", plan.get('managed_by_fleet_owner') is True)
        _, own = call('GET', '/vehicles', token=driver)
        check('own workspace stays empty', own == [])

        print('[4/6] The manager, the owner\'s view, the outsider')
        _, seen = call('GET', '/vehicles', token=manager, workspace=owner_id)
        check('manager sees every vehicle', sorted(v['id'] for v in seen) == sorted(vehicles))
        status, added = call('POST', '/vehicles', {'name': 'QA van three', 'make': 'QA', 'model': 'Van', 'fuel_type': 'electric'}, manager, owner_id)
        check('manager adds a vehicle to the fleet', status == 201 and sql(
            f"SELECT user_id FROM vehicles WHERE id = {added['vehicle_id']}") == str(owner_id))
        _, feed = call('GET', '/activity', token=owner)
        authors = {item.get('recorded_by_name') for item in feed}
        check("owner's records name the driver", f'qa-driver-{STAMP}' in authors and None in authors, str(authors))
        status, _, headers = call('GET', '/vehicles', token=outsider, workspace=owner_id, raw=True)
        check('outsider refused, told to drop the workspace',
              status == 403 and headers.get('X-Mileage-Workspace-Invalid') == '1')

        print('[5/6] Reassigning and removing')
        call('PATCH', f'/fleet/members/{driver_id}', {'vehicle_ids': [v2]}, owner)
        _, seen = call('GET', '/vehicles', token=driver, workspace=owner_id)
        check('reassignment applies at once', [v['id'] for v in seen] == [v2])
        check('only the owner manages members', call('PATCH', f'/fleet/members/{driver_id}', {'vehicle_ids': [v1]}, manager)[0] == 404)
        call('DELETE', f'/fleet/members/{driver_id}', token=owner)
        check('removed driver is refused', call('GET', '/vehicles', token=driver, workspace=owner_id)[0] == 403)
        check('their records stay', sql(f'SELECT COUNT(*) FROM charging_sessions WHERE recorded_by = {driver_id}') == '1')

        print('[6/6] Leaving')
        check('manager leaves', call('DELETE', f'/fleet/memberships/{owner_id}', token=manager)[0] == 200)
        _, overview = call('GET', '/fleet', token=owner)
        check('fleet is empty again', overview['members'] == [])
    finally:
        for email in emails:
            sql(f"DELETE FROM users WHERE email = '{email}'")
            sql(f"DELETE FROM rate_limit_events WHERE key LIKE 'fleet-invite:%' AND key NOT IN (SELECT 'fleet-invite:' || id FROM users)")
        print('  cleaned up', len(emails), 'accounts')

    print('PASSED' if not FAILURES else f'FAILED: {", ".join(FAILURES)}')
    sys.exit(1 if FAILURES else 0)


if __name__ == '__main__':
    main()
