import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.app.database import Base
from backend.app.models import User, TimetableEntry
from backend.app.attendance.attendance_service import AttendanceService

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()

def test_fast_attendance_action(db_session):
    user = User(email="student@university.edu", name="Student")
    db_session.add(user)
    db_session.commit()

    record = AttendanceService.mark_attendance(db_session, user, attendance_code="A235646", subject="Data Structures")
    assert record.id is not None
    assert record.attendance_code == "A235646"
    assert record.subject == "Data Structures"
    assert record.status == "MARKED"

    recents = AttendanceService.get_recent_records(db_session, user)
    assert len(recents) == 1
    assert recents[0].attendance_code == "A235646"

def test_attendance_empty_code_rejected(db_session):
    user = User(email="student@university.edu", name="Student")
    db_session.add(user)
    db_session.commit()

    with pytest.raises(ValueError):
        AttendanceService.mark_attendance(db_session, user, attendance_code="   ")

