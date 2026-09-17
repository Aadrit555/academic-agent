import os
from datetime import datetime, timezone, timedelta
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.app.database import Base
from backend.app.models import User, Course, Coursework, GeneratedAssignment, AssignmentValidation, ClassroomIntegration, Submission, SubmissionSchedule
from backend.app.auth.auth_service import AuthService
from backend.app.submission.submission_service import SubmissionService
from backend.app.scheduler.scheduler_service import SchedulerService
from backend.app.config import settings

def utcnow():
    return datetime.now(timezone.utc)

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()

@pytest.fixture
def ready_assignment_fixture(db_session):
    user = User(email="student@university.edu", name="Student")
    db_session.add(user)
    db_session.commit()

    # Connect demo Classroom
    AuthService.connect_demo_mode(db_session, user)

    course = Course(user_id=user.id, code="CS201", name="Data Structures")
    cw = Coursework(
        user_id=user.id,
        course_id=course.id,
        classroom_course_id="demo-course-1",
        coursework_id="demo-work-1",
        title="DAA Lab 4: Merge Sort",
        due_date=(utcnow() + timedelta(days=1)).strftime("%Y-%m-%d"),
        due_time="23:59:00",
        status="READY"
    )
    db_session.add_all([course, cw])
    db_session.commit()

    # Create dummy deliverable on disk
    test_path = settings.GENERATED_DIR / "test_merge.c"
    with open(test_path, "w", encoding="utf-8") as f:
        f.write("#include <stdio.h>\nint main(){return 0;}\n")

    assignment = GeneratedAssignment(
        coursework_id=cw.id,
        file_name="test_merge.c",
        file_path=str(test_path),
        file_type=".c",
        language="c",
        code_or_content="int main(){return 0;}"
    )
    db_session.add(assignment)
    db_session.commit()

    validation = AssignmentValidation(
        assignment_id=assignment.id,
        passed=True,
        status="PASSED",
        checklist_json="[]"
    )
    db_session.add(validation)
    db_session.commit()
    return user, cw, assignment, validation

def test_successful_submission_flow(db_session, ready_assignment_fixture):
    user, cw, _, _ = ready_assignment_fixture

    sub = SubmissionService.execute_submission(db_session, user, cw)
    assert sub.id is not None
    assert sub.verified_state == "TURNED_IN"
    assert sub.drive_file_id.startswith("1Drv-")
    assert cw.status == "SUBMITTED"

def test_blocked_submission_when_validation_not_passed(db_session, ready_assignment_fixture):
    user, cw, assignment, validation = ready_assignment_fixture
    # Mark validation as failed
    validation.passed = False
    validation.status = "FAILED"
    cw.status = "GENERATED"
    db_session.commit()

    with pytest.raises(RuntimeError) as exc_info:
        SubmissionService.execute_submission(db_session, user, cw)
    assert "has not passed" in str(exc_info.value)
    assert cw.status != "SUBMITTED"

def test_blocked_duplicate_submission(db_session, ready_assignment_fixture):
    user, cw, _, _ = ready_assignment_fixture
    # Submit first time
    SubmissionService.execute_submission(db_session, user, cw)
    assert cw.status == "SUBMITTED"

    # Second submission attempt should be blocked
    with pytest.raises(RuntimeError) as exc_info:
        SubmissionService.execute_submission(db_session, user, cw)
    assert "already been submitted" in str(exc_info.value)

def test_schedule_calculation_and_persistence(db_session, ready_assignment_fixture):
    user, cw, assignment, _ = ready_assignment_fixture

    # Schedule 4 hours before deadline
    schedule = SchedulerService.create_or_update_schedule(db_session, cw, offset_hours=4.0, auto_submit_enabled=True)
    assert schedule.id is not None
    assert schedule.offset_hours == 4.0
    assert schedule.status == "SCHEDULED"
    assert cw.status == "SCHEDULED"

    expected_scheduled = schedule.deadline_datetime - timedelta(hours=4.0)
    # Check scheduled_time is approximately deadline - 4 hours
    assert abs((schedule.scheduled_time - expected_scheduled).total_seconds()) < 60

