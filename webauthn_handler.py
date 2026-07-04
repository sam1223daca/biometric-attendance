from fido2.server import Fido2Server
from fido2.webauthn import (
    PublicKeyCredentialRpEntity,
    PublicKeyCredentialUserEntity,
    AuthenticatorAttachment,
    UserVerificationRequirement,
    RegistrationResponse,
    AuthenticationResponse,
    AttestedCredentialData
)
from fido2.utils import websafe_encode, websafe_decode
import json

def get_fido2_server(rp_id: str):
    # RP ID represents the domain of the site. It cannot be an IP address in production, 
    # but 'localhost' is fully supported.
    rp = PublicKeyCredentialRpEntity(id=rp_id, name="Biometric Attendance System")
    return Fido2Server(rp)

def make_serializable(data):
    """Recursively converts FIDO2 objects to JSON-serializable types."""
    if isinstance(data, dict):
        return {k: make_serializable(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [make_serializable(x) for x in data]
    elif isinstance(data, bytes):
        return websafe_encode(data)
    elif hasattr(data, "value"):  # Enums
        return data.value
    elif hasattr(data, "_asdict"):  # namedtuples
        return make_serializable(data._asdict())
    elif hasattr(data, "keys") and hasattr(data, "__getitem__"):  # dict-like objects
        return make_serializable(dict(data))
    return data

def generate_registration_options(user_id: int, username: str, name: str, rp_id: str, existing_credentials=None):
    server = get_fido2_server(rp_id)
    
    # Map any existing credentials so the authenticator doesn't register them twice
    exclude_credentials = []
    if existing_credentials:
        for cred in existing_credentials:
            try:
                # Reconstruct AttestedCredentialData to pull the descriptor
                cred_data = AttestedCredentialData(websafe_decode(cred["public_key"]))
                exclude_credentials.append(cred_data.credential_id)
            except Exception:
                # If mock credential, just decode the ID
                exclude_credentials.append(websafe_decode(cred["credential_id"]))
                
    user = PublicKeyCredentialUserEntity(
        id=str(user_id).encode("utf-8"),
        name=username,
        display_name=name
    )
    
    # We restrict to platform (internal biometrics like fingerprint/FaceID) 
    # to avoid external hardware keys unless the browser falls back.
    registration_data, state = server.register_begin(
        user=user,
        credentials=exclude_credentials,
        authenticator_attachment=AuthenticatorAttachment.PLATFORM,
        user_verification=UserVerificationRequirement.REQUIRED
    )
    
    options = make_serializable(registration_data.public_key)
    return options, state

def verify_registration(state, response_dict, rp_id):
    server = get_fido2_server(rp_id)
    
    # Parse the response dict received from the client
    credential_data = RegistrationResponse.from_dict(response_dict)
    
    # Complete registration
    auth_data = server.register_complete(state, credential_data)
    
    # Extract details to store in database
    cred_id = websafe_encode(auth_data.credential_data.credential_id)
    pub_key = websafe_encode(bytes(auth_data.credential_data))
    
    return cred_id, pub_key

def generate_authentication_options(username: str, rp_id: str, user_credentials):
    server = get_fido2_server(rp_id)
    
    allowed_credentials = []
    for cred in user_credentials:
        # If it's a mock credential, skip FIDO2 processing
        if cred["is_mock"]:
            continue
        try:
            cred_data = AttestedCredentialData(websafe_decode(cred["public_key"]))
            allowed_credentials.append(cred_data)
        except Exception:
            pass
            
    if not allowed_credentials and not any(c["is_mock"] for c in user_credentials):
        return None, None
        
    # Begin authentication
    auth_data, state = server.authenticate_begin(
        credentials=allowed_credentials,
        user_verification=UserVerificationRequirement.REQUIRED
    )
    
    options = make_serializable(auth_data.public_key)
    return options, state

def verify_authentication(state, response_dict, rp_id, db_credentials):
    server = get_fido2_server(rp_id)
    
    # Find the credential from DB matching the response credential ID
    cred_id_str = response_dict.get("id")
    matching_db_cred = next((c for c in db_credentials if c["credential_id"] == cred_id_str), None)
    
    if not matching_db_cred:
        return False, 0
        
    # If the credential was registered using the simulator, bypass FIDO2 cryptographic checks
    if matching_db_cred["is_mock"]:
        return True, matching_db_cred["sign_count"] + 1
        
    # Reconstruct the credentials array for the FIDO2 server
    allowed_credentials = []
    for c in db_credentials:
        if not c["is_mock"]:
            try:
                allowed_credentials.append(AttestedCredentialData(websafe_decode(c["public_key"])))
            except Exception:
                pass
                
    credential_data = AuthenticationResponse.from_dict(response_dict)
    
    # Complete authentication verification
    auth_data = server.authenticate_complete(
        state,
        credentials=allowed_credentials,
        response=credential_data
    )
    
    # Return verification success and new sign count from client assertion
    new_sign_count = credential_data.response.authenticator_data.counter
    return True, new_sign_count
