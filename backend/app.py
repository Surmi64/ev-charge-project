from flask import Flask, request, jsonify
from flask_cors import CORS
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from datetime import datetime

app = Flask(__name__)
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

@app.route('/charging_sessions', methods=['POST'])
def add_charging_session():
    data = request.json
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
    
@app.route('/charging_sessions/<session_id>', methods=['PUT'])
def update_charging_session(session_id):
    data = request.json
    allowed_fields = [
        "license_plate", "start_time", "end_time", "kwh",
        "duration_seconds", "cost_huf", "price_per_kwh", "source",
        "currency", "invoice_id", "notes", "odometer", "provider",
        "city", "location_detail", "ac_or_dc", "kw"
    ]

    updates = {k: v for k, v in data.items() if k in allowed_fields}

    if not updates:
        return jsonify({"error": "No valid fields to update"}), 400

    set_clause = ", ".join([f"{col} = %s" for col in updates.keys()])
    values = list(updates.values())
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            f"UPDATE charging_sessions SET {set_clause} WHERE id = %s",
            values + [session_id]
        )
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({"error": "Record not found"}), 404
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

    return jsonify({"status": "success"}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5555, debug=False)

