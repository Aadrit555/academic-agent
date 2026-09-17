import hashlib
import hmac
import json
import base64
import time
import html
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple
from backend.app.config import settings

PBKDF2_ITERATIONS = 600_000

def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    """Hashes password using PBKDF2-HMAC-SHA256 with 600,000 iterations and salt."""
    if not salt:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        PBKDF2_ITERATIONS
    )
    return key.hex(), salt

def verify_password(password: str, hashed_password: str, salt: str) -> bool:
    """Verifies password using constant-time comparison to prevent timing attacks."""
    expected_hash, _ = hash_password(password, salt)
    return hmac.compare_digest(expected_hash, hashed_password)

def _b64_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode('utf-8').rstrip('=')

def _b64_decode(data_str: str) -> bytes:
    padded = data_str + '=' * (-len(data_str) % 4)
    return base64.urlsafe_b64decode(padded)

def create_access_token(user_id: int, email: str, role: str = "student", expires_minutes: int = 1440) -> str:
    """Generates a cryptographically signed HMAC-SHA256 JWT-compatible token."""
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + (expires_minutes * 60)
    }
    
    encoded_header = _b64_encode(json.dumps(header, separators=(',', ':')).encode('utf-8'))
    encoded_payload = _b64_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))
    signing_input = f"{encoded_header}.{encoded_payload}".encode('utf-8')
    
    signature = hmac.new(
        settings.SECRET_KEY.encode('utf-8'),
        signing_input,
        hashlib.sha256
    ).digest()
    
    encoded_signature = _b64_encode(signature)
    return f"{encoded_header}.{encoded_payload}.{encoded_signature}"

def verify_access_token(token: str) -> Optional[dict]:
    """Validates token signature and expiration, returning claims or None."""
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
            
        encoded_header, encoded_payload, encoded_signature = parts
        signing_input = f"{encoded_header}.{encoded_payload}".encode('utf-8')
        
        expected_sig = hmac.new(
            settings.SECRET_KEY.encode('utf-8'),
            signing_input,
            hashlib.sha256
        ).digest()
        
        provided_sig = _b64_decode(encoded_signature)
        if not hmac.compare_digest(expected_sig, provided_sig):
            return None
            
        payload = json.loads(_b64_decode(encoded_payload).decode('utf-8'))
        
        if payload.get("exp", 0) < int(time.time()):
            return None # Expired
            
        return payload
    except Exception:
        return None

def sanitize_input(text: str) -> str:
    """Escapes HTML entities in user input to protect against XSS."""
    if not isinstance(text, str):
        return str(text)
    return html.escape(text.strip(), quote=True)

def _get_fernet():
    from cryptography.fernet import Fernet
    # Derive a deterministic 32-byte url-safe base64 key from settings.SECRET_KEY
    key_bytes = hashlib.sha256(settings.SECRET_KEY.encode('utf-8')).digest()
    fernet_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(fernet_key)

def encrypt_secret(plain_text: str) -> str:
    """Encrypts sensitive plaintext (e.g. ERP password or session token) using authenticated Fernet (AES-128-CBC + HMAC-SHA256)."""
    if not plain_text:
        return ""
    try:
        f = _get_fernet()
        return f.encrypt(plain_text.encode('utf-8')).decode('utf-8')
    except Exception:
        return ""

def decrypt_secret(cipher_text: str) -> str:
    """Decrypts Fernet ciphertext back to plaintext. Returns empty string if invalid or corrupted."""
    if not cipher_text:
        return ""
    try:
        f = _get_fernet()
        return f.decrypt(cipher_text.encode('utf-8')).decode('utf-8')
    except Exception:
        return ""

