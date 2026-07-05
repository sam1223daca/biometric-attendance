import sqlite3
import os
import math
from datetime import datetime

DATABASE_FILE = "attendance.db"

def get_db_connection():
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create Users Table (Stores user metadata and the registered photo ONLY)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role TEXT CHECK(role IN ('Admin', 'Teacher', 'Employee', 'Student', 'Worker')) NOT NULL,
        department TEXT, -- Department and Semester of NIELIT Agartala
        photo TEXT NOT NULL, -- Base64 encoded profile image
        approved INTEGER DEFAULT 0, -- 0 for pending, 1 for approved
        latitude REAL, -- Geolocation coordinate where user enrolled
        longitude REAL, -- Geolocation coordinate where user enrolled
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    # Migration to add department column if it doesn't exist
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN department TEXT;")
        conn.commit()
    except sqlite3.OperationalError:
        pass
        
    # Migration to add approved column if it doesn't exist
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN approved INTEGER DEFAULT 0;")
        # Set existing users to approved = 1 so we don't lock out registered accounts
        cursor.execute("UPDATE users SET approved = 1;")
        conn.commit()
    except sqlite3.OperationalError:
        pass
        
    # Migration to add latitude and longitude columns if they don't exist
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN latitude REAL;")
        conn.commit()
    except sqlite3.OperationalError:
        pass
        
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN longitude REAL;")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # Update existing null coordinate entries to NIELIT Agartala coordinates
    try:
        cursor.execute("UPDATE users SET latitude = 23.8931, longitude = 91.2721 WHERE latitude IS NULL;")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    
    # Create WebAuthn Credentials Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        credential_id TEXT UNIQUE NOT NULL, -- Base64Url string
        public_key TEXT NOT NULL,           -- Base64Url / PEM public key
        sign_count INTEGER DEFAULT 0,
        is_mock INTEGER DEFAULT 0,          -- 1 if registered using simulator
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    # Create Attendance Logs Table (Stores details, location, time - NO photo)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS attendance_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        log_type TEXT DEFAULT 'Check-In',
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    # Migration to add log_type column if it doesn't exist
    try:
        cursor.execute("ALTER TABLE attendance_logs ADD COLUMN log_type TEXT DEFAULT 'Check-In';")
    except sqlite3.OperationalError:
        pass
        
    conn.commit()
    conn.close()

# User CRUD operations

def create_user(username, name, role, photo, department=None, latitude=None, longitude=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO users (username, name, role, department, photo, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (username.strip(), name.strip(), role, department, photo, latitude, longitude)
        )
        user_id = cursor.lastrowid
        conn.commit()
        return user_id
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

def get_user_by_username(username):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username.strip(),))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_user_by_id(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_approved_users():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, name, role, department, latitude, longitude FROM users WHERE approved = 1 ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_pending_users():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, name, role, department, latitude, longitude FROM users WHERE approved = 0 ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def approve_user(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET approved = 1 WHERE id = ?", (user_id,))
    success = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return success

def reject_user(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET approved = -1 WHERE id = ?", (user_id,))
    success = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return success

def get_all_users():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, name, role, department, approved, latitude, longitude, created_at FROM users ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

# Credential CRUD operations

def add_credential(user_id, credential_id, public_key, sign_count=0, is_mock=0):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO credentials (user_id, credential_id, public_key, sign_count, is_mock) VALUES (?, ?, ?, ?, ?)",
            (user_id, credential_id, public_key, sign_count, is_mock)
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def get_credentials_for_user(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM credentials WHERE user_id = ?", (user_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_credential_by_id(credential_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM credentials WHERE credential_id = ?", (credential_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def update_credential_sign_count(credential_id, sign_count):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE credentials SET sign_count = ? WHERE credential_id = ?",
        (sign_count, credential_id)
    )
    conn.commit()
    conn.close()

# Attendance Log Operations

def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371.0  # Earth radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def get_user_last_log_today(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    today_str = datetime.now().strftime("%Y-%m-%d")
    cursor.execute("""
        SELECT log_type FROM attendance_logs 
        WHERE user_id = ? AND date(timestamp, 'localtime') = ?
        ORDER BY timestamp DESC LIMIT 1
    """, (user_id, today_str))
    row = cursor.fetchone()
    conn.close()
    return row["log_type"] if row else None

def add_attendance_log(user_id, role, latitude, longitude):
    # 1. Fetch user's registered enrollment location for geofence validation
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name, latitude, longitude FROM users WHERE id = ?", (user_id,))
    user_record = cursor.fetchone()
    conn.close()

    if user_record and user_record["latitude"] is not None and user_record["longitude"] is not None:
        dist_from_enroll = haversine_distance(latitude, longitude, user_record["latitude"], user_record["longitude"])
        # Threshold: 200 meters (0.2 km)
        if dist_from_enroll > 0.2:
            raise ValueError(
                f"Location verification failed. You are too far from your registered enrollment location "
                f"(drift: {dist_from_enroll*1000:.0f}m, max allowed: 200m)."
            )

    # 2. Determine auto-toggled check-in/check-out type
    last_type = get_user_last_log_today(user_id)
    if last_type is None:
        log_type = "Check-In"
    elif last_type == "Check-In":
        log_type = "Check-Out"
    else:
        # last_type is "Check-Out"
        raise ValueError("Attendance already complete for today.")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO attendance_logs (user_id, role, latitude, longitude, log_type) VALUES (?, ?, ?, ?, ?)",
        (user_id, role, latitude, longitude, log_type)
    )
    log_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return log_id

def get_attendance_logs(limit=100):
    conn = get_db_connection()
    cursor = conn.cursor()
    # Group check-in and check-out logs for the same user on the same date
    cursor.execute("""
        SELECT 
            MAX(l.id) AS id,
            l.user_id, 
            l.role, 
            MAX(l.latitude) AS latitude, 
            MAX(l.longitude) AS longitude, 
            MIN(CASE WHEN COALESCE(l.log_type, 'Check-In') = 'Check-In' THEN l.timestamp END) AS timestamp,
            MAX(CASE WHEN l.log_type = 'Check-Out' THEN l.timestamp END) AS check_out_time,
            u.name, 
            u.username, 
            u.department
        FROM attendance_logs l
        JOIN users u ON l.user_id = u.id
        GROUP BY date(l.timestamp, 'localtime'), l.user_id
        ORDER BY id DESC
        LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    
    logs = []
    for r in rows:
        d = dict(r)
        if d.get("timestamp") and not d["timestamp"].endswith("Z"):
            d["timestamp"] = d["timestamp"].replace(" ", "T") + "Z"
        if d.get("check_out_time") and not d["check_out_time"].endswith("Z"):
            d["check_out_time"] = d["check_out_time"].replace(" ", "T") + "Z"
        logs.append(d)
    return logs

def get_attendance_log_details(log_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # First get the user_id and log_date for this log entry
    cursor.execute("SELECT user_id, date(timestamp, 'localtime') as log_date FROM attendance_logs WHERE id = ?", (log_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return None
        
    user_id = row["user_id"]
    log_date = row["log_date"]
    
    # Query the daily merged summary for this user on this date
    cursor.execute("""
        SELECT 
            MAX(l.id) AS id, 
            l.user_id, 
            l.role, 
            MAX(l.latitude) AS latitude, 
            MAX(l.longitude) AS longitude, 
            MIN(CASE WHEN COALESCE(l.log_type, 'Check-In') = 'Check-In' THEN l.timestamp END) AS timestamp,
            MAX(CASE WHEN l.log_type = 'Check-Out' THEN l.timestamp END) AS check_out_time,
            u.name, 
            u.username, 
            u.department, 
            u.photo
        FROM attendance_logs l
        JOIN users u ON l.user_id = u.id
        WHERE l.user_id = ? AND date(l.timestamp, 'localtime') = ?
    """, (user_id, log_date))
    
    merged_row = cursor.fetchone()
    conn.close()
    
    if merged_row and merged_row["id"] is not None:
        d = dict(merged_row)
        if d.get("timestamp") and not d["timestamp"].endswith("Z"):
            d["timestamp"] = d["timestamp"].replace(" ", "T") + "Z"
        if d.get("check_out_time") and not d["check_out_time"].endswith("Z"):
            d["check_out_time"] = d["check_out_time"].replace(" ", "T") + "Z"
        return d
    return None

def delete_attendance_log(log_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM attendance_logs WHERE id = ?", (log_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

def delete_user(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM attendance_logs WHERE user_id = ?", (user_id,))
    cursor.execute("DELETE FROM credentials WHERE user_id = ?", (user_id,))
    cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

def get_dashboard_stats():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Total registered users (approved current strength)
    cursor.execute("SELECT COUNT(*) FROM users WHERE approved = 1")
    total_users = cursor.fetchone()[0]
    
    # Total check-ins today (converted to local system timezone)
    today_str = datetime.now().strftime("%Y-%m-%d")
    cursor.execute("""
        SELECT COUNT(*) FROM attendance_logs 
        WHERE date(timestamp, 'localtime') = ? AND COALESCE(log_type, 'Check-In') = 'Check-In'
    """, (today_str,))
    total_checkins = cursor.fetchone()[0]
    
    # Total check-outs today
    cursor.execute("""
        SELECT COUNT(*) FROM attendance_logs 
        WHERE date(timestamp, 'localtime') = ? AND log_type = 'Check-Out'
    """, (today_str,))
    total_checkouts = cursor.fetchone()[0]
    
    # Breakdowns by role (approved users only)
    cursor.execute("SELECT role, COUNT(*) FROM users WHERE approved = 1 GROUP BY role")
    users_by_role = dict(cursor.fetchall())
    
    # Check-ins today by role
    cursor.execute("""
        SELECT role, COUNT(*) 
        FROM attendance_logs 
        WHERE date(timestamp, 'localtime') = ?
        GROUP BY role
    """, (today_str,))
    logs_today_by_role = dict(cursor.fetchall())
    
    # Make sure all roles are represented
    roles = ['Admin', 'Teacher', 'Employee', 'Student', 'Worker']
    users_by_role_complete = {role: users_by_role.get(role, 0) for role in roles}
    logs_today_by_role_complete = {role: logs_today_by_role.get(role, 0) for role in roles}
    
    conn.close()
    return {
        "total_users": total_users,
        "total_checkins": total_checkins,
        "total_checkouts": total_checkouts,
        "users_by_role": users_by_role_complete,
        "logs_today_by_role": logs_today_by_role_complete
    }
