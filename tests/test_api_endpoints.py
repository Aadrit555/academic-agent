import os
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import init_db

@pytest.fixture(scope="module")
def client():
    init_db()
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
    res = client.post("/api/config/google-credentials", json={
        "client_id": "test-client-id-12345.apps.googleusercontent.com",
        "client_secret": "test-client-secret-abc",
        "redirect_uri": "http://localhost:8000/api/auth/google/callback"
    })
    assert res.status_code == 200
    data = res.json()
    assert "configured successfully" in data["message"]
    assert "accounts.google.com" in data["auth_url"]

def test_erp_status_and_connect_endpoint(client):
    # Check initial ERP status
    status_res = client.get("/api/erp/status")
    assert status_res.status_code == 200

    # Connect SRM AP ERP session
    conn_res = client.post("/api/erp/connect-session", json={
        "portal_url": "https://student.srmap.edu.in/srmapstudentcorner",
        "session_cookie": "JSESSIONID=TEST_SRMAP_SESSION_ID_12345",
        "student_id": "AP23110010042"
    })
    assert conn_res.status_code == 200
    assert conn_res.json()["is_connected"] is True

    # Check updated ERP status
    status_after = client.get("/api/erp/status")
    assert status_after.status_code == 200
    after_data = status_after.json()
    assert after_data["is_connected"] is True
    assert after_data["student_id"] == "AP23110010042"
    assert len(after_data["attendance_summary"]) > 0

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


