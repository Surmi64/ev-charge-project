# Database Migration Guide (v1 to v2)

This guide describes how to migrate the EV charging database from the legacy schema (Unix timestamps and unstructured notes) to the new v2 schema (Native `TIMESTAMPTZ` and structured columns for provider, city, and charger details).

## Prerequisites
- Access to the server running the Docker containers.
- The `migrate_v1_to_v2.sql` file must be present on the server or accessible to the `psql` command.

## Migration Steps

### 1. Backup (Safety First)
Before running the migration, it is highly recommended to create a manual backup of the current database:
```bash
docker exec ev_postgres pg_dump -U ev_user -d ev_charger > ev_charger_backup_$(date +%Y%m%d).sql
```

### 2. Execute Migration Script
Run the migration script directly into the running PostgreSQL container. This script will:
- Create a backup table `charging_sessions_backup_v1`.
- Update the schema with new columns (`provider`, `city`, `location_detail`, `ac_or_dc`, `kw`).
- Convert Unix BigInt timestamps to `TIMESTAMPTZ`.
- Parse existing data from the `notes` field into the new structured columns.

**Run this command from the project root:**
```bash
docker exec -i ev_postgres psql -U ev_user -d ev_charger < sql/migrate_v1_to_v2.sql
```

### 3. Verify Migration
After execution, check if the data is correctly populated:
```bash
docker exec -it ev_postgres psql -U ev_user -d ev_charger -c "SELECT id, start_time, provider, city FROM charging_sessions LIMIT 5;"
```

### 4. Rollback (If needed)
If something goes wrong, you can restore from the backup table created by the script:
```bash
docker exec -it ev_postgres psql -U ev_user -d ev_charger -c "DROP TABLE charging_sessions; ALTER TABLE charging_sessions_backup_v1 RENAME TO charging_sessions;"
```

## What changed?
| Feature | v1 (Legacy) | v2 (New) |
| :--- | :--- | :--- |
| **Timestamps** | BigInt (POSIX) | `TIMESTAMPTZ` (ISO Native) |
| **Location** | Mixed in `notes` | `provider`, `city`, `location_detail` |
| **Charger Info** | Manual entry | `ac_or_dc`, `kw` (Structured) |
| **Analytics** | Hard to query | Grafana-ready |
