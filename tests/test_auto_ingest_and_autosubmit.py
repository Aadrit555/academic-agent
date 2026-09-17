import os
import json
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
from backend.app.models import User, Course, Coursework, Document, DocumentChunk, GeneratedAssignment, AssignmentValidation, SubmissionSchedule, Submission, ClassroomIntegration
from backend.app.drive.drive_service import DriveService
from backend.app.classroom.classroom_service import ClassroomService
from backend.app.scheduler.scheduler_service import SchedulerService
from backend.app.submission.submission_service import SubmissionService

@pytest.fixture
def test_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    yield db
    db.close()

@pytest.fixture
def sample_user(test_db):
    user = User(
        email="student@university.edu",
        name="Test Student",
        hashed_password="hash",
        salt="salt",
        role="student",
        is_active=True
    )
    test_db.add(user)
    test_db.commit()
    test_db.refresh(user)

    integ = ClassroomIntegration(
        user_id=user.id,
        access_token="valid_test_token",
        refresh_token="test_refresh",
        email=user.email,
        is_demo_mode=False
    )
    test_db.add(integ)
    test_db.commit()
    return user

def test_drive_service_download_binary_file():
    """Verifies DriveService.download_file for binary files (e.g. PDF)."""
    with patch("requests.get") as mock_get:
        # Mock metadata call
        meta_resp = MagicMock()
        meta_resp.status_code = 200
        meta_resp.json.return_value = {"id": "12345", "name": "Lab_Spec.pdf", "mimeType": "application/pdf"}

        # Mock download media call
        media_resp = MagicMock()
        media_resp.status_code = 200
        media_resp.content = b"%PDF-1.4 Mock PDF Binary Data"
        media_resp.headers = {"Content-Type": "application/pdf"}

        mock_get.side_effect = [meta_resp, media_resp]

        content, name = DriveService.download_file("12345", "test_token")
        assert name == "Lab_Spec.pdf"
        assert b"%PDF-1.4" in content

def test_drive_service_download_google_doc_export():
    """Verifies DriveService.download_file converts Google Docs to PDF via /export."""
    with patch("requests.get") as mock_get:
        meta_resp = MagicMock()
        meta_resp.status_code = 200
        meta_resp.json.return_value = {
            "id": "gdoc_999",
            "name": "Lecture 5 Notes",
            "mimeType": "application/vnd.google-apps.document"
        }

        export_resp = MagicMock()
        export_resp.status_code = 200
        export_resp.content = b"%PDF-1.5 Exported Google Doc"

        mock_get.side_effect = [meta_resp, export_resp]

        content, name = DriveService.download_file("gdoc_999", "test_token")
        assert name == "Lecture 5 Notes.pdf"
        assert b"%PDF-1.5" in content

def test_classroom_sync_auto_ingests_materials_and_schedules_autosubmit(test_db, sample_user):
    """Verifies ClassroomService._sync_live_data automatically downloads PDFs and creates auto-submit schedules."""
    with patch("requests.get") as mock_get, \
         patch("backend.app.drive.drive_service.DriveService.download_file") as mock_download:

        # Mock download_file returning mock PDF content
        mock_download.return_value = (b"%PDF-1.4 Assignment Specification Sheet Page 1 Page 2", "Lab4_Brief.pdf")

        # Mock courses endpoint
        courses_resp = MagicMock()
        courses_resp.status_code = 200
        courses_resp.json.return_value = {
            "courses": [{
                "id": "course_101",
                "name": "Design and Analysis of Algorithms",
                "section": "CSE301"
            }]
        }

        # Mock courseWorkMaterials endpoint
        materials_resp = MagicMock()
        materials_resp.status_code = 200
        materials_resp.json.return_value = {
            "courseWorkMaterial": [{
                "id": "mat_1",
                "title": "Course Syllabus",
                "materials": [{
                    "driveFile": {
                        "driveFile": {
                            "id": "drv_syllabus",
                            "title": "Syllabus_2026.pdf"
                        }
                    }
                }]
            }]
        }

        # Mock courseWork endpoint
        cw_resp = MagicMock()
        cw_resp.status_code = 200
        cw_resp.json.return_value = {
            "courseWork": [{
                "id": "cw_202",
                "title": "Lab 4 - Merge Sort Implementation in C",
                "description": "Implement merge sort and benchmark with large arrays.",
                "dueDate": {"year": 2026, "month": 12, "day": 1},
                "dueTime": {"hours": 23, "minutes": 59},
                "maxPoints": 100,
                "alternateLink": "https://classroom.google.com/c/101/a/202",
                "materials": [{
                    "driveFile": {
                        "driveFile": {
                            "id": "drv_lab4",
                            "title": "Lab4_Brief.pdf",
                            "alternateLink": "https://drive.google.com/open?id=drv_lab4"
                        }
                    }
                }]
            }]
        }

        # Mock studentSubmissions endpoint
        subs_resp = MagicMock()
        subs_resp.status_code = 200
        subs_resp.json.return_value = {"studentSubmissions": [{"id": "sub_slot_1", "state": "CREATED"}]}

        mock_get.side_effect = [courses_resp, materials_resp, cw_resp, subs_resp]

        works = ClassroomService._sync_live_data(test_db, sample_user, "valid_test_token")
        assert len(works) == 1
        cw = works[0]

        # 1. Verify coursework was scheduled automatically by default
        assert cw.status == "SCHEDULED"
        schedule = test_db.query(SubmissionSchedule).filter_by(coursework_id=cw.id).first()
        assert schedule is not None
        assert schedule.auto_submit_enabled == True
        assert schedule.status == "SCHEDULED"
        assert schedule.offset_hours == 4.0

        # 2. Verify materials were parsed into materials_json
        assert cw.materials_json is not None
        mat_data = json.loads(cw.materials_json)
        assert len(mat_data) == 1
        assert mat_data[0]["title"] == "Lab4_Brief.pdf"
        assert mat_data[0]["type"] == "driveFile"

        # 3. Verify PDF was auto-ingested into Document and DocumentChunk
        docs = test_db.query(Document).filter_by(course_id=cw.course_id).all()
        assert len(docs) >= 1
        chunks = test_db.query(DocumentChunk).filter_by(course_id=cw.course_id).all()
        assert len(chunks) >= 1

def test_autonomous_scheduler_pipeline(test_db, sample_user):
    """Verifies that SchedulerService._check_and_execute_due_schedules autonomously generates, validates, and submits."""
    # Create course and coursework
    course = Course(
        user_id=sample_user.id,
        code="CS101",
        name="Intro to Programming",
        classroom_id="cls_101"
    )
    test_db.add(course)
    test_db.commit()

    cw = Coursework(
        user_id=sample_user.id,
        course_id=course.id,
        classroom_course_id="cls_101",
        coursework_id="cw_303",
        title="Python Calculator",
        description="Write a python calculator that calculates sum and product.",
        due_date="2026-10-10",
        due_time="18:00:00",
        submission_id="sub_slot_303",
        status="SCHEDULED"
    )
    test_db.add(cw)
    test_db.commit()

    # Create due schedule (scheduled_time in the past)
    now = datetime.now(timezone.utc)
    schedule = SubmissionSchedule(
        coursework_id=cw.id,
        deadline_datetime=now + timedelta(hours=2),
        offset_hours=4.0,
        scheduled_time=now - timedelta(minutes=5), # Due now!
        auto_submit_enabled=True,
        status="SCHEDULED"
    )
    test_db.add(schedule)
    test_db.commit()

    # Note: GeneratedAssignment does NOT exist yet.
    # The scheduler should autonomously generate it, validate it, and submit it!
    orig_close = test_db.close
    test_db.close = MagicMock() # Prevent finally from closing session before assertions
    try:
        with patch("backend.app.scheduler.scheduler_service.SessionLocal", return_value=test_db), \
             patch("backend.app.drive.drive_service.DriveService.upload_file", return_value=("drv_file_999", "calculator.py")), \
             patch("requests.post") as mock_post, \
             patch("requests.get") as mock_get:

            # Mock modifyAttachments & turnIn
            post_resp = MagicMock()
            post_resp.status_code = 200
            post_resp.json.return_value = {"state": "TURNED_IN"}
            mock_post.return_value = post_resp

            # Mock verify submission
            get_resp = MagicMock()
            get_resp.status_code = 200
            get_resp.json.return_value = {"state": "TURNED_IN"}
            mock_get.return_value = get_resp

            # Run scheduler execution check
            SchedulerService._check_and_execute_due_schedules()

            test_db.refresh(schedule)
            test_db.refresh(cw)

            # 1. Assignment should have been autonomously generated
            gen = test_db.query(GeneratedAssignment).filter_by(coursework_id=cw.id).first()
            assert gen is not None
            assert gen.language == "python"

            # 2. Assignment should have been autonomously validated
            val = test_db.query(AssignmentValidation).filter_by(assignment_id=gen.id).first()
            assert val is not None
            assert val.passed == True

            # 3. Schedule and Coursework should be SUBMITTED
            assert schedule.status == "SUBMITTED"
            assert cw.status == "SUBMITTED"
    finally:
        test_db.close = orig_close


