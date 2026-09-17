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

def test_expo_demo_setup_endpoint(client):
    res = client.post("/api/demo/setup")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True

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

    # 6. Submit Now (immediate execution)
    sub_res = client.post(f"/api/assignment/{cw_id}/submit-now")
    assert sub_res.status_code == 200
    sub_data = sub_res.json()
    assert sub_data["state"] == "TURNED_IN"
    assert sub_data["drive_file_id"].startswith("1Drv-")

def test_fast_attendance_endpoint(client):
    res = client.post("/api/attendance/mark", json={"attendance_code": "A987654"})
    assert res.status_code == 200
    data = res.json()
    assert data["attendance_code"] == "A987654"
    assert data["status"] == "MARKED"

def test_assignment_spec_endpoint(client):
    w_res = client.get("/api/classroom/coursework")
    works = w_res.json()
    cw_id = works[0]["id"]

    res = client.get(f"/api/assignment/{cw_id}/spec")
    assert res.status_code == 200
    spec = res.json()
    assert "required_files" in spec
    assert "compiler_flags" in spec
    assert "required_tests" in spec
    assert isinstance(spec["required_files"], list)

def test_camera_scan_frame_endpoint(client):
    res = client.post("/api/attendance/scan-frame", json={"code": "A235646"})
    assert res.status_code == 200
    data = res.json()
    assert data["detected"] is True
    assert data["code"] == "A235646"
    assert "subject" in data
    assert "classroom" in data

def test_camera_scan_frame_empty(client):
    res = client.post("/api/attendance/scan-frame", json={"code": "", "frame_data": ""})
    assert res.status_code == 200
    data = res.json()
    assert data["detected"] is False
    assert data["code"] is None

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
    csv_schedule = """Day,Start,End,Subject,Room
Monday,09:00,10:00,Operating Systems,AB-301
Tuesday,11:00,12:00,Computer Networks,C-102
Friday,14:00,15:00,Operating Systems,AB-502
"""
    res = client.post("/api/erp/import-schedule", json={"content": csv_schedule})
    assert res.status_code == 200
    data = res.json()
    assert data["imported_count"] == 3

    # Verify timetable updated in DB
    tt_res = client.get("/api/timetable")
    assert tt_res.status_code == 200
    entries = tt_res.json()
    assert any(e["subject"] == "Operating Systems" for e in entries)
    assert any(e["classroom"] == "AB-502" for e in entries)

