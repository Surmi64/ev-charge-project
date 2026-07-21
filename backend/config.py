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
		SECRET_KEY = 'garageos-dev-insecure-secret-change-me'
	else:
		raise RuntimeError('JWT_SECRET_KEY must be set outside development environments')

if not IS_DEVELOPMENT and SECRET_KEY in {'super-secret-key-123', 'garageos-dev-insecure-secret-change-me', 'change-me-in-real-env'}:
	raise RuntimeError('JWT_SECRET_KEY must not use an insecure default value outside development')

ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get('ACCESS_TOKEN_EXPIRE_MINUTES', '720'))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get('REFRESH_TOKEN_EXPIRE_DAYS', '30'))
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = int(os.environ.get('PASSWORD_RESET_TOKEN_EXPIRE_MINUTES', '30'))

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

# Subscription plans. Amounts are in cents to avoid float rounding.
TRIAL_DAYS = int(os.environ.get('TRIAL_DAYS', '30'))
BILLING_CURRENCY = os.environ.get('BILLING_CURRENCY', 'EUR')
PLAN_PRICES = {
	'monthly': {'amount_cents': 500, 'currency': BILLING_CURRENCY, 'interval': 'month'},
	'yearly': {'amount_cents': 5000, 'currency': BILLING_CURRENCY, 'interval': 'year'},
}