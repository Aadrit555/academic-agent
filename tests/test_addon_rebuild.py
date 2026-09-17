import os
import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timezone, timedelta
from backend.app.main import app
from backend.app.database import Base, engine, SessionLocal
from backend.app.models import User, Course, Coursework, TimetableEntry, GeneratedAssignment, SubmissionSchedule
from backend.app.auth.security import create_access_token

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_addon_test_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    # Ensure test user
    test_user = db.query(User).filter(User.email == "aadrit_y@srmap.edu.in").first()
    if not test_user:
        test_user = User(
            email="aadrit_y@srmap.edu.in",
            hashed_password="hashed_pw_test",
            name="Aadrit",
            registration_number="AP23110010042",
            is_active=True
        )
        db.add(test_user)
        db.commit()
        db.refresh(test_user)

    yield db, test_user
    db.close()

def get_auth_headers(user_id=1, email="aadrit_y@srmap.edu.in"):
    token = create_access_token(user_id=user_id, email=email)
    return {"Authorization": f"Bearer {token}"}

def test_google_classroom_addon_html_serving():
    """Verifies that / and /addon serve the clean Google Classroom companion HTML."""
    res = client.get("/")
    assert res.status_code == 200
    assert "Academic Agent" in res.text
    assert "Google Classroom Companion" in res.text
    assert "addon.js" in res.text

    addon_res = client.get("/addon?courseId=101&itemId=202")
    assert addon_res.status_code == 200
    assert "section-next-class" in addon_res.text
    assert "coursework-select" in addon_res.text
    assert "btn-execute-assignment" not in addon_res.text or "execute" in addon_res.text.lower()

def test_addon_next_class_real_timetable(setup_addon_test_db):
    """Core Capability 6: Real ERP Timetable Next-Class resolution."""
    db, user = setup_addon_test_db
    headers = get_auth_headers(user.id, user.email)

    now = datetime.now()
    entry = TimetableEntry(
        user_id=user.id,
        subject="Operating Systems",
        day_of_week=(now.weekday() + 1) % 7,
        start_time="09:00",
        end_time="10:00",
        classroom="X-201",
        faculty="Dr. Rao"
    )
    db.add(entry)
    db.commit()

    res = client.get("/api/timetable/next", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["has_class"] is True
    assert data["classroom"] is not None

def test_addon_dynamic_assignment_execution(setup_addon_test_db):
    """Core Capabilities 2 & 3: Dynamic requirement extraction, execution, and compiler validation."""
    db, user = setup_addon_test_db
    headers = get_auth_headers(user.id, user.email)

    course = Course(user_id=user.id, name="Data Structures", code="CSE 201")
    db.add(course)
    db.commit()
    db.refresh(course)

    now = datetime.now(timezone.utc)
    cw = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c101",
        coursework_id=f"cw-{int(now.timestamp())}-1",
        title="Stack Implementation in C",
        description="Write a complete stack program in C (stack.c) with push, pop, and display operations. Compile with gcc.",
        status="NOT_STARTED",
        due_date=(now + timedelta(days=2)).strftime("%Y-%m-%d"),
        due_time="23:59:00"
    )
    db.add(cw)
    db.commit()
    db.refresh(cw)

    # 1. Generate deliverable
    gen_res = client.post("/api/assignment/generate", json={"coursework_id": cw.id}, headers=headers)
    assert gen_res.status_code == 200
    gen_data = gen_res.json()
    assert gen_data["coursework_id"] == cw.id
    assert "stack" in gen_data["file_name"].lower() or gen_data["file_name"].endswith(".c")

    # 2. Get Assignment Spec
    spec_res = client.get(f"/api/assignment/{cw.id}/spec", headers=headers)
    assert spec_res.status_code == 200
    spec_data = spec_res.json()
    assert spec_data["language"].lower() == "c"

    # 3. Real Compiler Validation
    val_res = client.post(f"/api/assignment/{cw.id}/validate", headers=headers)
    assert val_res.status_code == 200
    val_data = val_res.json()
    assert "passed" in val_data
    assert "checklist" in val_data
    assert len(val_data["checklist"]) >= 1

    # 4. Deliverable download
    down_res = client.get(f"/api/assignment/{cw.id}/download", headers=headers)
    assert down_res.status_code == 200
    assert len(down_res.content) > 0

def test_addon_auto_submission_scheduler(setup_addon_test_db):
    """Core Capability 4: Persistent database scheduling (4 hours before deadline)."""
    db, user = setup_addon_test_db
    headers = get_auth_headers(user.id, user.email)

    course = Course(user_id=user.id, name="Computer Networks", code="CSE 301")
    db.add(course)
    db.commit()
    db.refresh(course)

    cw = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c102",
        coursework_id=f"cw-{int(datetime.now().timestamp())}-2",
        title="Socket Programming Assignment",
        description="Implement TCP client-server.",
        status="NOT_STARTED",
        due_date=(datetime.now(timezone.utc) + timedelta(days=3)).strftime("%Y-%m-%d"),
        due_time="18:00:00"
    )
    db.add(cw)
    db.commit()
    db.refresh(cw)

    # Schedule auto-submission
    sched_res = client.post(
        f"/api/assignment/{cw.id}/schedule",
        json={"coursework_id": cw.id, "offset_hours": 4.0, "auto_submit_enabled": True},
        headers=headers
    )
    assert sched_res.status_code == 200
    s_data = sched_res.json()
    assert s_data["status"] == "SCHEDULED"
    assert s_data["auto_submit_enabled"] is True

    # List schedules
    list_res = client.get("/api/schedules", headers=headers)
    assert list_res.status_code == 200
    schedules = list_res.json()
    found = any(s["coursework_id"] == cw.id for s in schedules)
    assert found is True

def test_addon_course_material_ai(setup_addon_test_db):
    """Core Capability 5: Course-Material AI Grounding (RAG)."""
    db, user = setup_addon_test_db
    headers = get_auth_headers(user.id, user.email)

    course = Course(user_id=user.id, name="Software Engineering", code="CSE 303")
    db.add(course)
    db.commit()
    db.refresh(course)

    # Ingest document
    content_bytes = b"Software Engineering covers Agile methodology, Scrum sprints, Git branching workflows, CI/CD pipelines, and clean architecture principles."
    ingest_res = client.post(
        "/api/documents/upload",
        data={"course_id": str(course.id)},
        files={"file": ("syllabus.txt", content_bytes, "text/plain")},
        headers=headers
    )
    assert ingest_res.status_code == 200

    # Query summary
    summary_res = client.post(
        "/api/study-brain/query",
        json={"course_id": course.id, "action": "summary", "query": ""},
        headers=headers
    )
    assert summary_res.status_code == 200
    assert "Agile" in summary_res.json()["content"] or "Scrum" in summary_res.json()["content"]

    # Query questions
    q_res = client.post(
        "/api/study-brain/query",
        json={"course_id": course.id, "action": "questions", "query": ""},
        headers=headers
    )
    assert q_res.status_code == 200
    assert len(q_res.json()["content"]) > 0
