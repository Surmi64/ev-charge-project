
-- Users table for JWT authentication
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Cars table
CREATE TABLE IF NOT EXISTS vehicles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100), -- Customizable name for the car
    make VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    fuel_type VARCHAR(20) DEFAULT 'electric', -- 'electric', 'hybrid', 'diesel', 'petrol'
    year INTEGER,
    license_plate VARCHAR(20),
    battery_capacity_kwh NUMERIC(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Expenses table (Insurance, Maintenance, Parking, etc.)
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
    category VARCHAR(50) NOT NULL, -- e.g., 'Maintenance', 'Insurance', 'Parking', 'Toll', 'Fuel', 'Other'
    amount NUMERIC(15,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'HUF',
    date DATE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Link charging_sessions to user
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS vehicle_id_ref INTEGER REFERENCES vehicles(id) ON DELETE SET NULL;
