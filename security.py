import time
import secrets

# Private global variables for rotating authority code
_current_code = None
_code_expires_at = 0

def get_current_authority_code():
    """
    Returns the current active 6-character registration code and 
    the number of seconds remaining before it expires.
    """
    global _current_code, _code_expires_at
    now = time.time()
    
    # If expired or not set, regenerate
    if now >= _code_expires_at:
        # Use visually distinct letters and numbers (excluding 0, 1, I, O, L)
        chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        random_suffix = "".join(secrets.choice(chars) for _ in range(4))
        _current_code = f"ADM-{random_suffix}"
        _code_expires_at = now + 300 # 5 minutes duration
        try:
            with open("bootstrap_code.txt", "w") as f:
                f.write(_current_code)
            print(f"\n>>> [Security] Registration code rotated! New code: {_current_code}\n", flush=True)
        except Exception:
            pass
        
    seconds_left = max(0, int(_code_expires_at - now))
    return _current_code, seconds_left

def validate_authority_code(code: str) -> bool:
    """
    Checks if a user-supplied code matches the current valid code.
    Allows for a grace period of 15 seconds after expiration for usability.
    """
    global _current_code, _code_expires_at
    if not code:
        return False
        
    # Refresh/Rotate code if it has expired, updating bootstrap_code.txt
    get_current_authority_code()
        
    now = time.time()
    # Accept if still valid OR within a 15-second grace period after expiration
    if now < _code_expires_at + 15 and _current_code:
        return _current_code.upper() == code.strip().upper()
    return False


# Admin Session Manager (In-Memory Token Store)
# Structure: { token: (expires_at, username) }
_admin_sessions = {}

def create_admin_session(username: str) -> str:
    """Generates a secure 32-byte hex token for an admin session (valid for 24 hours)."""
    token = secrets.token_hex(32)
    _admin_sessions[token] = (time.time() + 86400, username) # 24 hours expiration
    return token

def is_admin_session_valid(token: str) -> bool:
    """Validates if the provided token exists and is not expired."""
    if not token or token not in _admin_sessions:
        return False
        
    expires_at, username = _admin_sessions[token]
    if time.time() < expires_at:
        return True
        
    # Lazy cleanup of expired session
    del _admin_sessions[token]
    return False

def get_admin_by_token(token: str):
    """Retrieves the username associated with a valid token, or None."""
    if is_admin_session_valid(token):
        return _admin_sessions[token][1]
    return None

def destroy_admin_session(token: str):
    """Removes the admin session token if it exists."""
    if token in _admin_sessions:
        del _admin_sessions[token]
