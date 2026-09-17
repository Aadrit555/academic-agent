import os
import time
import requests
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from backend.app.config import settings
from backend.app.models import User, ClassroomIntegration

def utcnow():
    return datetime.now(timezone.utc)

def get_or_create_default_user(db: Session) -> User:
    user = db.query(User).first()
    if not user:
        user = User(email="student@university.edu", name="Aadrit")
        db.add(user)
        db.commit()
        db.refresh(user)
    return user

class AuthService:
    SCOPES = [
        "https://www.googleapis.com/auth/classroom.courses.readonly",
        "https://www.googleapis.com/auth/classroom.coursework.me",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/userinfo.email",
    ]
    AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    TOKEN_URL = "https://oauth2.googleapis.com/token"

    @classmethod
    def get_auth_url(cls, redirect_uri: str = None) -> str:
        redirect = redirect_uri or settings.GOOGLE_REDIRECT_URI
        client_id = settings.GOOGLE_CLIENT_ID
        if not client_id:
            # If Google credentials are not set, return simulated demo auth URL
            return f"{settings.APP_BASE_URL}/api/auth/demo-connect"
            
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
    def connect_demo_mode(cls, db: Session, user: User) -> ClassroomIntegration:
        """Connects simulated demo Google Classroom environment for instant evaluation."""
        integration = db.query(ClassroomIntegration).filter_by(user_id=user.id).first()
        if not integration:
            integration = ClassroomIntegration(user_id=user.id)
            db.add(integration)
            
        integration.access_token = "demo_google_classroom_token"
        integration.refresh_token = "demo_refresh_token"
        integration.token_expires_at = utcnow() + timedelta(days=365)
        integration.email = user.email or "student@university.edu"
        integration.is_demo_mode = True
        integration.connected_at = utcnow()
        integration.last_synced_at = utcnow()
        
        db.commit()
        db.refresh(integration)
        return integration

    @classmethod
    def get_valid_token(cls, db: Session, user: User) -> tuple[str | None, bool]:
        """Returns (access_token, is_demo_mode). Handles token refresh automatically."""
        integration = db.query(ClassroomIntegration).filter_by(user_id=user.id).first()
        if not integration:
            return None, False
            
        if integration.is_demo_mode:
            return integration.access_token, True
            
        now = utcnow()
        needs_refresh = (not integration.token_expires_at) or (integration.token_expires_at <= now + timedelta(seconds=60))
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
