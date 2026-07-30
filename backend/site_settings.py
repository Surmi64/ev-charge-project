"""Admin-editable site settings, with the environment as the fallback.

Every one of these used to be environment-only. Rather than move them wholesale into
the database, a value is read from `site_settings` if an admin has set one and falls
back to the deployed configuration otherwise. A fresh database therefore behaves
exactly as it did before anyone opens the admin page.

Adding a setting means adding an entry to SETTING_DEFINITIONS — no migration, because
the table is key/value.
"""

try:
    from backend.config import BILLING_CURRENCY, CURRENCY_CODES, TRIAL_DAYS
    from backend.db import table_exists
except ModuleNotFoundError:
    from config import BILLING_CURRENCY, CURRENCY_CODES, TRIAL_DAYS
    from db import table_exists


def _clamp_int(low, high):
    def coerce(value):
        number = int(value)
        if number < low or number > high:
            raise ValueError(f'Must be between {low} and {high}')
        return number
    return coerce


def _currency(value):
    code = str(value).strip().upper()
    if code not in CURRENCY_CODES:
        raise ValueError('Unknown currency code')
    return code


def _bool(value):
    if isinstance(value, bool):
        return value
    raise ValueError('Must be true or false')


def _notice(value):
    text = str(value or '').strip()
    if len(text) > 280:
        raise ValueError('Must be 280 characters or fewer')
    return text


# `env_default` is read lazily so a test or a re-import picks up the current config
# rather than whatever was set when this module first loaded.
SETTING_DEFINITIONS = {
    'registration_open': {
        'coerce': _bool,
        'env_default': lambda: True,
        'label': 'Open registration',
    },
    'trial_days': {
        'coerce': _clamp_int(0, 365),
        'env_default': lambda: TRIAL_DAYS,
        'label': 'Trial length in days',
    },
    'default_currency': {
        'coerce': _currency,
        'env_default': lambda: BILLING_CURRENCY,
        'label': 'Default currency for new accounts',
    },
    'maintenance_notice': {
        'coerce': _notice,
        'env_default': lambda: '',
        'label': 'Maintenance notice',
    },
}


def get_site_settings(db) -> dict:
    """Every setting, database value where present, environment default otherwise."""
    resolved = {key: definition['env_default']() for key, definition in SETTING_DEFINITIONS.items()}

    # Tolerates a database that predates the migration, in the same spirit as the
    # column_exists checks elsewhere.
    if not table_exists(db, 'site_settings'):
        return resolved

    cur = db.cursor()
    cur.execute('SELECT key, value FROM site_settings;')
    for row in cur.fetchall():
        definition = SETTING_DEFINITIONS.get(row['key'])
        if not definition:
            continue  # A setting removed from the code; leave the row alone.
        try:
            resolved[row['key']] = definition['coerce'](row['value'])
        except (TypeError, ValueError):
            # A stored value the current code cannot make sense of must not take the
            # whole app down; the environment default is always safe.
            continue
    return resolved


def get_site_setting(db, key: str):
    return get_site_settings(db)[key]


def save_site_settings(db, updates: dict, admin_user_id=None) -> dict:
    """Validate and persist a partial update. Returns the full resolved set."""
    from psycopg2.extras import Json

    cur = db.cursor()
    for key, raw in updates.items():
        definition = SETTING_DEFINITIONS.get(key)
        if not definition:
            raise ValueError(f'Unknown setting: {key}')
        value = definition['coerce'](raw)
        cur.execute(
            """
            INSERT INTO site_settings (key, value, updated_at, updated_by)
            VALUES (%s, %s, NOW(), %s)
            ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by;
            """,
            (key, Json(value), admin_user_id),
        )
    db.commit()
    return get_site_settings(db)
