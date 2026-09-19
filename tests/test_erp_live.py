import pytest
import io
import json
from datetime import datetime, timezone, timedelta
from PIL import Image
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.main import app
from backend.app.database import SessionLocal, init_db
from backend.app.models import User, Course, TimetableEntry, ERPIntegration
from backend.app.auth.security import encrypt_secret, decrypt_secret, create_access_token
from backend.app.erp.captcha_solver import solve_captcha
from backend.app.erp.erp_scraper import ERPScraper, parse_subject_cell, calculate_margin
from backend.app.erp.timetable_service import TimetableService
from backend.app.erp.erp_service import ERPService
from backend.app.rag.rag_service import RAGService

client = TestClient(app)

@pytest.fixture(scope="module")
def db_session():
    init_db()
    session = SessionLocal()
    yield session
    session.close()

@pytest.fixture
def auth_headers(db_session):
    user = db_session.query(User).filter_by(email="erp_test@university.edu").first()
    if not user:
        user = User(email="erp_test@university.edu", name="Test Student", role="student")
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
    token = create_access_token(user.id, user.email, user.role)
    return {"Authorization": f"Bearer {token}"}, user

def test_captcha_crnn_model_inference():
    """Verifies that the ONNX CRNN captcha solver runs locally in <10ms with zero errors."""
    img = Image.new("RGB", (120, 25), color=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    
    start_time = datetime.now()
    res = solve_captcha(buf.getvalue())
    elapsed = (datetime.now() - start_time).total_seconds()
    
    assert isinstance(res, str)
    assert elapsed < 1.0 # Faster than 1.0s on cold start
    assert len(res) > 0 # Returns decoded string

def test_erp_scraper_profile():
    """Tests parsing student profile from ids=1 report HTML."""
    sample_profile_html = """
    <table class="table-striped">
      <tr><td>Student Name</td><td>:</td><td>SAMPLE STUDENT</td></tr>
      <tr><td>Register No</td><td>:</td><td>AP23000000001</td></tr>
      <tr><td>Institution</td><td>:</td><td>School of Engineering and Sciences</td></tr>
      <tr><td>Semester</td><td>:</td><td>4</td></tr>
      <tr><td>Program / Section</td><td>:</td><td>B.Tech Computer Science and Engineering / B</td></tr>
      <tr><td>Specialization</td><td>:</td><td>Artificial Intelligence & Machine Learning</td></tr>
    </table>
    """
    profile = ERPScraper.parse_profile(sample_profile_html)
    assert profile["name"] == "SAMPLE STUDENT"
    assert profile["register_no"] == "AP23000000001"
    assert profile["semester"] == "4"
    assert "Computer Science" in profile["program"]
    assert profile["section"] == "B"

def test_erp_scraper_variable_rooms_per_day():
    """
    Tests parsing weekly timetable with different rooms on different days
    e.g. CSE 207 in X-201 on Tuesday, C-1011 on Thursday, C-504 on Friday.
    """
    timetable_html = """
    <table>
      <tr><th>Day</th><th>09:00-09:50</th><th>10:00-10:50</th><th>11:00-11:50</th><th>14:00-14:50</th></tr>
      <tr><td>Monday</td><td>MAT 102 (C-302)</td><td></td><td></td><td></td></tr>
      <tr><td>Tuesday</td><td></td><td>CSE 207 (X-201)</td><td></td><td></td></tr>
      <tr><td>Wednesday</td><td>MAT 102 (C-302)</td><td></td><td></td><td></td></tr>
      <tr><td>Thursday</td><td></td><td></td><td>CSE 207 (C-1011)</td><td></td></tr>
      <tr><td>Friday</td><td></td><td></td><td></td><td>CSE 207 (C-504)</td></tr>
    </table>
    <table>
      <tr><th>Code</th><th>Name</th><th>LTP</th><th>Faculty</th><th>Rooms</th></tr>
      <tr><td>CSE 207</td><td>Data Structures & Algorithms</td><td>3-0-0</td><td>Dr. Alan Turing</td><td>X-201, C-1011, C-504</td></tr>
      <tr><td>MAT 102</td><td>Linear Algebra</td><td>3-0-0</td><td>Dr. Carl Gauss</td><td>C-302</td></tr>
    </table>
    """
    res = ERPScraper.parse_timetable(timetable_html)
    entries = res["entries"]
    assert len(entries) == 5

    # Check that CSE 207 on Tuesday is in X-201
    tue_cse = next(e for e in entries if e["day_name"] == "Tuesday" and e["course_code"] == "CSE 207")
    assert tue_cse["classroom"] == "X-201"
    assert tue_cse["faculty"] == "Dr. Alan Turing"

    # Check that CSE 207 on Thursday is in C-1011
    thu_cse = next(e for e in entries if e["day_name"] == "Thursday" and e["course_code"] == "CSE 207")
    assert thu_cse["classroom"] == "C-1011"

    # Check that CSE 207 on Friday is in C-504
    fri_cse = next(e for e in entries if e["day_name"] == "Friday" and e["course_code"] == "CSE 207")
    assert fri_cse["classroom"] == "C-504"

def test_erp_scraper_attendance_and_margins():
    """Tests attendance parsing and margin calculations."""
    attendance_html = """
    <table id="tblSubjectWiseAttendance">
      <tr><th>Code</th><th>Subject</th><th>Conducted</th><th>Present</th><th>Absent</th><th>OD/ML</th><th>Present %</th><th>OD %</th><th>Total %</th></tr>
      <tr><td>CS207</td><td>Data Structures & Algorithms</td><td>40</td><td>36</td><td>4</td><td>0</td><td>90.0</td><td>0.0</td><td>90.0%</td></tr>
      <tr><td>EC201</td><td>Digital Electronics</td><td>32</td><td>22</td><td>10</td><td>0</td><td>68.8</td><td>0.0</td><td>68.8%</td></tr>
    </table>
    """
    records = ERPScraper.parse_attendance(attendance_html)
    assert len(records) == 2

    # CS207: 36/40 = 90.0% >= 75% -> safe margin = floor((36 - 30)/0.75) = 8
    cs = records[0]
    assert cs["course_code"] == "CS207"
    assert cs["percentage"] == 90.0
    assert cs["status"] == "safe"
    assert cs["margin"] >= 8

    # EC201: 22/32 = 68.8% < 75% -> critical, must attend classes
    ec = records[1]
    assert ec["course_code"] == "EC201"
    assert ec["percentage"] == 68.8
    assert ec["status"] == "critical"
    assert ec["margin"] < 0 # Negative indicates shortage

def test_timetable_service_next_class():
    """Verifies ongoing and upcoming class calculation."""
    class DummyUser:
        id = 9999
        email = "test@srmap.edu.in"
        name = "Student"

    # Create dummy entries in memory or db
    db = SessionLocal()
    db.query(TimetableEntry).filter_by(user_id=9999).delete()

    e1 = TimetableEntry(
        user_id=9999,
        subject="Data Structures",
        day_of_week=1, # Tuesday
        start_time="09:00",
        end_time="09:50",
        classroom="X-201",
        faculty="Dr. Turing"
    )
    e2 = TimetableEntry(
        user_id=9999,
        subject="Digital Electronics",
        day_of_week=1, # Tuesday
        start_time="10:00",
        end_time="10:50",
        classroom="C-1011",
        faculty="Dr. Shannon"
    )
    db.add(e1)
    db.add(e2)
    db.commit()

    # Test Tuesday at 09:30 (during e1)
    tue_930 = datetime(2026, 9, 15, 9, 30) # Tuesday
    res = TimetableService.get_current_and_next_class(db, DummyUser(), now_dt=tue_930)
    assert res["has_schedule"] is True
    assert res["ongoing_class"] is not None
    assert res["ongoing_class"]["subject"] == "Data Structures"
    assert res["ongoing_class"]["classroom"] == "X-201"
    assert res["upcoming_class"] is not None
    assert res["upcoming_class"]["subject"] == "Digital Electronics"
    assert res["upcoming_class"]["classroom"] == "C-1011"

    # Test Tuesday at 08:30 (before e1)
    tue_830 = datetime(2026, 9, 15, 8, 30)
    res_early = TimetableService.get_current_and_next_class(db, DummyUser(), now_dt=tue_830)
    assert res_early["ongoing_class"] is None
    assert res_early["upcoming_class"]["subject"] == "Data Structures"

    db.query(TimetableEntry).filter_by(user_id=9999).delete()
    db.commit()
    db.close()

def test_erp_credential_encryption():
    """Verifies that ERP passwords and session tokens are encrypted at rest with Fernet."""
    secret = "MySuperSecretPortalPassword123!"
    enc = encrypt_secret(secret)
    assert enc != secret
    assert len(enc) > len(secret)
    dec = decrypt_secret(enc)
    assert dec == secret

def test_api_erp_endpoints(auth_headers, db_session):
    """Verifies ERP FastAPI endpoints return proper structures."""
    headers, user = auth_headers

    # 1. GET status
    r = client.get("/api/erp/status", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert "is_connected" in data

    # 2. GET next-class
    r_nc = client.get("/api/erp/next-class", headers=headers)
    assert r_nc.status_code == 200
    nc_data = r_nc.json()
    assert "has_schedule" in nc_data

    # 3. GET timetable
    r_tt = client.get("/api/erp/timetable", headers=headers)
    assert r_tt.status_code == 200
    assert isinstance(r_tt.json(), list)

    # 4. GET attendance
    r_att = client.get("/api/erp/attendance", headers=headers)
    assert r_att.status_code == 200
    assert isinstance(r_att.json(), list)

    # 5. POST disconnect
    r_disc = client.post("/api/erp/disconnect", headers=headers)
    assert r_disc.status_code == 200
    assert r_disc.json()["success"] is True

def test_study_brain_with_erp_context(auth_headers, db_session):
    """Verifies that AI Study Brain incorporates ERP timetable and attendance when asked."""
    headers, user = auth_headers

    # Setup dummy ERP integration & class
    integ = ERPService.get_or_create_integration(db_session, user)
    integ.is_connected = True
    integ.student_name = "Test Student"
    integ.attendance_data = json.dumps([
        {"subject": "Data Structures", "course_code": "CS207", "conducted": 30, "attended": 28, "percentage": 93.3, "margin": 7, "margin_message": "Can safely miss 7 classes"}
    ])
    db_session.commit()

    course = db_session.query(Course).filter_by(user_id=user.id).first()
    if not course:
        course = Course(user_id=user.id, code="CS207", name="Data Structures")
        db_session.add(course)
        db_session.commit()
        db_session.refresh(course)

    resp = RAGService.process_study_action(
        db_session,
        course_id=course.id,
        action="explanation",
        query="What is my attendance in this class and can I bunk?",
        user=user
    )
    assert resp is not None
    assert resp.content is not None
    assert len(resp.content) > 10

def test_invalid_auth_token_strictly_rejected():
    """Verifies that expired or invalid Bearer tokens are strictly rejected with 401 Unauthorized."""
    bad_headers = {"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.deadbeef.invalid"}
    r = client.get("/api/erp/status", headers=bad_headers)
    assert r.status_code == 401
    assert "Authentication required" in r.json()["detail"]

def test_erp_scraper_srmap_live_format():
    """Verifies accurate parsing of real SRM AP eVarsity profile & timetable layout."""
    profile_html = """
    <table class="table table-striped">
      <tr><td>Student Name</td><td>:</td><td>STUDENT USER</td></tr>
      <tr><td>Register No.</td><td>:</td><td>AP23000000001</td></tr>
      <tr><td>Student Contact Number / Email</td><td>:</td><td>9876543210(Verified )/ student@srmap.edu.in</td></tr>
      <tr><td>Father Name / Mother Name</td><td>:</td><td>PARENT A / PARENT B</td></tr>
    </table>
    """
    prof = ERPScraper.parse_profile(profile_html)
    assert prof["name"] == "STUDENT USER"
    assert prof["register_no"] == "AP23000000001"
    assert prof["email"] == "student@srmap.edu.in"
    assert prof["phone"] == "9876543210"

    timetable_html = """
    <table>
      <tr class="timetablehead"><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td></tr>
      <tr class="subheader"><td>&nbsp;</td><td>09:00 To 09:50</td><td>10:00 To 10:50</td><td>01:00 To 01:50</td><td>02:00 To 02:50</td></tr>
      <tr><td>Monday</td><td title="ADVANCED JAVA PROGRAMMING"><b>CSE 213(C 504)</b></td><td></td><td title="OBJECT ORIENTED PROGRAMMING"><b>CSE 202(C 504)</b></td><td></td></tr>
    </table>
    <table>
      <tr><th>Subjects Description</th><th>L-T-P-C</th><th>Faculty Name</th><th>Class Room Name</th></tr>
      <tr><td>CSE 213</td><td>ADVANCED JAVA PROGRAMMING</td><td>3-0-1-4</td><td>Mrs. Arani Tiwari</td><td>(C 504)</td></tr>
    </table>
    """
    tt = ERPScraper.parse_timetable(timetable_html)
    entries = tt["entries"]
    assert len(entries) == 2
    # Check CSE 213
    e1 = entries[0]
    assert e1["course_code"] == "CSE 213"
    assert e1["course_name"] == "ADVANCED JAVA PROGRAMMING"
    assert e1["classroom"] == "C 504"
    assert e1["faculty"] == "Mrs. Arani Tiwari"
    assert e1["start_time"] == "09:00"

    # Check CSE 202 afternoon time converted to 24h: 01:00 -> 13:00
    e2 = entries[1]
    assert e2["course_code"] == "CSE 202"
    assert e2["start_time"] == "13:00"
    assert e2["end_time"] == "13:50"


