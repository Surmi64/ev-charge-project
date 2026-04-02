import calendar
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException

try:
    from backend.auth_utils import get_current_user_id
    from backend.db import get_db, table_exists
    from backend.schemas import ExpenseCreate, ExpenseUpdate, RecurringExpenseCreate, RecurringExpenseLogRequest, RecurringExpenseUpdate
    from backend.vehicle_rules import validate_vehicle_reference
    from backend.vehicle_events import delete_vehicle_event_by_legacy, sync_expense_to_vehicle_event
except ModuleNotFoundError:
    from auth_utils import get_current_user_id
    from db import get_db, table_exists
    from schemas import ExpenseCreate, ExpenseUpdate, RecurringExpenseCreate, RecurringExpenseLogRequest, RecurringExpenseUpdate
    from vehicle_rules import validate_vehicle_reference
    from vehicle_events import delete_vehicle_event_by_legacy, sync_expense_to_vehicle_event

router = APIRouter(tags=['expenses'])
RECURRING_FREQUENCIES = {'monthly': 1, 'quarterly': 3, 'yearly': 12}


def ensure_recurring_expense_table(db):
    if table_exists(db, 'recurring_expense_reminders'):
        return

    cur = db.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS recurring_expense_reminders (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
            category VARCHAR(50) NOT NULL,
            amount NUMERIC(12,2) NOT NULL,
            currency VARCHAR(10) NOT NULL DEFAULT 'HUF',
            frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
            next_due_date DATE NOT NULL,
            description TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            last_logged_date DATE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT recurring_expense_amount_chk CHECK (amount >= 0)
        );
        """
    )
    cur.execute('CREATE INDEX IF NOT EXISTS recurring_expense_user_due_idx ON recurring_expense_reminders (user_id, is_active, next_due_date ASC);')
    db.commit()


def normalize_frequency(value: str | None) -> str:
    normalized = (value or '').strip().lower()
    if normalized not in RECURRING_FREQUENCIES:
        raise HTTPException(status_code=400, detail='Frequency must be monthly, quarterly, or yearly')
    return normalized


def parse_iso_date(value: str | None, field_name: str) -> date:
    if not value:
        raise HTTPException(status_code=400, detail=f'{field_name} is required')
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f'{field_name} must use YYYY-MM-DD format') from exc


def add_months(value: date, month_count: int) -> date:
    month_index = value.month - 1 + month_count
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def get_next_due_date(value: date, frequency: str) -> date:
    return add_months(value, RECURRING_FREQUENCIES[frequency])


def validate_recurring_payload(payload: dict):
    if 'category' in payload and (payload['category'] or '').strip() == '':
        raise HTTPException(status_code=400, detail='Category is required')
    if 'category' in payload and payload['category'] is not None:
        payload['category'] = payload['category'].strip().lower()

    if 'currency' in payload and payload['currency'] is not None:
        payload['currency'] = payload['currency'].strip().upper() or 'HUF'

    if 'description' in payload and isinstance(payload['description'], str):
        payload['description'] = payload['description'].strip() or None

    if 'amount' in payload and payload['amount'] is not None and float(payload['amount']) < 0:
        raise HTTPException(status_code=400, detail='Amount cannot be negative')

    if 'frequency' in payload and payload['frequency'] is not None:
        payload['frequency'] = normalize_frequency(payload['frequency'])

    if 'next_due_date' in payload and payload['next_due_date'] is not None:
        payload['next_due_date'] = parse_iso_date(payload['next_due_date'], 'Next due date').isoformat()

    return payload


def serialize_reminder(reminder: dict) -> dict:
    return {
        **reminder,
        'amount': float(reminder['amount'] or 0),
        'next_due_date': reminder['next_due_date'].isoformat() if reminder.get('next_due_date') else None,
        'last_logged_date': reminder['last_logged_date'].isoformat() if reminder.get('last_logged_date') else None,
        'created_at': reminder['created_at'].isoformat() if reminder.get('created_at') else None,
        'updated_at': reminder['updated_at'].isoformat() if reminder.get('updated_at') else None,
    }


@router.get('/expenses', response_model=list[dict])
def get_expenses(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    cur.execute('SELECT * FROM expenses WHERE user_id = %s ORDER BY date DESC;', (user_id,))
    return cur.fetchall()


@router.get('/recurring-expenses', response_model=list[dict])
def get_recurring_expenses(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    ensure_recurring_expense_table(db)
    cur = db.cursor()
    cur.execute(
        """
        SELECT *
        FROM recurring_expense_reminders
        WHERE user_id = %s
        ORDER BY is_active DESC, next_due_date ASC, created_at DESC;
        """,
        (user_id,),
    )
    return [serialize_reminder(reminder) for reminder in cur.fetchall()]


@router.post('/expenses', status_code=201)
def create_expense(expense: ExpenseCreate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    try:
        if expense.vehicle_id is not None:
            validate_vehicle_reference(db, user_id, expense.vehicle_id)

        cur.execute(
            'INSERT INTO expenses (user_id, vehicle_id, category, amount, currency, date, description) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id;',
            (user_id, expense.vehicle_id, expense.category, expense.amount, expense.currency, expense.date, expense.description),
        )
        expense_id = cur.fetchone()['id']
        sync_expense_to_vehicle_event(db, expense_id)
        db.commit()
        return {'message': 'Expense created', 'expense_id': expense_id}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post('/recurring-expenses', status_code=201)
def create_recurring_expense(reminder: RecurringExpenseCreate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    ensure_recurring_expense_table(db)
    cur = db.cursor()
    try:
        payload = validate_recurring_payload(reminder.model_dump())
        if payload.get('vehicle_id') is not None:
            validate_vehicle_reference(db, user_id, payload['vehicle_id'])

        cur.execute(
            """
            INSERT INTO recurring_expense_reminders (
                user_id, vehicle_id, category, amount, currency, frequency,
                next_due_date, description, is_active
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *;
            """,
            (
                user_id,
                payload.get('vehicle_id'),
                payload.get('category'),
                payload.get('amount'),
                payload.get('currency', 'HUF'),
                payload.get('frequency'),
                payload.get('next_due_date'),
                payload.get('description'),
                payload.get('is_active', True),
            ),
        )
        created = serialize_reminder(cur.fetchone())
        db.commit()
        return created
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch('/expenses/{expense_id}')
def update_expense(expense_id: int, expense: ExpenseUpdate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    cur.execute('SELECT id, vehicle_id FROM expenses WHERE id = %s AND user_id = %s;', (expense_id, user_id))
    existing_expense = cur.fetchone()
    if not existing_expense:
        raise HTTPException(status_code=404, detail='Expense not found')

    next_values = expense.model_dump(exclude_unset=True)
    if 'vehicle_id' in next_values and next_values['vehicle_id'] is not None:
        validate_vehicle_reference(
            db,
            user_id,
            next_values['vehicle_id'],
            allow_archived=int(existing_expense['vehicle_id']) == int(next_values['vehicle_id']) if existing_expense['vehicle_id'] is not None else False,
        )

    updates = []
    values = []
    for field, value in next_values.items():
        updates.append(f'{field} = %s')
        values.append(value)

    if not updates:
        return {'message': 'No changes requested'}

    values.append(expense_id)
    values.append(user_id)

    try:
        cur.execute(f"UPDATE expenses SET {', '.join(updates)} WHERE id = %s AND user_id = %s;", tuple(values))
        sync_expense_to_vehicle_event(db, expense_id)
        db.commit()
        return {'message': 'Expense updated successfully'}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch('/recurring-expenses/{reminder_id}')
def update_recurring_expense(reminder_id: int, reminder: RecurringExpenseUpdate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    ensure_recurring_expense_table(db)
    cur = db.cursor()
    cur.execute('SELECT id, vehicle_id FROM recurring_expense_reminders WHERE id = %s AND user_id = %s;', (reminder_id, user_id))
    existing = cur.fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail='Recurring expense reminder not found')

    payload = validate_recurring_payload(reminder.model_dump(exclude_unset=True))
    if 'vehicle_id' in payload and payload['vehicle_id'] is not None:
        validate_vehicle_reference(
            db,
            user_id,
            payload['vehicle_id'],
            allow_archived=int(existing['vehicle_id']) == int(payload['vehicle_id']) if existing['vehicle_id'] is not None else False,
        )

    updates = []
    values = []
    for field, value in payload.items():
        updates.append(f'{field} = %s')
        values.append(value)

    if not updates:
        return {'message': 'No changes requested'}

    updates.append('updated_at = NOW()')
    values.extend([reminder_id, user_id])

    try:
        cur.execute(
            f"UPDATE recurring_expense_reminders SET {', '.join(updates)} WHERE id = %s AND user_id = %s RETURNING *;",
            tuple(values),
        )
        updated = serialize_reminder(cur.fetchone())
        db.commit()
        return updated
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post('/recurring-expenses/{reminder_id}/log-expense', status_code=201)
def log_recurring_expense(reminder_id: int, payload: RecurringExpenseLogRequest, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    ensure_recurring_expense_table(db)
    cur = db.cursor()
    cur.execute(
        'SELECT * FROM recurring_expense_reminders WHERE id = %s AND user_id = %s AND is_active = TRUE;',
        (reminder_id, user_id),
    )
    reminder = cur.fetchone()
    if not reminder:
        raise HTTPException(status_code=404, detail='Active recurring expense reminder not found')

    reminder_date = parse_iso_date(payload.date, 'Date') if payload.date else reminder['next_due_date']
    reminder_amount = float(payload.amount if payload.amount is not None else reminder['amount'])
    if reminder_amount < 0:
        raise HTTPException(status_code=400, detail='Amount cannot be negative')

    if reminder.get('vehicle_id') is not None:
        validate_vehicle_reference(db, user_id, reminder['vehicle_id'], allow_archived=False)

    description = (payload.description.strip() if payload.description else None) or reminder.get('description')
    next_due_date = get_next_due_date(reminder_date, reminder['frequency'])

    try:
        cur.execute(
            'INSERT INTO expenses (user_id, vehicle_id, category, amount, currency, date, description) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id;',
            (user_id, reminder['vehicle_id'], reminder['category'], reminder_amount, reminder['currency'], reminder_date.isoformat(), description),
        )
        expense_id = cur.fetchone()['id']
        sync_expense_to_vehicle_event(db, expense_id)
        cur.execute(
            """
            UPDATE recurring_expense_reminders
            SET next_due_date = %s, last_logged_date = %s, updated_at = NOW()
            WHERE id = %s AND user_id = %s
            RETURNING *;
            """,
            (next_due_date.isoformat(), reminder_date.isoformat(), reminder_id, user_id),
        )
        updated = serialize_reminder(cur.fetchone())
        db.commit()
        return {'expense_id': expense_id, 'reminder': updated}
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete('/expenses/{expense_id}')
def delete_expense(expense_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    try:
        cur.execute('DELETE FROM expenses WHERE id = %s AND user_id = %s;', (expense_id, user_id))
        if cur.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=404, detail='Expense not found')
        delete_vehicle_event_by_legacy(db, 'expense', expense_id)
        db.commit()
        return {'message': 'Expense deleted successfully'}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete('/recurring-expenses/{reminder_id}')
def delete_recurring_expense(reminder_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    ensure_recurring_expense_table(db)
    cur = db.cursor()
    try:
        cur.execute('DELETE FROM recurring_expense_reminders WHERE id = %s AND user_id = %s;', (reminder_id, user_id))
        if cur.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=404, detail='Recurring expense reminder not found')
        db.commit()
        return {'message': 'Recurring expense reminder deleted successfully'}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))