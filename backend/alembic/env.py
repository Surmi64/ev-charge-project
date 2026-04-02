from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def get_database_url() -> str:
    direct_url = os.environ.get('DATABASE_URL') or os.environ.get('ALEMBIC_DATABASE_URL')
    if direct_url:
        return direct_url

    db_host = os.environ.get('DB_HOST', 'localhost')
    db_port = os.environ.get('DB_PORT', '5435')
    db_name = os.environ.get('DB_NAME', 'ev_charger')
    db_user = os.environ.get('DB_USER', 'ev_user')
    db_pass = os.environ.get('DB_PASS', 'ev_password')
    return f'postgresql+psycopg2://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}'


def run_migrations_offline() -> None:
    context.configure(
        url=get_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={'paramstyle': 'named'},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration['sqlalchemy.url'] = get_database_url()

    connectable = create_engine(
        configuration['sqlalchemy.url'],
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()