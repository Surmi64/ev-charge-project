import os


def _get_bool_env(name: str, default: bool = False) -> bool:
	value = os.environ.get(name)
	if value is None:
		return default
	return value.strip().lower() in {'1', 'true', 'yes', 'on'}


# Optional: the one account auto-promoted to admin on sign-up. Empty by default so a
# stock deployment grants nobody elevated access.
BOOTSTRAP_ADMIN_EMAIL = os.environ.get('BOOTSTRAP_ADMIN_EMAIL', '').strip()

APP_ENV = os.environ.get('APP_ENV', 'development').strip().lower()
IS_DEVELOPMENT = APP_ENV in {'dev', 'development', 'local'}

SECRET_KEY = os.environ.get('JWT_SECRET_KEY', '').strip()
if not SECRET_KEY:
	if IS_DEVELOPMENT:
		SECRET_KEY = 'mileage-dev-insecure-secret-change-me'
	else:
		raise RuntimeError('JWT_SECRET_KEY must be set outside development environments')

# The old GarageOS default stays on this list: a deployment still carrying it must
# keep being rejected, not quietly pass because the product was renamed.
if not IS_DEVELOPMENT and SECRET_KEY in {'super-secret-key-123', 'garageos-dev-insecure-secret-change-me',
                                         'mileage-dev-insecure-secret-change-me', 'change-me-in-real-env'}:
	raise RuntimeError('JWT_SECRET_KEY must not use an insecure default value outside development')

ALGORITHM = 'HS256'
# Short-lived: a stolen access token is only good until the next refresh, and the
# client refreshes transparently (utils/api.js), so nobody notices the turnover.
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get('ACCESS_TOKEN_EXPIRE_MINUTES', '30'))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get('REFRESH_TOKEN_EXPIRE_DAYS', '30'))
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = int(os.environ.get('PASSWORD_RESET_TOKEN_EXPIRE_MINUTES', '30'))

# The refresh token travels in an httpOnly cookie, out of reach of page scripts, so an
# XSS bug can at worst use a 30 minute access token while the page is open — it cannot
# carry the 30 day session away. The path is the one the *browser* sees: nginx strips
# `/api` before the backend, so the backend's own `/auth/refresh` is `/api/auth/refresh`
# out there. Secure stays on even in development: browsers accept Secure cookies from
# http://localhost, and the dev server is reached over HTTPS.
REFRESH_COOKIE_NAME = os.environ.get('REFRESH_COOKIE_NAME', 'mileage_refresh')
REFRESH_COOKIE_PATH = os.environ.get('REFRESH_COOKIE_PATH', '/api/auth')
REFRESH_COOKIE_SECURE = os.environ.get('REFRESH_COOKIE_SECURE', 'true').strip().lower() not in {'0', 'false', 'no'}
# How long the token a rotation replaced is still honoured. Covers a refresh whose
# response never reached the browser (a reload mid-request), not a second user.
REFRESH_GRACE_SECONDS = int(os.environ.get('REFRESH_GRACE_SECONDS', '120'))

CORS_ALLOW_ORIGINS = [
	origin.strip()
	for origin in os.environ.get(
		'CORS_ALLOW_ORIGINS',
		'http://localhost:4242,http://127.0.0.1:4242,http://localhost:4646,http://127.0.0.1:4646',
	).split(',')
	if origin.strip()
]
CORS_ALLOW_CREDENTIALS = _get_bool_env('CORS_ALLOW_CREDENTIALS', True)

DB_HOST = os.environ.get('DB_HOST', 'localhost')
DB_PORT = os.environ.get('DB_PORT', 5432)
DB_NAME = os.environ.get('DB_NAME', 'ev_charger')
# Migrations run as the owner (DB_USER). The API connects as DB_APP_USER, which must
# be a non-superuser without BYPASSRLS or the row level security policies are skipped.
DB_USER = os.environ.get('DB_USER', 'postgres')
DB_PASS = os.environ.get('DB_PASS', 'password')
DB_APP_USER = os.environ.get('DB_APP_USER', DB_USER)
DB_APP_PASS = os.environ.get('DB_APP_PASS', DB_PASS)

# Where links in outgoing mail point (confirm, unsubscribe, open the record).
APP_BASE_URL = os.environ.get('APP_BASE_URL', 'http://localhost:4242').rstrip('/')

# Outgoing mail. With no SMTP_HOST, development logs each message instead of sending it,
# and any other environment leaves the queue untouched until a server is configured.
SMTP_HOST = os.environ.get('SMTP_HOST', '').strip()
SMTP_PORT = int(os.environ.get('SMTP_PORT', '587'))
SMTP_USERNAME = os.environ.get('SMTP_USERNAME', '').strip()
SMTP_PASSWORD = os.environ.get('SMTP_PASSWORD', '')
# 'starttls' (port 587), 'ssl' (port 465) or 'none' (a local relay only).
SMTP_SECURITY = os.environ.get('SMTP_SECURITY', 'starttls').strip().lower()
MAIL_FROM = os.environ.get('MAIL_FROM', 'Mileage <no-reply@localhost>').strip()

# The background worker that sends queued mail and builds the digests. On by default;
# turn it off in any extra API replica so only one process builds digests.
NOTIFICATIONS_WORKER_ENABLED = _get_bool_env('NOTIFICATIONS_WORKER_ENABLED', True)
# Digests go out at this local hour: daily ones every day, weekly ones on Mondays.
APP_TIMEZONE = os.environ.get('APP_TIMEZONE', 'Europe/Budapest').strip()
DIGEST_HOUR = int(os.environ.get('DIGEST_HOUR', '7'))

# Subscription plans. Amounts are in cents to avoid float rounding.
TRIAL_DAYS = int(os.environ.get('TRIAL_DAYS', '30'))
BILLING_CURRENCY = os.environ.get('BILLING_CURRENCY', 'EUR')
PLAN_PRICES = {
	'monthly': {'amount_cents': 500, 'currency': BILLING_CURRENCY, 'interval': 'month'},
	'yearly': {'amount_cents': 5000, 'currency': BILLING_CURRENCY, 'interval': 'year'},
}

# Offered in settings. Weighted towards Europe because that is where the product is
# sold, plus the global majors. Stored as a label on the account: amounts are never
# converted between them (see the 20260721_000009 migration).
SUPPORTED_CURRENCIES = [
	{'code': 'EUR', 'symbol': '\u20ac', 'name': 'Euro'},
	{'code': 'USD', 'symbol': '$', 'name': 'US dollar'},
	{'code': 'GBP', 'symbol': '\u00a3', 'name': 'British pound'},
	{'code': 'CHF', 'symbol': 'CHF', 'name': 'Swiss franc'},
	{'code': 'HUF', 'symbol': 'Ft', 'name': 'Hungarian forint'},
	{'code': 'PLN', 'symbol': 'z\u0142', 'name': 'Polish z\u0142oty'},
	{'code': 'CZK', 'symbol': 'K\u010d', 'name': 'Czech koruna'},
	{'code': 'RON', 'symbol': 'lei', 'name': 'Romanian leu'},
	{'code': 'SEK', 'symbol': 'kr', 'name': 'Swedish krona'},
	{'code': 'NOK', 'symbol': 'kr', 'name': 'Norwegian krone'},
	{'code': 'DKK', 'symbol': 'kr', 'name': 'Danish krone'},
	{'code': 'TRY', 'symbol': '\u20ba', 'name': 'Turkish lira'},
	{'code': 'CAD', 'symbol': 'CA$', 'name': 'Canadian dollar'},
	{'code': 'AUD', 'symbol': 'A$', 'name': 'Australian dollar'},
	{'code': 'NZD', 'symbol': 'NZ$', 'name': 'New Zealand dollar'},
	{'code': 'JPY', 'symbol': '\u00a5', 'name': 'Japanese yen'},
	{'code': 'CNY', 'symbol': '\u00a5', 'name': 'Chinese yuan'},
	{'code': 'INR', 'symbol': '\u20b9', 'name': 'Indian rupee'},
	{'code': 'BRL', 'symbol': 'R$', 'name': 'Brazilian real'},
	{'code': 'ZAR', 'symbol': 'R', 'name': 'South African rand'},
]
CURRENCY_CODES = {c['code'] for c in SUPPORTED_CURRENCIES}

# Exact factors from the canonical storage units.
DISTANCE_UNITS = {
	'km': {'label': 'Kilometres', 'short': 'km', 'per_km': 1.0},
	'mi': {'label': 'Miles', 'short': 'mi', 'per_km': 0.621371},
}
VOLUME_UNITS = {
	'l': {'label': 'Litres', 'short': 'L', 'per_litre': 1.0},
	'gal_us': {'label': 'Gallons (US)', 'short': 'gal', 'per_litre': 0.264172},
	'gal_uk': {'label': 'Gallons (UK)', 'short': 'gal', 'per_litre': 0.219969},
}

# Which colour palette an account sees. Ids only: the hues, the names shown in
# settings and the contrast measurements all live in frontend/src/utils/palette.js,
# and duplicating them here would mean two places to change and one of them wrong.
# What the server owes is a gate on what can be stored, so a typo cannot become a
# preference that silently reads back as the default.
THEME_PALETTES = {'midnight-grove', 'neon-drift', 'sunset-cruise', 'violet-hour', 'chrome-noir'}
DEFAULT_THEME_PALETTE = 'midnight-grove'
