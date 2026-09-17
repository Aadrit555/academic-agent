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
