from fastapi import FastAPI, Depends, HTTPException, status, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from typing import List, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext

# Configuration
SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'super-secret-key-123')
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440 # 24 hours

DB_HOST = os.environ.get('DB_HOST', 'localhost')
DB_PORT = os.environ.get('DB_PORT', 5432)
DB_NAME = os.environ.get('DB_NAME', 'ev_charger')
DB_USER = os.environ.get('DB_USER', 'postgres')
DB_PASS = os.environ.get('DB_PASS', 'password')

app = FastAPI(title="EV Management API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

# Models
class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user: dict

class VehicleCreate(BaseModel):
    name: Optional[str] = None
    make: str
    model: str
    fuel_type: str = "electric" # 'electric', 'hybrid', 'diesel', 'petrol'
    year: Optional[int] = None
    license_plate: Optional[str] = None
    battery_capacity_kwh: Optional[float] = None
    is_default: bool = False

class VehicleUpdate(BaseModel):
    name: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    fuel_type: Optional[str] = None
    year: Optional[int] = None
    license_plate: Optional[str] = None
    battery_capacity_kwh: Optional[float] = None
    is_default: Optional[bool] = None

class ExpenseCreate(BaseModel):
    vehicle_id: Optional[int] = None
    category: str
    amount: float
    currency: str = "HUF"
    date: str
    description: Optional[str] = None

class ChargingSessionCreate(BaseModel):
    vehicle_id: int
    session_type: str = "charging" # 'charging', 'fueling'
    start_time: str
    end_time: Optional[str] = None
    kwh: Optional[float] = None
    fuel_liters: Optional[float] = None
    cost_huf: float
    source: str
    battery_level_start: Optional[int] = None
    battery_level_end: Optional[int] = None
    odometer: Optional[float] = None
    notes: Optional[str] = None

# Database
def get_db():
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS,
        cursor_factory=RealDictCursor
    )
    try:
        yield conn
    finally:
        conn.close()

# Auth Utilities
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user_id(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        return user_id
    except JWTError:
        raise credentials_exception

# --- AUTH ROUTES ---

@app.post("/auth/register", status_code=201)
def register(user: UserRegister, db=Depends(get_db)):
    pwd_hash = pwd_context.hash(user.password)
    cur = db.cursor()
    try:
        cur.execute(
            "INSERT INTO users (username, email, password_hash) VALUES (%s, %s, %s) RETURNING id;",
            (user.username, user.email, pwd_hash)
        )
        user_id = cur.fetchone()['id']
        db.commit()
        return {"message": "User registered successfully", "user_id": user_id}
    except psycopg2.IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already exists")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/auth/login")
def login(user: UserLogin, db=Depends(get_db)):
    cur = db.cursor()
    cur.execute("SELECT * FROM users WHERE username = %s OR email = %s;", (user.username, user.username))
    db_user = cur.fetchone()
    
    if not db_user or not pwd_context.verify(user.password, db_user['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    access_token = create_access_token(data={"sub": str(db_user['id'])})
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "user": {"id": db_user['id'], "username": db_user['username'], "email": db_user['email']}
    }

@app.get("/auth/me")
def get_profile(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    cur.execute("SELECT id, username, email, created_at, theme_mode FROM users WHERE id = %s;", (user_id,))
    user = cur.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.patch("/auth/me")
def update_profile(
    username: Optional[str] = Body(None),
    email: Optional[EmailStr] = Body(None),
    current_password: Optional[str] = Body(None),
    new_password: Optional[str] = Body(None),
    theme_mode: Optional[str] = Body(None),
    user_id: str = Depends(get_current_user_id),
    db=Depends(get_db)
):
    cur = db.cursor()
    
    # If updating sensitive info, verify password
    if username or email or new_password:
        if not current_password:
            raise HTTPException(status_code=400, detail="Current password required for this change")
        cur.execute("SELECT password_hash FROM users WHERE id = %s;", (user_id,))
        user_db = cur.fetchone()
        if not user_db or not pwd_context.verify(current_password, user_db['password_hash']):
            raise HTTPException(status_code=401, detail="Invalid current password")

    updates = []
    values = []
    
    if username:
        updates.append("username = %s")
        values.append(username)
    if email:
        updates.append("email = %s")
        values.append(email)
    if new_password:
        updates.append("password_hash = %s")
        values.append(pwd_context.hash(new_password))
    if theme_mode:
        updates.append("theme_mode = %s")
        values.append(theme_mode)

    if not updates:
        return {"message": "No changes requested"}

    values.append(user_id)
    query = f"UPDATE users SET {', '.join(updates)} WHERE id = %s"
    
    try:
        cur.execute(query, tuple(values))
        db.commit()
        return {"message": "Profile updated successfully"}
    except psycopg2.IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already exists")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

# --- BUSINESS LOGIC ROUTES ---

@app.get("/vehicles", response_model=List[dict])
def get_vehicles(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    cur.execute("SELECT * FROM vehicles WHERE user_id = %s;", (user_id,))
    return cur.fetchall()

@app.post("/vehicles", status_code=201)
def create_vehicle(vehicle: VehicleCreate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    try:
        if vehicle.is_default:
            cur.execute("UPDATE vehicles SET is_default = FALSE WHERE user_id = %s;", (user_id,))
        
        cur.execute(
            """INSERT INTO vehicles (user_id, name, make, model, fuel_type, year, license_plate, battery_capacity_kwh, is_default) 
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id;""",
            (user_id, vehicle.name, vehicle.make, vehicle.model, vehicle.fuel_type, vehicle.year, vehicle.license_plate, vehicle.battery_capacity_kwh, vehicle.is_default)
        )
        vehicle_id = cur.fetchone()['id']
        db.commit()
        return {"message": "Vehicle created", "vehicle_id": vehicle_id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/vehicles/{vehicle_id}")
def update_vehicle(vehicle_id: int, vehicle: VehicleUpdate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    # Check ownership
    cur.execute("SELECT id FROM vehicles WHERE id = %s AND user_id = %s;", (vehicle_id, user_id))
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail="Vehicle not found or unauthorized")

    if vehicle.is_default:
        cur.execute("UPDATE vehicles SET is_default = FALSE WHERE user_id = %s;", (user_id,))

    updates = []
    values = []
    for field, value in vehicle.model_dump(exclude_unset=True).items():
        updates.append(f"{field} = %s")
        values.append(value)
    
    if not updates:
        return {"message": "No changes requested"}
    
    values.append(vehicle_id)
    values.append(user_id)
    query = f"UPDATE vehicles SET {', '.join(updates)} WHERE id = %s AND user_id = %s"
    
    try:
        cur.execute(query, tuple(values))
        db.commit()
        return {"message": "Vehicle updated successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/vehicles/{vehicle_id}")
def delete_vehicle(vehicle_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    # Check ownership
    cur.execute("SELECT id FROM vehicles WHERE id = %s AND user_id = %s;", (vehicle_id, user_id))
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail="Vehicle not found or unauthorized")
    
    try:
        cur.execute("DELETE FROM vehicles WHERE id = %s AND user_id = %s;", (vehicle_id, user_id))
        db.commit()
        return {"message": "Vehicle deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/expenses", response_model=List[dict])
def get_expenses(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    cur.execute("SELECT * FROM expenses WHERE user_id = %s ORDER BY date DESC;", (user_id,))
    return cur.fetchall()

@app.post("/expenses", status_code=201)
def create_expense(expense: ExpenseCreate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    try:
        cur.execute(
            "INSERT INTO expenses (user_id, vehicle_id, category, amount, currency, date, description) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id;",
            (user_id, expense.vehicle_id, expense.category, expense.amount, expense.currency, expense.date, expense.description)
        )
        expense_id = cur.fetchone()['id']
        db.commit()
        return {"message": "Expense created", "expense_id": expense_id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/charging_sessions", response_model=List[dict])
def get_charging_sessions(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    cur.execute("SELECT * FROM charging_sessions WHERE user_id = %s ORDER BY start_time DESC;", (user_id,))
    return cur.fetchall()

@app.patch("/charging_sessions/{session_id}")
def update_charging_session(session_id: str, session: ChargingSessionCreate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    try:
        cur.execute(
            """
            UPDATE charging_sessions 
            SET vehicle_id_ref = %s, session_type = %s, start_time = %s, end_time = %s, 
                kwh = %s, fuel_liters = %s, cost_huf = %s, battery_level_start = %s, 
                battery_level_end = %s, source = %s, notes = %s
            WHERE id = %s AND user_id = %s;
            """,
            (
                session.vehicle_id, session.session_type, session.start_time, session.end_time, 
                session.kwh, session.fuel_liters, session.cost_huf, session.battery_level_start, 
                session.battery_level_end, session.source, session.notes, session_id, user_id
            )
        )
        db.commit()
        return {"status": "success"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/charging_sessions", status_code=201)
def add_charging_session(session: ChargingSessionCreate, user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    cur = db.cursor()
    try:
        cur.execute(
            """
            INSERT INTO charging_sessions 
            (user_id, vehicle_id_ref, session_type, start_time, end_time, kwh, fuel_liters,
             cost_huf, source, battery_level_start, battery_level_end,
             notes, odometer, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            RETURNING id;
            """,
            (
                user_id, session.vehicle_id, session.session_type, session.start_time, session.end_time, 
                session.kwh, session.fuel_liters, session.cost_huf, 
                session.source, session.battery_level_start, session.battery_level_end,
                session.notes, session.odometer
            )
        )
        db.commit()
        return {"status": "success"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
