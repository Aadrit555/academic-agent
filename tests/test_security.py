import pytest
import time
from pathlib import Path
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.main import app
from backend.app.config import settings
from backend.app.database import get_db, SessionLocal
from backend.app.models import User, Course, Coursework, GeneratedAssignment
from backend.app.auth.security import (
    hash_password, verify_password, create_access_token, 
    verify_access_token, sanitize_input
)
from backend.app.auth.auth_service import AuthService

@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

def test_password_hashing_and_verification():
    raw_pass = "SecureStudentPass2026!"
    hashed, salt = hash_password(raw_pass)
    
    # Hash must not equal plain text
    assert hashed != raw_pass
    assert len(salt) == 32 # 16 bytes in hex
    
    # Verification succeeds with matching password
    assert verify_password(raw_pass, hashed, salt) is True
    
    # Verification fails with invalid password
    assert verify_password("WrongPassword!", hashed, salt) is False
    
    # Salting produces different hashes for identical passwords
    hashed2, salt2 = hash_password(raw_pass)
    assert hashed != hashed2
    assert salt != salt2

def test_xss_input_sanitization():
    malicious = "<script>alert('XSS Attack!')</script>"
    sanitized = sanitize_input(malicious)
    assert "<script>" not in sanitized
    assert "&lt;script&gt;" in sanitized
    assert "&quot;" in sanitize_input('hello "world"') or "&#x27;" in sanitize_input("hello 'world'")

def test_jwt_token_signing_and_tampering():
    token = create_access_token(user_id=42, email="student@university.edu", role="student", expires_minutes=60)
    assert token.count(".") == 2
    
    # Verify valid token
    claims = verify_access_token(token)
    assert claims is not None
    assert claims["sub"] == "42"
    assert claims["email"] == "student@university.edu"
    assert claims["role"] == "student"
    
    # Tampered signature should be rejected
    header, payload, sig = token.split(".")
    tampered_sig = sig[:-4] + "AAAA"
    tampered_token = f"{header}.{payload}.{tampered_sig}"
    assert verify_access_token(tampered_token) is None
    
    # Expired token should be rejected
    expired_token = create_access_token(user_id=42, email="student@university.edu", expires_minutes=-10)
    assert verify_access_token(expired_token) is None

def test_auth_registration_and_login(client, db):
    email = f"student_{int(time.time())}@university.edu"
    password = "SuperSafePassword123!"
    name = "Test Student"
    
    # 1. Register
    reg_res = client.post("/api/auth/register", json={
        "email": email,
        "name": name,
        "password": password
    })
    assert reg_res.status_code == 200
    token_data = reg_res.json()
    assert "access_token" in token_data
    token = token_data["access_token"]
    
    # 2. Access /api/auth/me with Bearer token
    me_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    assert me_res.json()["email"] == email.lower()
    
    # 3. Login with registered credentials
    login_res = client.post("/api/auth/login", json={
        "email": email,
        "password": password
    })
    assert login_res.status_code == 200
    assert "access_token" in login_res.json()
    
    # 4. Login with invalid password fails (401)
    bad_login = client.post("/api/auth/login", json={
        "email": email,
        "password": "WrongPassword123!"
    })
    assert bad_login.status_code == 401

def test_security_headers(client):
    res = client.get("/api/home")
    headers = res.headers
    
    assert "content-security-policy" in headers
    assert headers.get("x-frame-options") == "DENY"
    assert headers.get("x-content-type-options") == "nosniff"
    assert "strict-transport-security" in headers
    assert headers.get("referrer-policy") == "strict-origin-when-cross-origin"

def test_admin_route_protection(client, db):
    # Regular student token with registered user in DB
    student = AuthService.register_user(db, f"student_perm_{int(time.time())}@univ.edu", "Normal Student", "StudentPass123!", role="student")
    student_token = create_access_token(user_id=student.id, email=student.email, role="student")
    
    res = client.get("/api/admin/audit", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 403
    assert "Administrative privileges required" in res.json()["detail"]
    
    # Create admin user and test
    admin_user = db.query(User).filter_by(role="admin").first()
    if not admin_user:
        pwd_hash, salt = hash_password("AdminSecure2026!")
        admin_user = User(
            email="admin@university.edu",
            name="System Administrator",
            hashed_password=pwd_hash,
            salt=salt,
            role="admin",
            is_active=True
        )
        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)
    
    admin_token = create_access_token(user_id=admin_user.id, email=admin_user.email, role="admin")
    admin_res = client.get("/api/admin/audit", headers={"Authorization": f"Bearer {admin_token}"})
    assert admin_res.status_code == 200
    audit_data = admin_res.json()
    assert audit_data["status"] == "SECURE"
    assert audit_data["debug_mode"] is False

def test_idor_protection_between_users(client, db):
    # Create User A
    pwd_a, salt_a = hash_password("PassUserA123!")
    user_a = User(email=f"user_a_{int(time.time())}@univ.edu", name="User A", hashed_password=pwd_a, salt=salt_a, role="student")
    db.add(user_a)
    db.commit()
    db.refresh(user_a)
    
    # Create Course & Coursework for User A
    course_a = Course(user_id=user_a.id, name="Security Engineering")
    db.add(course_a)
    db.commit()
    db.refresh(course_a)
    
    cw_a = Coursework(
        user_id=user_a.id,
        course_id=course_a.id,
        classroom_course_id="c_100",
        coursework_id="cw_100",
        title="Protected Assignment A",
        status="READY"
    )
    db.add(cw_a)
    db.commit()
    db.refresh(cw_a)
    
    # Create deliverable file for User A
    deliv_file = settings.GENERATED_DIR / f"test_deliv_{user_a.id}.c"
    deliv_file.write_text("// Confidential deliverable for User A")
    
    gen_a = GeneratedAssignment(
        coursework_id=cw_a.id, 
        file_name=deliv_file.name, 
        file_path=str(deliv_file), 
        file_type="c", 
        language="c", 
        code_or_content="// test"
    )
    db.add(gen_a)
    db.commit()
    
    # Create User B
    pwd_b, salt_b = hash_password("PassUserB123!")
    user_b = User(email=f"user_b_{int(time.time())}@univ.edu", name="User B", hashed_password=pwd_b, salt=salt_b, role="student")
    db.add(user_b)
    db.commit()
    db.refresh(user_b)
    
    token_b = create_access_token(user_id=user_b.id, email=user_b.email, role="student")
    
    # User B tries to view or download User A's coursework deliverable -> BLOCKED with 404
    h = {"Authorization": f"Bearer {token_b}"}
    deliv_res = client.get(f"/api/assignment/{cw_a.id}/deliverable", headers=h)
    assert deliv_res.status_code == 404
    
    download_res = client.get(f"/api/assignment/{cw_a.id}/download", headers=h)
    assert download_res.status_code == 404

def test_path_traversal_protection(client, db):
    # Setup coursework
    user = AuthService.register_user(db, f"traversal_{int(time.time())}@univ.edu", "Traversal Tester", "Password123!")
    course = Course(user_id=user.id, name="Path Security")
    db.add(course)
    db.commit()
    db.refresh(course)
    
    cw = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c_200",
        coursework_id="cw_200",
        title="Traversal Check",
        status="READY"
    )
    db.add(cw)
    db.commit()
    db.refresh(cw)
    
    # Intentionally point file_path outside GENERATED_DIR (e.g., /etc/passwd or ../../app/config.py)
    outside_file = Path(__file__).resolve().parent.parent / "backend" / "app" / "config.py"
    gen = GeneratedAssignment(
        coursework_id=cw.id, 
        file_name="config.py", 
        file_path=str(outside_file), 
        file_type="py", 
        language="python", 
        code_or_content="# forbidden"
    )
    db.add(gen)
    db.commit()
    
    token = create_access_token(user_id=user.id, email=user.email, role="student")
    res = client.get(f"/api/assignment/{cw.id}/download", headers={"Authorization": f"Bearer {token}"})
    
    # Must reject access
    assert res.status_code == 404

def test_rate_limiting(client):
    # Trigger requests on sensitive endpoint until rate limit is tripped
    hit_429 = False
    for i in range(settings.RATE_LIMIT_SENSITIVE_PER_MINUTE + 5):
        res = client.post("/api/auth/login", json={"email": "nonexistent@univ.edu", "password": "pass"})
        if res.status_code == 429:
            hit_429 = True
            assert "retry_after_seconds" in res.json()
            assert "Retry-After" in res.headers
            break
            
    assert hit_429 is True

def test_static_pages_and_custom_404(client):
    # Privacy Policy page
    res_priv = client.get("/privacy")
    assert res_priv.status_code == 200
    assert "Academic Agent" in res_priv.text
    assert "FERPA" in res_priv.text
    
    # Terms page
    res_terms = client.get("/terms")
    assert res_terms.status_code == 200
    assert "Terms" in res_terms.text
    
    # Favicon
    res_fav = client.get("/favicon.svg")
    assert res_fav.status_code == 200
    
    # Custom 404 HTML for browser route
    res_404_page = client.get("/nonexistent-page-url")
    assert res_404_page.status_code == 404
    assert "404" in res_404_page.text
    
    # API 404 JSON
    res_api_404 = client.get("/api/nonexistent-endpoint")
    assert res_api_404.status_code == 404
    assert res_api_404.json()["error"] == "Resource Not Found"
