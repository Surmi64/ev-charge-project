import csv
import io
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response

try:
    from backend.activity import get_activity_export_rows, get_activity_feed
    from backend.auth_utils import get_current_user_id
    from backend.billing import get_tenant_db, require_write_access
    from backend.db import get_vehicle_column
    from backend.vehicle_events import sync_expense_to_vehicle_event, sync_session_to_vehicle_event
    from backend.vehicle_rules import validate_session_for_vehicle, validate_vehicle_reference
except ModuleNotFoundError:
    from activity import get_activity_export_rows, get_activity_feed
    from auth_utils import get_current_user_id
    from billing import get_tenant_db, require_write_access
    from db import get_vehicle_column
    from vehicle_events import sync_expense_to_vehicle_event, sync_session_to_vehicle_event
    from vehicle_rules import validate_session_for_vehicle, validate_vehicle_reference

router = APIRouter(tags=['activity'])
CSV_COLUMNS = [
    'activity_type',
    'event_type',
    'category',
    'occurred_at',
    'ended_at',
    'amount',
    'currency',
    'vehicle_id',
    'vehicle_name',
    'title',
    'description',
    'energy_kwh',
    'fuel_liters',
    'odometer_km',
    'source',
    'battery_level_start',
    'battery_level_end',
    'place_name',
    'latitude',
    'longitude',
]


def parse_decimal(value: str | None, field_name: str, required: bool = False) -> float | None:
    if value is None or str(value).strip() == '':
        if required:
            raise HTTPException(status_code=400, detail=f'{field_name} is required')
        return None
    try:
        return float(str(value).strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f'{field_name} must be numeric') from exc


def parse_integer(value: str | None, field_name: str) -> int | None:
    if value is None or str(value).strip() == '':
        return None
    try:
        return int(str(value).strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f'{field_name} must be an integer') from exc


def parse_datetime_value(value: str | None, field_name: str, required: bool = False) -> datetime | None:
    if value is None or str(value).strip() == '':
        if required:
            raise HTTPException(status_code=400, detail=f'{field_name} is required')
        return None

    normalized = str(value).strip().replace('Z', '+00:00')
    try:
        return datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f'{field_name} must be a valid ISO timestamp') from exc


def parse_date_value(value: str | None, field_name: str, required: bool = False) -> date | None:
    if value is None or str(value).strip() == '':
        if required:
            raise HTTPException(status_code=400, detail=f'{field_name} is required')
        return None

    normalized = str(value).strip()
    try:
        return date.fromisoformat(normalized)
    except ValueError:
        pass

    # The CSV export writes occurred_at from a TIMESTAMPTZ, so expense rows come back
    # as full ISO timestamps. Accept those and keep the date part, otherwise an
    # exported file can never be re-imported.
    try:
        return datetime.fromisoformat(normalized.replace('Z', '+00:00')).date()
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f'{field_name} must use YYYY-MM-DD format or an ISO timestamp',
        ) from exc


def normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def resolve_vehicle_id(row: dict, db, user_id: str, required: bool) -> int | None:
    raw_vehicle_id = normalize_text(row.get('vehicle_id'))
    if raw_vehicle_id:
        vehicle_id = parse_integer(raw_vehicle_id, 'vehicle_id')
        validate_vehicle_reference(db, user_id, vehicle_id)
        return vehicle_id

    vehicle_name = normalize_text(row.get('vehicle_name'))
    if vehicle_name and vehicle_name.lower() != 'all vehicles':
        cur = db.cursor()
        cur.execute(
            """
            SELECT id
            FROM vehicles
            WHERE user_id = %s
              AND is_archived = FALSE
              AND (
                LOWER(COALESCE(name, '')) = LOWER(%s)
                OR LOWER(CONCAT(make, ' ', model)) = LOWER(%s)
              )
            ORDER BY is_default DESC, created_at DESC
            LIMIT 1;
            """,
            (user_id, vehicle_name, vehicle_name),
        )
        vehicle = cur.fetchone()
        if vehicle:
            return vehicle['id']
        raise HTTPException(status_code=400, detail=f'Unknown active vehicle: {vehicle_name}')

    if required:
        raise HTTPException(status_code=400, detail='vehicle_id or vehicle_name is required for session rows')
    return None


def import_activity_row(row: dict, db, user_id: str) -> str:
    activity_kind = (normalize_text(row.get('activity_type')) or '').lower()
    event_type = (normalize_text(row.get('event_type')) or '').lower()
    category = (normalize_text(row.get('category')) or event_type or '').lower()
    source = normalize_text(row.get('source')) or 'csv_import'
    description = normalize_text(row.get('description'))

    is_session = activity_kind == 'session' or event_type in {'charging', 'fueling'}
    cur = db.cursor()

    if is_session:
        session_type = 'fueling' if event_type == 'fueling' else 'charging'
        vehicle_id = resolve_vehicle_id(row, db, user_id, required=True)
        start_time = parse_datetime_value(row.get('occurred_at'), 'occurred_at', required=True)
        end_time = parse_datetime_value(row.get('ended_at'), 'ended_at')
        amount = parse_decimal(row.get('amount'), 'amount', required=True)
        energy_kwh = parse_decimal(row.get('energy_kwh'), 'energy_kwh')
        fuel_liters = parse_decimal(row.get('fuel_liters'), 'fuel_liters')
        odometer_km = parse_decimal(row.get('odometer_km'), 'odometer_km')
        battery_level_start = parse_integer(row.get('battery_level_start'), 'battery_level_start')
        battery_level_end = parse_integer(row.get('battery_level_end'), 'battery_level_end')

        validate_session_for_vehicle(db, user_id, vehicle_id, session_type, energy_kwh, fuel_liters)
        # Match sessions.py: the vehicle FK column name differs across migration states.
        vehicle_column = get_vehicle_column(db)
        cur.execute(
            f"""
            INSERT INTO charging_sessions (
                user_id, {vehicle_column}, session_type, start_time, end_time, kwh, fuel_liters,
                cost_amount, source, battery_level_start, battery_level_end, odometer, notes, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            RETURNING id;
            """,
            (
                user_id,
                vehicle_id,
                session_type,
                start_time,
                end_time,
                energy_kwh,
                fuel_liters,
                amount,
                source,
                battery_level_start,
                battery_level_end,
                odometer_km,
                description,
            ),
        )
        session_id = cur.fetchone()['id']
        sync_session_to_vehicle_event(db, session_id)
        return 'session'

    expense_category = category or 'other'
    vehicle_id = resolve_vehicle_id(row, db, user_id, required=False)
    expense_date = parse_date_value(row.get('occurred_at'), 'occurred_at', required=True)
    amount = parse_decimal(row.get('amount'), 'amount', required=True)
    currency = normalize_text(row.get('currency')) or 'HUF'

    cur.execute(
        'INSERT INTO expenses (user_id, vehicle_id, category, amount, currency, date, description) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id;',
        (user_id, vehicle_id, expense_category, amount, currency.upper(), expense_date.isoformat(), description),
    )
    expense_id = cur.fetchone()['id']
    sync_expense_to_vehicle_event(db, expense_id)
    return 'expense'


@router.get('/activity', response_model=list[dict])
def get_activity(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    activity_type: Optional[str] = Query(None),
    vehicle_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    user_id: str = Depends(get_current_user_id),
    db=Depends(get_tenant_db),
):
    return get_activity_feed(
        db, user_id, limit=limit, offset=offset,
        activity_type=activity_type, vehicle_id=vehicle_id, search=search,
    )


@router.get('/activity/export.csv')
def export_activity_csv(
    activity_type: Optional[str] = Query(None),
    vehicle_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    user_id: str = Depends(get_current_user_id),
    db=Depends(get_tenant_db),
):
    rows = get_activity_export_rows(db, user_id, activity_type=activity_type, vehicle_id=vehicle_id, search=search)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CSV_COLUMNS)
    writer.writeheader()

    for row in rows:
        writer.writerow(
            {
                'activity_type': row.get('activity_type'),
                'event_type': row.get('event_type'),
                'category': row.get('category'),
                'occurred_at': row['occurred_at'].isoformat() if row.get('occurred_at') else '',
                'ended_at': row['ended_at'].isoformat() if row.get('ended_at') else '',
                'amount': float(row.get('amount') or 0),
                'currency': row.get('currency') or 'HUF',
                'vehicle_id': row.get('vehicle_id') or '',
                'vehicle_name': row.get('vehicle_name') or '',
                'title': row.get('title') or '',
                'description': row.get('description') or '',
                'energy_kwh': float(row.get('energy_kwh') or 0) if row.get('energy_kwh') is not None else '',
                'fuel_liters': float(row.get('fuel_liters') or 0) if row.get('fuel_liters') is not None else '',
                'odometer_km': float(row.get('odometer_km') or 0) if row.get('odometer_km') is not None else '',
                'source': row.get('source') or '',
                'battery_level_start': row.get('battery_level_start') if row.get('battery_level_start') is not None else '',
                'battery_level_end': row.get('battery_level_end') if row.get('battery_level_end') is not None else '',
                'place_name': row.get('place_name') or '',
                'latitude': float(row['latitude']) if row.get('latitude') is not None else '',
                'longitude': float(row['longitude']) if row.get('longitude') is not None else '',
            }
        )

    content = output.getvalue()
    return Response(
        content=content,
        media_type='text/csv',
        headers={'Content-Disposition': 'attachment; filename=mileage-activity-export.csv'},
    )


@router.post('/activity/import-csv')
async def import_activity_csv(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
    _subscription=Depends(require_write_access),
    db=Depends(get_tenant_db),
):
    filename = (file.filename or '').lower()
    if not filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail='Only CSV files are supported')

    raw_content = await file.read()
    if not raw_content:
        raise HTTPException(status_code=400, detail='The uploaded CSV file is empty')

    try:
        decoded = raw_content.decode('utf-8-sig')
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail='CSV file must be UTF-8 encoded') from exc

    reader = csv.DictReader(io.StringIO(decoded))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail='CSV header row is missing')

    imported_sessions = 0
    imported_expenses = 0
    row_errors = []

    try:
        for index, row in enumerate(reader, start=2):
            if not any(normalize_text(value) for value in row.values()):
                continue
            try:
                imported_type = import_activity_row(row, db, user_id)
                if imported_type == 'session':
                    imported_sessions += 1
                else:
                    imported_expenses += 1
            except HTTPException as exc:
                row_errors.append({'row': index, 'detail': exc.detail})

        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        'message': 'CSV import finished',
        'imported_sessions': imported_sessions,
        'imported_expenses': imported_expenses,
        'errors': row_errors,
    }