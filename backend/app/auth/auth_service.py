import os
import time
import requests
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from backend.app.config import settings
from backend.app.models import User, ClassroomIntegration

from backend.app.auth.security import hash_password, verify_password, sanitize_input

def utcnow():
    return datetime.now(timezone.utc)

def get_or_create_default_user(db: Session) -> User:
    user = db.query(User).filter_by(id=1).first()
    default_email = "aadrit_y@srmap.edu.in"
    if not user:
        user = db.query(User).filter_by(email=default_email).first()
    if not user:
        pwd_hash, salt = hash_password("Pass@Academic2026!")
        user = User(
            id=1,
            email=default_email,
            name="Aadrit",
            hashed_password=pwd_hash,
            salt=salt,
            role="student",
            is_active=True
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif not user.hashed_password:
        pwd_hash, salt = hash_password("Pass@Academic2026!")
        user.hashed_password = pwd_hash
        user.salt = salt
        db.commit()
    return user

class AuthService:
    @classmethod
    def register_user(cls, db: Session, email: str, name: str, password: str, role: str = "student") -> User:
        clean_email = sanitize_input(email).lower()
        clean_name = sanitize_input(name)
        if not clean_email or "@" not in clean_email:
            raise ValueError("A valid email address is required.")
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters long.")

        existing = db.query(User).filter_by(email=clean_email).first()
        if existing:
            raise ValueError(f"User with email '{clean_email}' already exists.")

        pwd_hash, salt = hash_password(password)
        user = User(
            email=clean_email,
            name=clean_name,
            hashed_password=pwd_hash,
            salt=salt,
            role=role,
            is_active=True
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    @classmethod
    def authenticate_user(cls, db: Session, email: str, password: str) -> Optional[User]:
        clean_email = sanitize_input(email).lower()
        user = db.query(User).filter_by(email=clean_email).first()
        if not user or not user.is_active or not user.hashed_password:
            return None
        if not verify_password(password, user.hashed_password, user.salt):
            return None
        return user

    SCOPES = [
        "https://www.googleapis.com/auth/classroom.courses.readonly",
        "https://www.googleapis.com/auth/classroom.coursework.me",
        "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
        "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
        "https://www.googleapis.com/auth/classroom.addons.student",
        "https://www.googleapis.com/auth/classroom.addons.teacher",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
    ]
    AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    TOKEN_URL = "https://oauth2.googleapis.com/token"

    @classmethod
    def get_auth_url(cls, redirect_uri: str = None, state: str = None, login_hint: str = None) -> str:
        redirect = redirect_uri or settings.GOOGLE_REDIRECT_URI
        client_id = settings.GOOGLE_CLIENT_ID
        if not client_id:
            raise ValueError("Google Client ID is not configured. Please enter your Google Cloud OAuth credentials.")
            
        import urllib.parse
        params = {
            "client_id": client_id,
            "redirect_uri": redirect,
            "response_type": "code",
            "scope": " ".join(cls.SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
        }
        if login_hint:
            params["login_hint"] = login_hint
        if state:
            params["state"] = state
        return f"{cls.AUTH_URL}?{urllib.parse.urlencode(params)}"

    @classmethod
    def exchange_code(cls, db: Session, user: User, code: str, redirect_uri: str = None) -> ClassroomIntegration:
        redirect = redirect_uri or settings.GOOGLE_REDIRECT_URI
        payload = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect,
        }
        resp = requests.post(cls.TOKEN_URL, data=payload, timeout=20)
        resp.raise_for_status()
        data = resp.json()
        
        access_token = data.get("access_token")
        refresh_token = data.get("refresh_token")
        expires_in = int(data.get("expires_in", 3600))
        expires_at = utcnow() + timedelta(seconds=expires_in)
        
        # Get user email
        email = user.email
        try:
            info_resp = requests.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10
            )
            if info_resp.status_code == 200:
                email = info_resp.json().get("email", user.email)
        except Exception:
            pass

        integration = db.query(ClassroomIntegration).filter_by(user_id=user.id).first()
        if not integration:
            integration = ClassroomIntegration(user_id=user.id)
            db.add(integration)
            
        integration.access_token = access_token
        if refresh_token:
            integration.refresh_token = refresh_token
        integration.token_expires_at = expires_at
        integration.email = email
        integration.is_demo_mode = False
        integration.connected_at = utcnow()
        
        db.commit()
        db.refresh(integration)
        return integration

    @classmethod
    def get_valid_token(cls, db: Session, user: User) -> tuple[str | None, bool]:
        """Returns (access_token, False). Handles token refresh automatically for real Google tokens."""
        integration = db.query(ClassroomIntegration).filter_by(user_id=user.id).first()
        if not integration or integration.is_demo_mode or integration.access_token == "demo_google_classroom_token":
            return None, False
            
        now = utcnow()
        expires_at = integration.token_expires_at
        if expires_at is not None and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        needs_refresh = (not expires_at) or (expires_at <= now + timedelta(seconds=60))
        if needs_refresh and integration.refresh_token:
            try:
                payload = {
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "refresh_token": integration.refresh_token,
                    "grant_type": "refresh_token",
                }
                resp = requests.post(cls.TOKEN_URL, data=payload, timeout=20)
                if resp.status_code == 200:
                    data = resp.json()
                    integration.access_token = data.get("access_token", integration.access_token)
                    expires_in = int(data.get("expires_in", 3600))
                    integration.token_expires_at = now + timedelta(seconds=expires_in)
                    db.commit()
            except Exception as e:
                print(f"[AuthService] Token refresh failed: {e}")
                return None, False
                
        return integration.access_token, False


