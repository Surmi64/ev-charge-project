
CREATE USER ev_user WITH PASSWORD 'ev_password';

CREATE DATABASE ev_charger;

GRANT ALL PRIVILEGES ON DATABASE ev_charger TO ev_user;
