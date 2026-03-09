from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import generate_password_hash, check_password_hash
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from datetime import datetime, timedelta

app = Flask(__name__)
# Add a secret key for JWT
app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', 'super-secret-key-123')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)
jwt = JWTManager(app)
CORS(app)

DB_HOST = os.environ.get('DB_HOST', 'localhost')
DB_PORT = os.environ.get('DB_PORT', 5432)
DB_NAME = os.environ.get('DB_NAME', 'ev_charger')
DB_USER = os.environ.get('DB_USER', 'postgres')
DB_PASS = os.environ.get('DB_PASS', 'password')

def get_db_connection():
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS
    )
    return conn

# --- AUTH ROUTES ---

@app.route('/auth/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    email = data.get('email')
    password = data.get('password')

    if not username or not email or not password:
        return jsonify({"error": "Missing username, email, or password"}), 400

    password_hash = generate_password_hash(password)

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO users (username, email, password_hash) VALUES (%s, %s, %s) RETURNING id;",
            (username, email, password_hash)
        )
        user_id = cur.fetchone()[0]
        conn.commit()
    except psycopg2.IntegrityError:
        conn.rollback()
        return jsonify({"error": "Username or email already exists"}), 409
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

    return jsonify({"message": "User registered successfully", "user_id": user_id}), 201

@app.route('/auth/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT * FROM users WHERE username = %s OR email = %s;", (username, username))
        user = cur.fetchone()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

    if user and check_password_hash(user['password_hash'], password):
        access_token = create_access_token(identity=str(user['id']))
        return jsonify(access_token=access_token, user={"id": user['id'], "username": user['username'], "email": user['email']}), 200
    else:
        return jsonify({"error": "Invalid username or password"}), 401

@app.route('/vehicles', methods=['GET', 'POST'])
@jwt_required()
def handle_vehicles():
    user_id = get_jwt_identity()
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT * FROM vehicles WHERE user_id = %s;", (user_id,))
            vehicles = cur.fetchall()
            return jsonify(vehicles), 200
        
        elif request.method == 'POST':
            data = request.json
            cur.execute(
                "INSERT INTO vehicles (user_id, make, model, year, license_plate, battery_capacity_kwh) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id;",
                (user_id, data.get('make'), data.get('model'), data.get('year'), data.get('license_plate'), data.get('battery_capacity_kwh'))
            )
            vehicle_id = cur.fetchone()['id']
            conn.commit()
            return jsonify({"message": "Vehicle created", "vehicle_id": vehicle_id}), 201
            
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/expenses', methods=['GET', 'POST'])
@jwt_required()
def handle_expenses():
    user_id = get_jwt_identity()
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if request.method == 'GET':
            cur.execute("SELECT * FROM expenses WHERE user_id = %s ORDER BY date DESC;", (user_id,))
            expenses = cur.fetchall()
            return jsonify(expenses), 200
        
        elif request.method == 'POST':
            data = request.json
            cur.execute(
                "INSERT INTO expenses (user_id, vehicle_id, category, amount, currency, date, description) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id;",
                (user_id, data.get('vehicle_id'), data.get('category'), data.get('amount'), data.get('currency', 'HUF'), data.get('date'), data.get('description'))
            )
            expense_id = cur.fetchone()['id']
            conn.commit()
            return jsonify({"message": "Expense created", "expense_id": expense_id}), 201
            
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/charging_sessions', methods=['GET'])
@jwt_required()
def get_charging_sessions():
    user_id = get_jwt_identity()
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT * FROM charging_sessions WHERE user_id = %s ORDER BY start_time DESC;", (user_id,))
        sessions = cur.fetchall()
        return jsonify(sessions), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()
    required_fields = ['vehicle_id', 'start_time', 'kwh', 'cost_huf', 'source']

    if not all(field in data for field in required_fields):
        return jsonify({"error": "Missing required fields"}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Parsing ISO format directly
        start_time = data['start_time']
        end_time = data.get('end_time')
        
        cur.execute(
            """
            INSERT INTO charging_sessions 
            (vehicle_id, license_plate, start_time, end_time, kwh, duration_seconds,
             cost_huf, price_per_kwh, source, currency,
             notes, odometer, provider, city, location_detail, ac_or_dc, kw, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            RETURNING id;
            """,
            (
                data.get('vehicle_id'),
                data.get('license_plate'),
                start_time,
                end_time,
                data.get('kwh'),
                data.get('duration_seconds'),
                data.get('cost_huf'),
                data.get('price_per_kwh'),
                data.get('source'),
                data.get('currency', 'HUF'),
                data.get('notes'),
                data.get('odometer'),
                data.get('provider'),
                data.get('city'),
                data.get('location_detail'),
                data.get('ac_or_dc'),
                data.get('kw'),
            )
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

    return jsonify({"status": "success"}), 201


@app.route('/charging_sessions/<int:session_id>', methods=['PUT', 'PATCH'])
def update_charging_session(session_id):
    data = request.json
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Build update query dynamically based on provided fields
        fields_to_update = []
        values = []
        for key in [
            'vehicle_id', 'license_plate', 'start_time', 'end_time', 'kwh', 
            'duration_seconds', 'cost_huf', 'price_per_kwh', 'source', 
            'currency', 'notes', 'odometer', 'provider', 'city', 
            'location_detail', 'ac_or_dc', 'kw', 'invoice_id', 'raw_payload'
        ]:
            if key in data:
                fields_to_update.append(f"{key} = %s")
                values.append(data[key])
        
        if not fields_to_update:
            return jsonify({"error": "No fields to update"}), 400
            
        values.append(session_id)
        query = f"UPDATE charging_sessions SET {', '.join(fields_to_update)} WHERE id = %s"
        cur.execute(query, tuple(values))
        conn.commit()
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

    return jsonify({"status": "success"}), 200

@app.route('/charging_sessions', methods=['GET'])
def get_charging_sessions():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Returning ISO format directly, using DB native TIMESTAMPTZ
        cur.execute("""
            SELECT 
                id, vehicle_id, license_plate, 
                start_time, end_time,
                kwh, duration_seconds, cost_huf, price_per_kwh, 
                source, currency, notes, odometer, provider, city, location_detail, ac_or_dc, kw
            FROM charging_sessions 
            ORDER BY start_time DESC
        """)
        rows = cur.fetchall()
        # Ensure datetimes are serialized to ISO string
        for row in rows:
            if row['start_time']:
                row['start_time'] = row['start_time'].isoformat()
            if row['end_time']:
                row['end_time'] = row['end_time'].isoformat()
    finally:
        cur.close()
        conn.close()

    return jsonify(rows), 200

@app.route('/charging_sessions/locations', methods=['GET'])
def get_locations():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT provider, city, location_detail 
            FROM charging_sessions 
            WHERE provider IS NOT NULL
            GROUP BY provider, city, location_detail
            ORDER BY provider, city, location_detail
        """)
        rows = cur.fetchall()
        
        mapping = {}
        for row in rows:
            p = row['provider']
            c = row['city']
            if p not in mapping:
                mapping[p] = {}
            if c:
                if c not in mapping[p]:
                    mapping[p][c] = []
                if row['location_detail'] and row['location_detail'] not in mapping[p][c]:
                    mapping[p][c].append(row['location_detail'])
                
    finally:
        cur.close()
        conn.close()

    return jsonify(mapping), 200

@app.route('/charging_sessions/notes', methods=['GET'])
def get_charging_session_notes():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT DISTINCT notes
            FROM charging_sessions
            WHERE notes IS NOT NULL AND TRIM(notes) <> ''
            ORDER BY notes ASC
        """)
        rows = cur.fetchall()
    finally:
        cur.close()
        conn.close()
    notes_list = [row['notes'] for row in rows]

    return jsonify(notes_list), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5555, debug=False)


@app.get("/analytics/summary")
def get_analytics_summary(current_user: User = Depends(get_current_user)):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Energy and Cost per Vehicle
        cur.execute("""
            SELECT v.name, v.license_plate, 
                   SUM(cs.energy_kwh) as total_energy, 
                   SUM(cs.cost_huf) as total_cost,
                   COUNT(cs.id) as session_count
            FROM vehicles v
            LEFT JOIN charging_sessions cs ON v.id = cs.vehicle_id
            WHERE v.user_id = %s
            GROUP BY v.id, v.name, v.license_plate
        """, (current_user.id,))
        vehicle_stats = cur.fetchall()

        # Average cost per kWh
        cur.execute("""
            SELECT AVG(cost_huf / NULLIF(energy_kwh, 0)) as avg_cost_per_kwh
            FROM charging_sessions cs
            JOIN vehicles v ON cs.vehicle_id = v.id
            WHERE v.user_id = %s
        """, (current_user.id,))
        avg_cost = cur.fetchone()

        # Weekly trend (last 8 weeks)
        cur.execute("""
            SELECT DATE_TRUNC('week', start_time) as week, 
                   SUM(energy_kwh) as energy,
                   SUM(cost_huf) as cost
            FROM charging_sessions cs
            JOIN vehicles v ON cs.vehicle_id = v.id
            WHERE v.user_id = %s AND start_time > NOW() - INTERVAL '8 weeks'
            GROUP BY week
            ORDER BY week ASC
        """, (current_user.id,))
        weekly_trend = cur.fetchall()

        return {
            "vehicle_stats": vehicle_stats,
            "avg_cost_per_kwh": avg_cost['avg_cost_per_kwh'] if avg_cost else 0,
            "weekly_trend": weekly_trend
        }
    finally:
        cur.close()
        conn.close()
