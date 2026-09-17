import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import SessionLocal
from backend.app.models import User, Course, Coursework, ClassroomIntegration
from backend.app.auth.security import create_access_token

client = TestClient(app)

@pytest.fixture
def test_session():
    session = SessionLocal()
    yield session
    session.close()

@pytest.fixture
def auth_context(test_session):
    user = test_session.query(User).filter_by(email="discovery_tester@university.edu").first()
    if not user:
        user = User(email="discovery_tester@university.edu", name="Discovery Tester", role="teacher")
        test_session.add(user)
        test_session.commit()
        test_session.refresh(user)

    from datetime import datetime, timezone, timedelta
    integ = test_session.query(ClassroomIntegration).filter_by(user_id=user.id).first()
    if not integ:
        integ = ClassroomIntegration(
            user_id=user.id,
            email=user.email,
            access_token="ya29.valid_test_access_token",
            refresh_token="test_refresh_token",
            token_expires_at=datetime.now(timezone.utc) + timedelta(hours=2)
        )
        test_session.add(integ)
        test_session.commit()
    else:
        integ.access_token = "ya29.valid_test_access_token"
        integ.token_expires_at = datetime.now(timezone.utc) + timedelta(hours=2)
        test_session.commit()

    token = create_access_token(user.id, user.email, user.role)
    headers = {"Authorization": f"Bearer {token}"}
    
    yield headers, user, test_session

    # Cleanup test artifacts
    test_session.query(Coursework).filter_by(user_id=user.id).delete()
    test_session.query(Course).filter_by(user_id=user.id).delete()
    test_session.query(ClassroomIntegration).filter_by(user_id=user.id).delete()
    test_session.query(User).filter_by(id=user.id).delete()
    test_session.commit()

def test_manifest_discovery_v1_compliance():
    """Verifies that manifest.json conforms to Google Workspace Marketplace Add-on specification."""
    res = client.get("/manifest.json")
    assert res.status_code == 200
    manifest = res.json()

    assert manifest["timeZone"] == "Asia/Kolkata"
    assert "oauthScopes" in manifest
    expected_scopes = [
        "https://www.googleapis.com/auth/classroom.courses.readonly",
        "https://www.googleapis.com/auth/classroom.coursework.me",
        "https://www.googleapis.com/auth/classroom.addons.student",
        "https://www.googleapis.com/auth/classroom.addons.teacher",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/userinfo.email"
    ]
    for scope in expected_scopes:
        assert scope in manifest["oauthScopes"]

    addon_sec = manifest.get("addOns", {})
    assert "common" in addon_sec
    assert addon_sec["common"]["name"] == "Academic Agent"
    assert "openLinkUrlPrefixes" in addon_sec["common"]

    classroom_sec = addon_sec.get("classroom", {})
    assert "attachmentDiscoveryUri" in classroom_sec
    assert "teacherViewUri" in classroom_sec
    assert "studentViewUri" in classroom_sec
    assert "studentWorkReviewUri" in classroom_sec

def test_create_addon_attachment_discovery_schema(auth_context):
    """Verifies courses.courseWork.addOnAttachments.create request & response adherence."""
    headers, user, session = auth_context

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "id": "mock_attachment_999",
        "title": "Academic Agent AI Assignment Executor",
        "courseId": "course_101",
        "itemId": "coursework_202",
        "teacherViewUri": {"uri": "http://127.0.0.1:8000/addon/teacher?courseId=course_101&itemId=coursework_202"},
        "studentViewUri": {"uri": "http://127.0.0.1:8000/addon?courseId=course_101&itemId=coursework_202"},
        "studentWorkReviewUri": {"uri": "http://127.0.0.1:8000/addon/review?courseId=course_101&itemId=coursework_202"},
        "maxPoints": 100.0
    }

    with patch("requests.post", return_value=mock_resp) as mock_post:
        res = client.post(
            "/api/classroom/attachments",
            headers=headers,
            json={
                "course_id": "course_101",
                "item_id": "coursework_202",
                "title": "Academic Agent AI Assignment Executor",
                "base_url": "http://127.0.0.1:8000",
                "max_points": 100.0
            }
        )
        assert res.status_code == 200
        data = res.json()
        assert data["id"] == "mock_attachment_999"

        # Verify Google Classroom API call was made to discovery path
        mock_post.assert_called_once()
        call_args = mock_post.call_args
        assert "v1/courses/course_101/courseWork/coursework_202/addOnAttachments" in call_args[0][0]
        posted_body = call_args[1]["json"]
        assert posted_body["title"] == "Academic Agent AI Assignment Executor"
        assert posted_body["teacherViewUri"]["uri"].startswith("http://127.0.0.1:8000/addon/teacher")
        assert posted_body["studentViewUri"]["uri"].startswith("http://127.0.0.1:8000/addon")
        assert posted_body["studentWorkReviewUri"]["uri"].startswith("http://127.0.0.1:8000/addon/review")
        assert posted_body["maxPoints"] == 100.0

def test_get_addon_context_discovery_schema(auth_context):
    """Verifies courses.courseWork.getAddOnContext adherence."""
    headers, user, session = auth_context

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "courseId": "course_101",
        "itemId": "coursework_202",
        "supportsStudentWork": True,
        "studentContext": {
            "submissionId": "student_sub_456"
        }
    }

    with patch("requests.get", return_value=mock_resp) as mock_get:
        res = client.get(
            "/api/classroom/addon-context?course_id=course_101&item_id=coursework_202",
            headers=headers
        )
        assert res.status_code == 200
        data = res.json()
        assert data["supportsStudentWork"] is True
        assert data["studentContext"]["submissionId"] == "student_sub_456"
        mock_get.assert_called_once()
        assert "v1/courses/course_101/courseWork/coursework_202/addOnContext" in mock_get.call_args[0][0]

def test_grade_passback_discovery_schema(auth_context):
    """Verifies courses.courseWork.addOnAttachments.studentSubmissions.patch grade passback."""
    headers, user, session = auth_context

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "id": "sub_attach_123",
        "pointsEarned": 95.0,
        "postSubmissionState": "TURNED_IN"
    }

    with patch("requests.patch", return_value=mock_resp) as mock_patch:
        res = client.post(
            "/api/classroom/grade-passback",
            headers=headers,
            json={
                "course_id": "course_101",
                "item_id": "coursework_202",
                "attachment_id": "mock_attachment_999",
                "submission_id": "sub_456",
                "points_earned": 95.0
            }
        )
        assert res.status_code == 200
        data = res.json()
        assert data["pointsEarned"] == 95.0
        mock_patch.assert_called_once()
        call_url = mock_patch.call_args[0][0]
        assert "v1/courses/course_101/courseWork/coursework_202/addOnAttachments/mock_attachment_999/studentSubmissions/sub_456" in call_url
        assert "updateMask=pointsEarned" in call_url
        assert mock_patch.call_args[1]["json"] == {"pointsEarned": 95.0}

def test_reclaim_submission_discovery_schema(auth_context):
    """Verifies courses.courseWork.studentSubmissions.reclaim student unsubmit flow."""
    headers, user, session = auth_context

    course = Course(user_id=user.id, code="CS101", name="Intro to Algorithms", classroom_id="c_101")
    session.add(course)
    session.commit()

    cw = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="c_101",
        coursework_id="w_202",
        title="Lab 1 Binary Search",
        status="SUBMITTED",
        submission_id="sub_slot_777"
    )
    session.add(cw)
    session.commit()

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = b'{"state": "CREATED"}'
    mock_resp.json.return_value = {"state": "CREATED"}

    with patch("requests.post", return_value=mock_resp) as mock_post:
        res = client.post(
            "/api/submission/reclaim",
            headers=headers,
            json={"coursework_id": cw.id}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "READY_FOR_SUBMISSION"
        
        # Verify call made to Discovery reclaim method
        mock_post.assert_called_once()
        call_url = mock_post.call_args[0][0]
        assert "v1/courses/c_101/courseWork/w_202/studentSubmissions/sub_slot_777:reclaim" in call_url

        # Check DB state was updated
        session.refresh(cw)
        assert cw.status == "READY_FOR_SUBMISSION"
