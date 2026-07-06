import os
import re
import socket
import time
import uuid
import secrets
from typing import Optional, Dict, Any
from fastapi import FastAPI, Request, HTTPException, Depends, Header, Response
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import database
import webauthn_handler
import security

app = FastAPI(title="Apple Glassmorphism Biometric Attendance System")

# Initialize SQLite database on startup
@app.on_event("startup")
def startup_event():
    database.init_db()
    # Print the initial rotating registration code to the terminal for bootstrapping
    code, _ = security.get_current_authority_code()
    # Write to a local file in workspace for easy developer access
    with open("bootstrap_code.txt", "w") as f:
        f.write(code)
    print("\n" + "="*60)
    print(f"  BOOTSTRAP SECURITY CODE (For Admin/Teacher registration): {code}")
    print("="*60 + "\n")

# In-Memory Stores for Challenges and QR Sessions
# Structure: { challenge_str: { "user_info_or_id": ..., "state": Fido2State } }
registration_states: Dict[str, Dict[str, Any]] = {}
login_states: Dict[str, Dict[str, Any]] = {}

# Structure: { session_id: { "status": "pending"|"verified", "user": None|dict, "expires_at": float } }
sync_sessions: Dict[str, Dict[str, Any]] = {}

# Structure: { session_id: { "username": str, "name": str, "role": str, "status": "pending"|"verified", "expires_at": float } }
register_sessions: Dict[str, Dict[str, Any]] = {}

# Network Utility to get server's local Wi-Fi / Ethernet IP
def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

# Helper to check if RP ID is an IP address
def is_ip_address(host: str) -> bool:
    clean_host = host.split(":")[0]
    return bool(re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", clean_host))

# Security Helper to extract Bearer Token
def get_admin_token(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized: Missing or invalid token")
    token = authorization.split(" ")[1]
    if not security.is_admin_session_valid(token):
        raise HTTPException(status_code=401, detail="Unauthorized: Session expired or invalid")
    return token

# Pydantic Schemas
class RegisterOptionsRequest(BaseModel):
    username: str
    name: str
    role: str
    photo: str  # Base64 string
    code: Optional[str] = None  # Security code for Admin/Teacher
    department: Optional[str] = None # Department and Semester

class RegisterVerifyRequest(BaseModel):
    challenge: str
    credential: Dict[str, Any]
    is_mock: bool
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class RegisterSessionCreateRequest(BaseModel):
    username: str
    name: str
    role: str
    code: Optional[str] = None
    department: Optional[str] = None

class RegisterSessionVerifyRequest(BaseModel):
    photo: str  # Base64 string
    credential: Dict[str, Any]
    is_mock: bool
    challenge: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class LoginOptionsRequest(BaseModel):
    username: str

class LoginVerifyRequest(BaseModel):
    challenge: str
    credential: Dict[str, Any]
    is_mock: bool
    latitude: float
    longitude: float
    photo: Optional[str] = None

class SessionVerifyRequest(BaseModel):
    username: str
    latitude: float
    longitude: float
    credential: Optional[Dict[str, Any]] = None
    challenge: Optional[str] = None
    is_mock: bool
    photo: Optional[str] = None

class AdminLoginRequest(BaseModel):
    username: str
    challenge: str
    credential: Dict[str, Any]
    is_mock: bool


# ---------------- PAGE ROUTING (HTML serving) ----------------

# Make sure static directory exists
os.makedirs("static", exist_ok=True)
os.makedirs("static/css", exist_ok=True)
os.makedirs("static/js", exist_ok=True)

@app.get("/", response_class=HTMLResponse)
def get_index(request: Request):
    host = request.headers.get("host", "localhost")
    if not is_ip_address(host.split(":")[0]) and request.url.scheme == "http":
        return RedirectResponse(url=f"https://{host}/")
    return FileResponse("static/index.html")

@app.get("/register", response_class=HTMLResponse)
def get_register(request: Request):
    host = request.headers.get("host", "localhost")
    if not is_ip_address(host.split(":")[0]) and request.url.scheme == "http":
        session_id = request.query_params.get("session")
        query = f"?session={session_id}" if session_id else ""
        return RedirectResponse(url=f"https://{host}/register{query}")
    return FileResponse("static/register.html")

@app.get("/attendance", response_class=HTMLResponse)
def get_attendance():
    return FileResponse("static/attendance.html")

@app.get("/mobile", response_class=HTMLResponse)
def get_mobile():
    return FileResponse("static/mobile.html")

@app.get("/student", response_class=HTMLResponse)
def get_student():
    return FileResponse("static/student.html")


# ---------------- WEBAUTHN REGISTRATION APIS ----------------

@app.post("/api/webauthn/register/options")
def register_options(req: RegisterOptionsRequest, request: Request):
    host = request.headers.get("host", "localhost")
    rp_id = host.split(":")[0]
    
    # 1. Validate Roles and Authority Registration Code
    if req.role in ["Admin", "Teacher"]:
        if not req.code:
            raise HTTPException(status_code=400, detail="Security Access Code is required for Admin/Teacher registration")
        if not security.validate_authority_code(req.code):
            raise HTTPException(status_code=400, detail="Invalid or expired Security Access Code")
            
    # 2. Check if username is already taken
    existing_user = database.get_user_by_username(req.username)
    if existing_user:
        if existing_user.get("approved") == -1:
            database.delete_user(existing_user["id"])
        else:
            raise HTTPException(status_code=400, detail="Username is already registered")
        
    # If the app is run over an IP address, native WebAuthn is unsupported by browsers unless using HTTPS.
    # We will inform the client to run in mock/simulator mode only over HTTP.
    if is_ip_address(rp_id) and request.url.scheme == "http":
        # Return mock options directly
        mock_challenge = secrets.token_hex(32)
        registration_states[mock_challenge] = {
            "username": req.username,
            "name": req.name,
            "role": req.role,
            "photo": req.photo,
            "department": req.department,
            "is_mock": True
        }
        return {
            "challenge": mock_challenge,
            "is_mock": True,
            "user": {
                "name": req.username,
                "displayName": req.name
            }
        }
        
    # Standard WebAuthn Options Generation
    # Since the user isn't created in the DB yet, we pass a temporary user ID
    temp_user_id = int(time.time()) & 0xFFFFFFFF
    
    try:
        options, state = webauthn_handler.generate_registration_options(
            user_id=temp_user_id,
            username=req.username,
            name=req.name,
            rp_id=rp_id
        )
        
        # Save options state in memory to complete the registration later
        challenge_str = options["challenge"]
        registration_states[challenge_str] = {
            "username": req.username,
            "name": req.name,
            "role": req.role,
            "photo": req.photo,
            "department": req.department,
            "state": state,
            "is_mock": False
        }
        
        return {**options, "is_mock": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WebAuthn Initialization Error: {str(e)}")

@app.post("/api/webauthn/register/verify")
def register_verify(req: RegisterVerifyRequest, request: Request):
    host = request.headers.get("host", "localhost")
    rp_id = host.split(":")[0]
    
    challenge = req.challenge
    if challenge not in registration_states:
        raise HTTPException(status_code=404, detail="Registration session expired or not found")
        
    user_state = registration_states[challenge]
    username = user_state["username"]
    name = user_state["name"]
    role = user_state["role"]
    photo = user_state["photo"]
    
    # 1. Create the user in the database
    user_id = database.create_user(
        username, 
        name, 
        role, 
        photo, 
        user_state.get("department"),
        latitude=req.latitude,
        longitude=req.longitude
    )
    if not user_id:
        raise HTTPException(status_code=500, detail="Failed to create user record")
        
    # 2. Register credentials
    if req.is_mock or user_state["is_mock"]:
        # Simulator Mode: Store a mock credential record
        mock_cred_id = req.credential.get("id", f"mock_cred_{secrets.token_hex(8)}")
        database.add_credential(
            user_id=user_id,
            credential_id=mock_cred_id,
            public_key="MOCK_PUBLIC_KEY",
            is_mock=1
        )
    else:
        # Real WebAuthn Mode
        try:
            cred_id, pub_key = webauthn_handler.verify_registration(
                state=user_state["state"],
                response_dict=req.credential,
                rp_id=rp_id
            )
            database.add_credential(
                user_id=user_id,
                credential_id=cred_id,
                public_key=pub_key,
                is_mock=0
            )
        except Exception as e:
            # Rollback user creation
            # Actually SQLite cascade is fine, but let's delete user just in case
            # to prevent broken entries.
            conn = database.get_db_connection()
            conn.cursor().execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()
            conn.close()
            raise HTTPException(status_code=400, detail=f"FIDO2 Attestation Verification failed: {str(e)}")
            
    # Clean up state
    del registration_states[challenge]
    
    return {"success": True, "message": f"Successfully enrolled {name} as {role}"}


# ---------------- REMOTE REGISTRATION SYNC APIS ----------------

@app.post("/api/register-sessions/create")
def create_register_session(req: RegisterSessionCreateRequest, request: Request):
    # 1. Validate Roles and Authority Registration Code
    if req.role in ["Admin", "Teacher"]:
        if not req.code:
            raise HTTPException(status_code=400, detail="Security Access Code is required for Admin/Teacher registration")
        if not security.validate_authority_code(req.code):
            raise HTTPException(status_code=400, detail="Invalid or expired Security Access Code")
            
    # 2. Check if username is already taken
    existing_user = database.get_user_by_username(req.username)
    if existing_user:
        if existing_user.get("approved") == -1:
            database.delete_user(existing_user["id"])
        else:
            raise HTTPException(status_code=400, detail="Username is already registered")
        
    session_id = str(uuid.uuid4())
    register_sessions[session_id] = {
        "username": req.username,
        "name": req.name,
        "role": req.role,
        "department": req.department,
        "status": "pending",
        "photo": None,
        "expires_at": time.time() + 600  # 10 minutes
    }
    
    host = request.headers.get("host", "localhost")
    host_ip = host.split(":")[0]
    if is_ip_address(host_ip):
        scheme = request.url.scheme
        port_str = f":{host.split(':')[1]}" if ":" in host else ":8000"
        redirect_url = f"{scheme}://{get_local_ip()}{port_str}/register?session={session_id}"
    else:
        # Force HTTPS for reverse tunnel subdomains to enable WebAuthn biometrics!
        redirect_url = f"https://{host}/register?session={session_id}"
        
    return {
        "session_id": session_id,
        "redirect_url": redirect_url
    }

@app.get("/api/register-sessions/{session_id}/status")
def get_register_session_status(session_id: str):
    if session_id not in register_sessions:
        raise HTTPException(status_code=404, detail="Registration session expired or not found")
        
    sess = register_sessions[session_id]
    if time.time() > sess["expires_at"]:
        del register_sessions[session_id]
        raise HTTPException(status_code=404, detail="Registration session expired")
        
    return {
        "status": sess["status"],
        "username": sess["username"],
        "name": sess["name"],
        "role": sess["role"],
        "photo": sess["photo"],
        "department": sess.get("department")
    }

@app.post("/api/register-sessions/{session_id}/options")
def register_session_options(session_id: str, request: Request):
    host = request.headers.get("host", "localhost")
    rp_id = host.split(":")[0]
    
    if session_id not in register_sessions:
        raise HTTPException(status_code=404, detail="Registration session expired or not found")
        
    sess = register_sessions[session_id]
    if time.time() > sess["expires_at"]:
        del register_sessions[session_id]
        raise HTTPException(status_code=404, detail="Registration session expired")
        
    existing_user = database.get_user_by_username(sess["username"])
    if existing_user:
        raise HTTPException(status_code=400, detail="Username is already registered")
        
    if is_ip_address(rp_id) and request.url.scheme == "http":
        mock_challenge = secrets.token_hex(32)
        registration_states[mock_challenge] = {
            "username": sess["username"],
            "name": sess["name"],
            "role": sess["role"],
            "department": sess.get("department"),
            "session_id": session_id,
            "is_mock": True
        }
        return {
            "challenge": mock_challenge,
            "is_mock": True,
            "user": {
                "name": sess["username"],
                "displayName": sess["name"]
            }
        }
        
    temp_user_id = int(time.time()) & 0xFFFFFFFF
    try:
        options, state = webauthn_handler.generate_registration_options(
            user_id=temp_user_id,
            username=sess["username"],
            name=sess["name"],
            rp_id=rp_id
        )
        
        challenge_str = options["challenge"]
        registration_states[challenge_str] = {
            "username": sess["username"],
            "name": sess["name"],
            "role": sess["role"],
            "department": sess.get("department"),
            "session_id": session_id,
            "state": state,
            "is_mock": False
        }
        return {**options, "is_mock": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"FIDO2 Initialization Error: {str(e)}")

@app.post("/api/register-sessions/{session_id}/verify")
def verify_register_session(session_id: str, req: RegisterSessionVerifyRequest, request: Request):
    host = request.headers.get("host", "localhost")
    rp_id = host.split(":")[0]
    
    if session_id not in register_sessions:
        raise HTTPException(status_code=404, detail="Registration session expired or not found")
        
    sess = register_sessions[session_id]
    if time.time() > sess["expires_at"]:
        del register_sessions[session_id]
        raise HTTPException(status_code=404, detail="Registration session expired")
        
    challenge = req.challenge
    if not challenge or challenge not in registration_states:
        raise HTTPException(status_code=404, detail="Registration challenge session expired or not found")
        
    user_state = registration_states[challenge]
    
    user_id = database.create_user(
        sess["username"], 
        sess["name"], 
        sess["role"], 
        req.photo, 
        user_state.get("department"),
        latitude=req.latitude,
        longitude=req.longitude
    )
    if not user_id:
        raise HTTPException(status_code=500, detail="Failed to create user record")
        
    if req.is_mock or user_state["is_mock"]:
        mock_cred_id = req.credential.get("id", f"mock_cred_{secrets.token_hex(8)}")
        database.add_credential(
            user_id=user_id,
            credential_id=mock_cred_id,
            public_key="MOCK_PUBLIC_KEY",
            is_mock=1
        )
    else:
        try:
            cred_id, pub_key = webauthn_handler.verify_registration(
                state=user_state["state"],
                response_dict=req.credential,
                rp_id=rp_id
            )
            database.add_credential(
                user_id=user_id,
                credential_id=cred_id,
                public_key=pub_key,
                is_mock=0
            )
        except Exception as e:
            conn = database.get_db_connection()
            conn.cursor().execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()
            conn.close()
            raise HTTPException(status_code=400, detail=f"Biometric Verification failed: {str(e)}")
            
    del registration_states[challenge]
    
    sess["status"] = "verified"
    sess["photo"] = req.photo
    
    return {"success": True}


# ---------------- DIRECT MOBILE BIOMETRIC ATTENDANCE APIS ----------------

@app.post("/api/webauthn/login/options")
def login_options(req: LoginOptionsRequest, request: Request):
    host = request.headers.get("host", "localhost")
    rp_id = host.split(":")[0]
    
    user = database.get_user_by_username(req.username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if user.get("approved") == -1:
        raise HTTPException(status_code=403, detail="Your enrollment request was rejected by the administrator. Please contact the administrator.")
    elif not user.get("approved", 1):
        raise HTTPException(status_code=403, detail="Your enrollment is pending administrator approval. Please contact the administrator.")
        
    credentials = database.get_credentials_for_user(user["id"])
    if not credentials:
        raise HTTPException(status_code=400, detail="User has no biometric credentials registered")
        
    # If the user only has mock credentials, or we are on an IP address over HTTP, trigger simulated flow
    if (is_ip_address(rp_id) and request.url.scheme == "http") or all(c["is_mock"] for c in credentials):
        mock_challenge = secrets.token_hex(32)
        login_states[mock_challenge] = {
            "user_id": user["id"],
            "username": req.username,
            "role": user["role"],
            "is_mock": True
        }
        return {
            "challenge": mock_challenge,
            "is_mock": True
        }
        
    # Standard WebAuthn Login Options
    try:
        options, state = webauthn_handler.generate_authentication_options(
            username=req.username,
            rp_id=rp_id,
            user_credentials=credentials
        )
        
        if not options:
            # Fallback if no matching standard credentials
            mock_challenge = secrets.token_hex(32)
            login_states[mock_challenge] = {
                "user_id": user["id"],
                "username": req.username,
                "role": user["role"],
                "is_mock": True
            }
            return {"challenge": mock_challenge, "is_mock": True}
            
        challenge_str = options["challenge"]
        login_states[challenge_str] = {
            "user_id": user["id"],
            "username": req.username,
            "role": user["role"],
            "state": state,
            "is_mock": False
        }
        
        return {**options, "is_mock": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"WebAuthn assertion generation failed: {str(e)}")

@app.post("/api/webauthn/login/verify")
def login_verify(req: LoginVerifyRequest, request: Request):
    host = request.headers.get("host", "localhost")
    rp_id = host.split(":")[0]
    
    challenge = req.challenge
    if challenge not in login_states:
        raise HTTPException(status_code=404, detail="Authentication session expired or not found")
        
    session_data = login_states[challenge]
    user_id = session_data["user_id"]
    role = session_data["role"]
    username = session_data["username"]
    
    user = database.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if req.is_mock or session_data["is_mock"]:
        # Mock Check-in: accept verification
        pass
    else:
        # Real WebAuthn assertion verification
        db_credentials = database.get_credentials_for_user(user_id)
        try:
            verified, new_sign_count = webauthn_handler.verify_authentication(
                state=session_data["state"],
                response_dict=req.credential,
                rp_id=rp_id,
                db_credentials=db_credentials
            )
            if not verified:
                raise HTTPException(status_code=400, detail="Invalid biometric signature")
                
            # Update sign count in database
            database.update_credential_sign_count(req.credential["id"], new_sign_count)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Biometric Verification failed: {str(e)}")
            
    # Add to attendance logs
    try:
        database.add_attendance_log(
            user_id=user_id,
            role=role,
            latitude=req.latitude,
            longitude=req.longitude,
            photo=req.photo
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    
    # Clean up login challenge
    del login_states[challenge]
    
    return {
        "success": True, 
        "user": {
            "name": user["name"],
            "role": user["role"]
        }
    }


# ---------------- SYNC SESSION COEXISTENCE (Desktop QR) APIS ----------------

@app.post("/api/sessions/create")
def create_sync_session(request: Request):
    """Generates a sync session ID and returns the server local IP/redirect_url for QR encoding."""
    session_id = str(uuid.uuid4())
    sync_sessions[session_id] = {
        "status": "pending",
        "user": None,
        "expires_at": time.time() + 600 # Valid for 10 minutes
    }
    
    host = request.headers.get("host", "localhost")
    scheme = request.url.scheme
    host_ip = host.split(":")[0]
    if is_ip_address(host_ip):
        port_str = f":{host.split(':')[1]}" if ":" in host else ":8000"
        redirect_url = f"{scheme}://{get_local_ip()}{port_str}/mobile?session={session_id}"
    else:
        redirect_url = f"{scheme}://{host}/mobile?session={session_id}"
        
    return {
        "session_id": session_id,
        "redirect_url": redirect_url
    }

@app.get("/api/sessions/{session_id}/status")
def get_sync_session_status(session_id: str):
    """Poll endpoint for desktop kiosk to see if the session is verified."""
    if session_id not in sync_sessions:
        raise HTTPException(status_code=404, detail="Session expired or not found")
        
    sess = sync_sessions[session_id]
    if time.time() > sess["expires_at"]:
        del sync_sessions[session_id]
        raise HTTPException(status_code=404, detail="Session expired")
        
    return {
        "status": sess["status"],
        "user": sess["user"]
    }

@app.post("/api/sessions/{session_id}/verify")
def verify_sync_session(session_id: str, req: SessionVerifyRequest, request: Request):
    """Mobile calls this when biometric authentication succeeds to update session status."""
    host = request.headers.get("host", "localhost")
    rp_id = host.split(":")[0]
    
    if session_id not in sync_sessions:
        raise HTTPException(status_code=404, detail="Sync session expired or not found")
        
    sess = sync_sessions[session_id]
    if time.time() > sess["expires_at"]:
        del sync_sessions[session_id]
        raise HTTPException(status_code=404, detail="Sync session expired")
        
    # Look up user
    user = database.get_user_by_username(req.username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if user.get("approved") == -1:
        raise HTTPException(status_code=403, detail="Your enrollment request was rejected by the administrator. Please contact the administrator.")
    elif not user.get("approved", 1):
        raise HTTPException(status_code=403, detail="Your enrollment is pending administrator approval. Please contact the administrator.")
        
    # Perform fingerprint validation
    if req.is_mock:
        # Mock registration/login bypass
        pass
    else:
        # Real WebAuthn assertion verification
        if not req.credential or not req.challenge:
            raise HTTPException(status_code=400, detail="Missing credential or challenge payload")
            
        # Retrieve the saved challenge state from login_states
        challenge = req.challenge
        if challenge not in login_states:
            raise HTTPException(status_code=400, detail="Login challenge expired or not found")
            
        state_data = login_states[challenge]
        db_credentials = database.get_credentials_for_user(user["id"])
        
        try:
            verified, new_sign_count = webauthn_handler.verify_authentication(
                state=state_data["state"],
                response_dict=req.credential,
                rp_id=rp_id,
                db_credentials=db_credentials
            )
            if not verified:
                raise HTTPException(status_code=400, detail="Invalid biometric signature")
            database.update_credential_sign_count(req.credential["id"], new_sign_count)
            # clean up
            del login_states[challenge]
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Biometric Verification failed: {str(e)}")
            
    # Add to attendance logs
    try:
        database.add_attendance_log(
            user_id=user["id"],
            role=user["role"],
            latitude=req.latitude,
            longitude=req.longitude,
            photo=req.photo
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    
    # Update the sync session to notify the desktop kiosk
    # Returns the photo here to let the desktop display it, but does NOT save it in logs table.
    sess["status"] = "verified"
    sess["user"] = {
        "name": user["name"],
        "role": user["role"],
        "photo": user["photo"], # Sent to desktop for display only
        "time": datetime_str()
    }
    
    return {"success": True}


# ---------------- DASHBOARD & ADMINISTRATIVE APIS ----------------

@app.get("/api/dashboard/stats")
def get_stats():
    return database.get_dashboard_stats()

@app.get("/api/dashboard/logs")
def get_logs():
    return database.get_attendance_logs()

@app.post("/api/admin/login")
def admin_login(req: AdminLoginRequest, request: Request):
    """
    Biometrically authenticates an Admin and issues an admin session token.
    """
    host = request.headers.get("host", "localhost")
    rp_id = host.split(":")[0]
    
    user = database.get_user_by_username(req.username)
    if not user or user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Access denied: Not an Admin")
        
    challenge = req.challenge
    if challenge not in login_states:
        raise HTTPException(status_code=404, detail="Login challenge expired or not found")
        
    session_data = login_states[challenge]
    
    if req.is_mock or session_data["is_mock"]:
        pass
    else:
        db_credentials = database.get_credentials_for_user(user["id"])
        try:
            verified, new_sign_count = webauthn_handler.verify_authentication(
                state=session_data["state"],
                response_dict=req.credential,
                rp_id=rp_id,
                db_credentials=db_credentials
            )
            if not verified:
                raise HTTPException(status_code=400, detail="Invalid biometric signature")
            database.update_credential_sign_count(req.credential["id"], new_sign_count)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Admin Verification failed: {str(e)}")
            
    # Clean up challenge
    del login_states[challenge]
    
    # Create secure session
    token = security.create_admin_session(req.username)
    return {"success": True, "token": token}

@app.delete("/api/logs/{log_id}")
def delete_log(log_id: int, token: str = Depends(get_admin_token)):
    """Deletes an attendance log (Requires Admin token)."""
    success = database.delete_attendance_log(log_id)
    if not success:
        raise HTTPException(status_code=404, detail="Log entry not found")
    return {"success": True, "message": "Log entry successfully removed"}

@app.get("/api/admin/logs/{log_id}/details")
def get_attendance_log_details(log_id: int, token: str = Depends(get_admin_token)):
    """Returns full details of a specific log entry, including profile photo (Requires Admin token)."""
    details = database.get_attendance_log_details(log_id)
    if not details:
        raise HTTPException(status_code=404, detail="Log entry not found")
    return details

@app.get("/api/admin/users")
def get_all_users(token: str = Depends(get_admin_token)):
    """Returns a list of all approved users (Requires Admin token)."""
    return database.get_approved_users()

@app.get("/api/admin/users/pending")
def get_pending_users(token: str = Depends(get_admin_token)):
    """Returns a list of users pending approval (Requires Admin token)."""
    return database.get_pending_users()

@app.post("/api/admin/users/{user_id}/approve")
def approve_user(user_id: int, token: str = Depends(get_admin_token)):
    """Approves a pending user (Requires Admin token)."""
    success = database.approve_user(user_id)
    if not success:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}

@app.post("/api/admin/users/{user_id}/reject")
def reject_user(user_id: int, token: str = Depends(get_admin_token)):
    """Rejects a pending user (Requires Admin token)."""
    success = database.reject_user(user_id)
    if not success:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}

@app.get("/api/admin/users/{user_id}/details")
def get_user_details(user_id: int, token: str = Depends(get_admin_token)):
    """Returns full details of a specific user including photo (Requires Admin token)."""
    user = database.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.delete("/api/admin/users/{user_id}")
def delete_user(user_id: int, token: str = Depends(get_admin_token)):
    """Deletes a registered user and all associated credentials/logs (Requires Admin token)."""
    success = database.delete_user(user_id)
    if not success:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "message": "User successfully deleted"}

@app.get("/api/admin/authority-code")
def get_authority_code(token: str = Depends(get_admin_token)):
    """Returns the current active registration code and seconds remaining (Requires Admin token)."""
    code, seconds_left = security.get_current_authority_code()
    return {"code": code, "seconds_left": seconds_left}

@app.get("/api/public/authority-timer")
def get_authority_timer():
    """Public helper to get rotating code expiration remaining (doesn't leak code itself)."""
    _, seconds_left = security.get_current_authority_code()
    return {"seconds_left": seconds_left}


class SettingsUpdateRequest(BaseModel):
    checkin_start: str
    checkin_end: str
    checkout_start: str
    checkout_end: str

class StudentLoginOptionsRequest(BaseModel):
    username: str

class StudentLoginVerifyRequest(BaseModel):
    challenge: str
    credential: Dict[str, Any]

@app.get("/api/admin/settings")
def get_admin_settings(token: str = Depends(get_admin_token)):
    """Retrieve schedule windows (Requires Admin token)."""
    return database.get_settings()

@app.post("/api/admin/settings")
def update_admin_settings(req: SettingsUpdateRequest, token: str = Depends(get_admin_token)):
    """Update schedule windows (Requires Admin token)."""
    for val in [req.checkin_start, req.checkin_end, req.checkout_start, req.checkout_end]:
        parts = val.split(":")
        if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
            raise HTTPException(status_code=400, detail="Invalid time format. Use HH:MM")
    database.update_settings(
        req.checkin_start,
        req.checkin_end,
        req.checkout_start,
        req.checkout_end
    )
    return {"success": True}

@app.get("/api/public/settings")
def get_public_settings():
    """Retrieve schedule windows for public UI visibility (No auth required)."""
    return database.get_settings()

student_tokens: Dict[str, int] = {}

@app.get("/api/student/{user_id}/dashboard-data")
def get_student_dashboard_data(user_id: int, authorization: Optional[str] = Header(None)):
    """Retrieve profile summary and date-wise timeline logs for a specific student (Requires Admin or Self Auth)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authentication header")
        
    token = authorization.split(" ")[1]
    
    # 1. Check if valid Admin token
    is_admin = False
    try:
        from security import verify_token
        verify_token(token)
        is_admin = True
    except Exception:
        pass
        
    # 2. Check if valid student token matching this user_id
    is_self = (student_tokens.get(token) == user_id)
    
    if not is_admin and not is_self:
        raise HTTPException(status_code=403, detail="Access denied: Unauthorized dashboard access")
        
    summary = database.get_student_summary(user_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Student record not found")
    timeline = database.get_student_timeline(user_id)
    return {
        "summary": summary,
        "timeline": timeline
    }

@app.post("/api/student/login-options")
def student_login_options(req: StudentLoginOptionsRequest, request: Request):
    """Generate WebAuthn login options for the student dashboard biometric auth."""
    host = request.headers.get("host", "localhost")
    rp_id = host.split(":")[0]
    
    user = database.get_user_by_username(req.username)
    if not user:
        raise HTTPException(status_code=404, detail="Student username not found")
        
    db_credentials = database.get_credentials_for_user(user["id"])
    if not db_credentials:
        raise HTTPException(status_code=400, detail="No enrolled biometric keys found for this student")
        
    options, state = webauthn_handler.generate_authentication_options(
        username=req.username,
        rp_id=rp_id,
        user_credentials=db_credentials
    )
    
    if not options:
        raise HTTPException(status_code=400, detail="Failed to generate biometric options")
        
    challenge_str = options["challenge"]
    login_states[challenge_str] = {
        "state": state,
        "user_id": user["id"],
        "username": user["username"],
        "role": user["role"]
    }
    return options

@app.post("/api/student/login-verify")
def student_login_verify(req: StudentLoginVerifyRequest, request: Request):
    """Verify WebAuthn login assertion and issue a temporary student token."""
    host = request.headers.get("host", "localhost")
    rp_id = host.split(":")[0]
    
    challenge = req.challenge
    if challenge not in login_states:
        raise HTTPException(status_code=400, detail="Invalid or expired challenge session")
        
    session_data = login_states[challenge]
    user_id = session_data["user_id"]
    
    db_credentials = database.get_credentials_for_user(user_id)
    try:
        verified, new_sign_count = webauthn_handler.verify_authentication(
            state=session_data["state"],
            response_dict=req.credential,
            rp_id=rp_id,
            db_credentials=db_credentials
        )
        if not verified:
            raise HTTPException(status_code=400, detail="Invalid biometric credentials assertion")
        database.update_credential_sign_count(req.credential["id"], new_sign_count)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Verification failed: {str(e)}")
        
    # Clean up challenge state
    del login_states[challenge]
    
    # Generate temporary access token for this session
    import secrets
    student_token = "STUDENT-" + secrets.token_urlsafe(32)
    student_tokens[student_token] = user_id
    
    return {
        "success": True,
        "token": student_token,
        "userId": user_id
    }

@app.get("/api/users/by-username/{username}")
def get_user_by_username(username: str):
    """Public helper to resolve a username to its student user ID."""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Username not found")
    return {"id": row["id"]}


@app.get("/api/admin/export")
def export_logs(
    date: Optional[str] = None,
    dept: Optional[str] = None,
    student: Optional[str] = None,
    status: Optional[str] = None,
    format: str = "csv"
):
    from datetime import datetime
    # Fetch logs from database
    logs = database.get_attendance_logs(limit=1000)
    
    # Apply filtering in Python
    filtered = []
    for log in logs:
        # Date filter
        if date:
            log_date = log["timestamp"][:10] if log.get("timestamp") else ""
            if log_date != date:
                continue
                
        # Dept filter
        if dept:
            log_dept = log.get("department") or "General"
            if dept.lower() not in log_dept.lower():
                continue
                
        # Student filter
        if student:
            log_name = log.get("name") or ""
            log_username = log.get("username") or ""
            if student.lower() not in log_name.lower() and student.lower() not in log_username.lower():
                continue
                
        # Status filter
        if status and status != "All":
            if log.get("status") != status:
                continue
                
        filtered.append(log)
        
    if format in ["csv", "excel"]:
        csv_data = "Student Name,Username/ID,Department,Role,Date,Check-In,Check-Out,Hours Worked,Status\n"
        for log in filtered:
            check_in = ""
            if log.get("timestamp"):
                try:
                    check_in = log["timestamp"][11:16]
                except Exception:
                    check_in = "--:--"
            check_out = ""
            if log.get("check_out_time"):
                try:
                    check_out = log["check_out_time"][11:16]
                except Exception:
                    check_out = "--:--"
            log_date = log["timestamp"][:10] if log.get("timestamp") else "--"
            
            hours = "-"
            if log.get("timestamp") and log.get("check_out_time"):
                try:
                    t1 = datetime.fromisoformat(log["timestamp"].replace("Z", ""))
                    t2 = datetime.fromisoformat(log["check_out_time"].replace("Z", ""))
                    diff = t2 - t1
                    total_seconds = int(diff.total_seconds())
                    if total_seconds > 0:
                        hrs = total_seconds // 3600
                        mins = (total_seconds % 3600) // 60
                        hours = f"{hrs}h {mins}m"
                except Exception:
                    pass
                    
            status_str = log.get("status") or "On Time"
            csv_data += f'"{log.get("name")}","{log.get("username")}","{log.get("department") or "General"}","{log.get("role")}","{log_date}","{check_in}","{check_out}","{hours}","{status_str}"\n'
            
        filename = f"attendance_report_{datetime.now().strftime('%Y-%m-%d')}.csv"
        return Response(
            content=csv_data.encode("utf-8-sig"),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Cache-Control": "no-cache"
            }
        )
        
    elif format == "pdf":
        table_rows = ""
        for log in filtered:
            check_in = log["timestamp"][11:16] if log.get("timestamp") else "--:--"
            check_out = log["check_out_time"][11:16] if log.get("check_out_time") else "--:--"
            log_date = log["timestamp"][:10] if log.get("timestamp") else "--"
            
            hours = "-"
            if log.get("timestamp") and log.get("check_out_time"):
                try:
                    t1 = datetime.fromisoformat(log["timestamp"].replace("Z", ""))
                    t2 = datetime.fromisoformat(log["check_out_time"].replace("Z", ""))
                    diff = t2 - t1
                    total_seconds = int(diff.total_seconds())
                    if total_seconds > 0:
                        hrs = total_seconds // 3600
                        mins = (total_seconds % 3600) // 60
                        hours = f"{hrs}h {mins}m"
                except Exception:
                    pass
            status_str = log.get("status") or "On Time"
            color = "#ff9500" if status_str == "Late Arrival" else "#34c759"
            table_rows += f"""
                <tr style="border-bottom: 1px solid #ddd;">
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">{log.get('name')} ({log.get('username')})</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">{log.get('department') or 'General'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">{log_date}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">{check_in}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">{check_out}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">{hours}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd; font-weight: 700; color: {color};">{status_str}</td>
                </tr>
            """
            
        html_content = f"""
            <html>
            <head>
                <title>Attendance Report Ledger</title>
                <style>
                    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #333; }}
                    h2 {{ margin-bottom: 5px; font-weight: 700; }}
                    p {{ color: #666; font-size: 14px; margin-bottom: 30px; }}
                    table {{ width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }}
                    th {{ padding: 12px 10px; font-weight: 700; color: #555; background: #f5f5f7; border-bottom: 2px solid #ddd; }}
                </style>
            </head>
            <body>
                <h2>PassBiometric Attendance Ledger</h2>
                <p>Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | Filtered records: {len(filtered)}</p>
                <table>
                    <thead>
                        <tr>
                            <th>STUDENT</th>
                            <th>DEPARTMENT</th>
                            <th>DATE</th>
                            <th>CHECK-IN</th>
                            <th>CHECK-OUT</th>
                            <th>HOURS</th>
                            <th>STATUS</th>
                        </tr>
                    </thead>
                    <tbody>
                        {table_rows}
                    </tbody>
                </table>
                <script>
                    window.onload = function() {{
                        window.print();
                    }}
                </script>
            </body>
            </html>
        """
        return Response(
            content=html_content.encode("utf-8"),
            media_type="text/html",
            headers={
                "Cache-Control": "no-cache"
            }
        )


# ---------------- UTILS ----------------

def datetime_str():
    from datetime import datetime
    return datetime.now().strftime("%I:%M:%S %p")

# Mount Static Files
app.mount("/static", StaticFiles(directory="static"), name="static")
