import re

from fastapi import HTTPException

try:
    from backend.db import column_exists
except ModuleNotFoundError:
    from db import column_exists

ELECTRIC_FUEL_TYPES = {'electric'}
HYBRID_FUEL_TYPES = {'hybrid'}
COMBUSTION_FUEL_TYPES = {'petrol', 'diesel'}
HEX_COLOR_PATTERN = re.compile(r'^#[0-9A-Fa-f]{6}$')


def supports_charging(fuel_type: str | None) -> bool:
    return fuel_type in ELECTRIC_FUEL_TYPES or fuel_type in HYBRID_FUEL_TYPES


def supports_fueling(fuel_type: str | None) -> bool:
    return fuel_type in COMBUSTION_FUEL_TYPES or fuel_type in HYBRID_FUEL_TYPES


def normalize_vehicle_payload(vehicle):
    payload = vehicle.model_dump(exclude_unset=True)
    fuel_type = payload.get('fuel_type')

    for text_field in ('name', 'make', 'model', 'license_plate', 'color_hex', 'notes'):
        if text_field in payload and isinstance(payload[text_field], str):
            payload[text_field] = payload[text_field].strip() or None

    if payload.get('license_plate'):
        payload['license_plate'] = payload['license_plate'].upper()

    if payload.get('color_hex'):
        payload['color_hex'] = payload['color_hex'].upper()
        if not HEX_COLOR_PATTERN.match(payload['color_hex']):
            raise HTTPException(status_code=400, detail='Color must be a valid hex value like #A1B2C3')

    for numeric_field, label in (
        ('battery_capacity_kwh', 'Battery capacity'),
        ('tank_capacity_liters', 'Tank capacity'),
        ('starting_odometer_km', 'Starting odometer'),
    ):
        if numeric_field in payload and payload[numeric_field] is not None and float(payload[numeric_field]) < 0:
            raise HTTPException(status_code=400, detail=f'{label} cannot be negative')

    if fuel_type in COMBUSTION_FUEL_TYPES:
        payload['battery_capacity_kwh'] = None

    if fuel_type in ELECTRIC_FUEL_TYPES:
        payload['tank_capacity_liters'] = None

    return payload


def validate_vehicle_reference(db, user_id: str, vehicle_id: int, allow_archived: bool = False):
    cur = db.cursor()
    has_archive_support = column_exists(db, 'vehicles', 'is_archived')
    select_fields = 'id, fuel_type, is_archived' if has_archive_support else 'id, fuel_type, FALSE AS is_archived'
    cur.execute(f'SELECT {select_fields} FROM vehicles WHERE id = %s AND user_id = %s;', (vehicle_id, user_id))
    vehicle = cur.fetchone()

    if not vehicle:
        raise HTTPException(status_code=404, detail='Vehicle not found')

    if vehicle.get('is_archived') and not allow_archived:
        raise HTTPException(status_code=400, detail='Archived vehicles cannot be used for new records')

    return vehicle


def validate_session_for_vehicle(db, user_id: str, vehicle_id: int, session_type: str, kwh, fuel_liters, allow_archived: bool = False):
    vehicle = validate_vehicle_reference(db, user_id, vehicle_id, allow_archived=allow_archived)

    fuel_type = vehicle.get('fuel_type')

    if session_type == 'charging':
        if not supports_charging(fuel_type):
            raise HTTPException(status_code=400, detail='This vehicle type does not support charging sessions')
        if kwh is None or float(kwh) <= 0:
            raise HTTPException(status_code=400, detail='Charging sessions require a positive kWh value')
        if fuel_liters is not None:
            raise HTTPException(status_code=400, detail='Charging sessions cannot include fuel liters')

    elif session_type == 'fueling':
        if not supports_fueling(fuel_type):
            raise HTTPException(status_code=400, detail='This vehicle type does not support fueling sessions')
        if fuel_liters is None or float(fuel_liters) <= 0:
            raise HTTPException(status_code=400, detail='Fueling sessions require a positive fuel liters value')
        if kwh is not None:
            raise HTTPException(status_code=400, detail='Fueling sessions cannot include kWh')

    else:
        raise HTTPException(status_code=400, detail='Unsupported session type')

    return vehicle