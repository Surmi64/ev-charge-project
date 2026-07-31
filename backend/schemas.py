from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str
    user: dict


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    reset_token: str
    new_password: str


class UserRoleUpdateRequest(BaseModel):
    role: str


class SubscriptionUpdateRequest(BaseModel):
    # Either set a paid plan (which starts a fresh period) or force a status directly.
    plan: Optional[str] = None
    status: Optional[str] = None


class VehicleCreate(BaseModel):
    name: Optional[str] = None
    make: str
    model: str
    fuel_type: str = 'electric'
    year: Optional[int] = None
    license_plate: Optional[str] = None
    battery_capacity_kwh: Optional[float] = None
    tank_capacity_liters: Optional[float] = None
    starting_odometer_km: Optional[float] = None
    # None means unanswered, which the forecast treats differently from False.
    has_heat_pump: Optional[bool] = None
    color_hex: Optional[str] = None
    notes: Optional[str] = None
    is_default: bool = False


class VehicleUpdate(BaseModel):
    name: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    fuel_type: Optional[str] = None
    year: Optional[int] = None
    license_plate: Optional[str] = None
    battery_capacity_kwh: Optional[float] = None
    tank_capacity_liters: Optional[float] = None
    starting_odometer_km: Optional[float] = None
    has_heat_pump: Optional[bool] = None
    color_hex: Optional[str] = None
    notes: Optional[str] = None
    is_default: Optional[bool] = None
    is_archived: Optional[bool] = None


class ExpenseCreate(BaseModel):
    vehicle_id: Optional[int] = None
    category: str
    amount: float
    currency: str = 'HUF'
    date: str
    description: Optional[str] = None


class ExpenseUpdate(BaseModel):
    vehicle_id: Optional[int] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    date: Optional[str] = None
    description: Optional[str] = None


class RecurringExpenseCreate(BaseModel):
    vehicle_id: Optional[int] = None
    category: str
    amount: float
    currency: str = 'HUF'
    frequency: str
    next_due_date: str
    description: Optional[str] = None
    is_active: bool = True


class RecurringExpenseUpdate(BaseModel):
    vehicle_id: Optional[int] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    frequency: Optional[str] = None
    next_due_date: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class RecurringExpenseLogRequest(BaseModel):
    date: Optional[str] = None
    amount: Optional[float] = None
    description: Optional[str] = None


class ChargingSessionCreate(BaseModel):
    vehicle_id: int
    session_type: str = 'charging'
    start_time: str
    end_time: Optional[str] = None
    kwh: Optional[float] = None
    fuel_liters: Optional[float] = None
    cost_amount: float
    source: str
    battery_level_start: Optional[int] = None
    battery_level_end: Optional[int] = None
    odometer: Optional[float] = None
    notes: Optional[str] = None
    # Where it happened. All optional and independent: a fix with no name is still worth
    # keeping, and a name typed with no fix still identifies a known place.
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    location_accuracy_m: Optional[float] = Field(None, ge=0)
    place_name: Optional[str] = Field(None, max_length=120)