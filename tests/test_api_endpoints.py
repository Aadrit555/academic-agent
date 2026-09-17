import os
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import init_db

from datetime import datetime, timezone, timedelta
from backend.app.database import SessionLocal
from backend.app.models import User, Course, Coursework, TimetableEntry, Document, DocumentChunk
from backend.app.auth.security import hash_password

@pytest.fixture(scope="module")
def client():
    init_db()
    db = SessionLocal()
    user = db.query(User).filter_by(email="student@university.edu").first()
    if not user:
        pwd_hash, salt = hash_password("Pass@Academic2026!")
        user = User(
            id=1,
            email="student@university.edu",
            name="Student",
            hashed_password=pwd_hash,
            salt=salt,
            role="student",
            is_active=True
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    course = db.query(Course).filter_by(user_id=user.id).first()
    if not course:
        course = Course(
            user_id=user.id,
            name="Algorithms",
            code="CSE 204"
        )
        db.add(course)
        db.commit()
        db.refresh(course)

    cw = db.query(Coursework).filter_by(user_id=user.id).first()
    if not cw:
        now = datetime.now(timezone.utc)
        cw = Coursework(
            user_id=user.id,
            course_id=course.id,
            classroom_course_id="c_test",
            coursework_id="cw_test_merge",
            title="DAA Lab: Implement Merge Sort in C",
            description="Write MergeSort.c with gcc -Wall -Wextra. Include test cases.",
            status="READY",
            due_date=(now + timedelta(days=2)).strftime("%Y-%m-%d"),
            due_time="23:59:00"
        )
        db.add(cw)
        db.commit()

    now_dt = datetime.now()
    tt = db.query(TimetableEntry).filter_by(user_id=user.id).first()
    if not tt:
        tt = TimetableEntry(
            user_id=user.id,
            subject="Algorithms",
            day_of_week=now_dt.weekday(),
            start_time="00:00",
            end_time="23:59",
            classroom="C-1011",
            faculty="Prof. Test"
        )
        db.add(tt)
        db.commit()

    doc = db.query(Document).filter_by(course_id=course.id).first()
    if not doc:
        doc = Document(
            user_id=user.id,
            course_id=course.id,
            filename="algorithms_notes.txt",
            file_type=".txt",
            file_size=120,
            file_path="uploads/test_doc.txt"
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        chunk = DocumentChunk(
            document_id=doc.id,
            course_id=course.id,
            chunk_index=0,
            content="Merge sort is an efficient, divide-and-conquer comparison-based sorting algorithm with O(n log n) runtime complexity.",
            page_number=1
        )
        db.add(chunk)
        db.commit()

    db.close()
    with TestClient(app) as c:
        yield c

def test_health_and_manifest_endpoints(client):
    h_res = client.get("/api/health")
    assert h_res.status_code == 200
    assert h_res.json()["status"] == "healthy"

    m_res = client.get("/manifest.json")
    assert m_res.status_code == 200
    assert "addOns" in m_res.json()

def test_home_summary_endpoint(client):
    res = client.get("/api/home")
    assert res.status_code == 200
    data = res.json()
    assert "next_class" in data
    assert "assignments" in data
    assert "stats" in data
    assert len(data["assignments"]) > 0

def test_timetable_endpoints(client):
    res = client.get("/api/timetable")
    assert res.status_code == 200
    entries = res.json()
    assert len(entries) > 0

    next_res = client.get("/api/timetable/next")
    assert next_res.status_code == 200
    assert next_res.json()["has_class"] is True

def test_classroom_courses_and_coursework(client):
    c_res = client.get("/api/classroom/courses")
    assert c_res.status_code == 200
    courses = c_res.json()
    assert len(courses) > 0

    w_res = client.get("/api/classroom/coursework")
    assert w_res.status_code == 200
    works = w_res.json()
    assert len(works) > 0

def test_study_brain_query(client):
    c_res = client.get("/api/classroom/courses")
    course_id = c_res.json()[0]["id"]

    query_payload = {
        "course_id": course_id,
        "action": "summary",
        "query": ""
    }
    res = client.post("/api/study-brain/query", json=query_payload)
    assert res.status_code == 200
    data = res.json()
    assert data["action"] == "summary"
    assert len(data["content"]) > 10

def test_assignment_lifecycle_endpoints(client):
    # 1. Fetch coursework
    w_res = client.get("/api/classroom/coursework")
    works = w_res.json()
    target_cw = next((w for w in works if "Merge Sort" in w["title"]), works[0])
    cw_id = target_cw["id"]

    # 2. Generate assignment
    gen_res = client.post("/api/assignment/generate", json={"coursework_id": cw_id})
    assert gen_res.status_code == 200
    gen_data = gen_res.json()
    assert gen_data["file_type"] == ".c"
    assert os.path.exists(gen_data["file_path"])

    # 3. Deliverable fetch & download
    deliv_res = client.get(f"/api/assignment/{cw_id}/deliverable")
    assert deliv_res.status_code == 200
    assert "#include" in deliv_res.json()["code_or_content"]

    dl_res = client.get(f"/api/assignment/{cw_id}/download")
    assert dl_res.status_code == 200
    assert len(dl_res.content) > 0

    # 4. Validate assignment with real compiler
    val_res = client.post(f"/api/assignment/{cw_id}/validate")
    assert val_res.status_code == 200
    val_data = val_res.json()
    assert val_data["passed"] is True
    assert val_data["status"] == "PASSED"
    assert len(val_data["checklist"]) == 6

    # 5. Schedule submission
    sched_res = client.post(f"/api/assignment/{cw_id}/schedule", json={
        "coursework_id": cw_id,
        "offset_hours": 4.0,
        "auto_submit_enabled": True
    })
    assert sched_res.status_code == 200
    assert sched_res.json()["status"] == "SCHEDULED"

    # 6. Submit Now requires valid Google OAuth authorization
    sub_res = client.post(f"/api/assignment/{cw_id}/submit-now")
    assert sub_res.status_code == 400
    assert "Google" in sub_res.json()["detail"]

def test_classroom_addon_iframe_context(client):
    # Tests that when Google Classroom launches the add-on iframe with courseId and itemId
    res = client.get("/addon?courseId=101&itemId=202")
    assert res.status_code == 200
    assert "<!DOCTYPE html>" in res.text
    assert "Academic Agent" in res.text

def test_addon_endpoint(client):
    res = client.get("/addon")
    assert res.status_code == 200
    assert "Academic Agent Companion" in res.text or "<!DOCTYPE html>" in res.text

def test_google_credentials_config_endpoint(client):
    from backend.app.config import settings, BASE_DIR
    env_path = BASE_DIR / ".env"
    original_content = env_path.read_text(encoding="utf-8") if env_path.exists() else None
    orig_cid = settings.GOOGLE_CLIENT_ID
    orig_sec = settings.GOOGLE_CLIENT_SECRET
    orig_red = settings.GOOGLE_REDIRECT_URI
    try:
        res = client.post("/api/config/google-credentials", json={
            "client_id": "test-client-id-12345.apps.googleusercontent.com",
            "client_secret": "test-client-secret-abc",
            "redirect_uri": "http://localhost:8000/api/auth/google/callback"
        })
        assert res.status_code == 200
        data = res.json()
        assert "configured successfully" in data["message"]
        assert "accounts.google.com" in data["auth_url"]
    finally:
        settings.GOOGLE_CLIENT_ID = orig_cid
        settings.GOOGLE_CLIENT_SECRET = orig_sec
        settings.GOOGLE_REDIRECT_URI = orig_red
        if original_content is not None:
            env_path.write_text(original_content, encoding="utf-8")

def test_erp_status_and_connect_endpoint(client):
    # Check initial ERP status
    status_res = client.get("/api/erp/status")
    assert status_res.status_code == 200

    # Connect SRM AP ERP session
    conn_res = client.post("/api/erp/connect-session", json={
        "portal_url": "https://student.srmap.edu.in/srmapstudentcorner",
        "session_cookie": "JSESSIONID=TEST_SRMAP_SESSION_ID_12345",
        "student_id": "AP23000000001"
    })
    assert conn_res.status_code == 200
    assert conn_res.json()["is_connected"] is True

    # Check updated ERP status
    status_after = client.get("/api/erp/status")
    assert status_after.status_code == 200
    after_data = status_after.json()
    assert after_data["is_connected"] is True
    assert after_data["student_id"] == "AP23000000001"
    assert len(after_data["attendance_summary"]) > 0

    # Disconnect ERP to leave database in clean disconnected state
    disc_res = client.post("/api/erp/disconnect")
    assert disc_res.status_code == 200

def test_erp_schedule_import_endpoint(client):
    from backend.app.database import SessionLocal
    from backend.app.models import User
    from backend.app.auth.security import create_access_token
    session = SessionLocal()
    test_user = session.query(User).filter_by(email="import_test@srmap.edu.in").first()
    if not test_user:
        test_user = User(email="import_test@srmap.edu.in", name="Import Tester", role="student")
        session.add(test_user)
        session.commit()
        session.refresh(test_user)
    token = create_access_token(test_user.id, test_user.email, test_user.role)
    session.close()

    auth_headers = {"Authorization": f"Bearer {token}"}
    csv_schedule = """Day,Start,End,Subject,Room
Monday,09:00,10:00,Digital Electronics,X 201
Thursday,09:00,10:00,Digital Electronics,C 1011
Friday,14:00,15:00,Digital Electronics,C 504
"""
    res = client.post("/api/erp/import-schedule", json={"content": csv_schedule}, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["imported_count"] == 3

    # Verify timetable updated in DB for the test user
    tt_res = client.get("/api/timetable", headers=auth_headers)
    assert tt_res.status_code == 200
    entries = tt_res.json()
    assert any(e["subject"] == "Digital Electronics" for e in entries)
    assert any(e["classroom"] == "C 504" for e in entries)


