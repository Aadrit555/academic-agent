import pytest
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.app.database import Base
from backend.app.models import User, Course, TimetableEntry
from backend.app.timetable.timetable_service import TimetableService

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()

@pytest.fixture
def test_user(db_session):
    user = User(email="teststudent@university.edu", name="Test Student")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user

def test_timetable_entry_creation_and_today(db_session, test_user):
    now = datetime(2026, 9, 21, 9, 0) # Monday
    entry1 = TimetableEntry(
        user_id=test_user.id,
        subject="Data Structures",
        day_of_week=0, # Monday
        start_time="10:00",
        end_time="11:00",
        classroom="AB-204"
    )
    entry2 = TimetableEntry(
        user_id=test_user.id,
        subject="Algorithms Lab",
        day_of_week=0, # Monday
        start_time="14:00",
        end_time="16:00",
        classroom="LAB-7"
    )
    entry3 = TimetableEntry(
        user_id=test_user.id,
        subject="Discrete Mathematics",
        day_of_week=1, # Tuesday
        start_time="12:00",
        end_time="13:00",
        classroom="AB-302"
    )
    db_session.add_all([entry1, entry2, entry3])
    db_session.commit()

    today_entries = TimetableService.get_today_entries(db_session, test_user, now)
    assert len(today_entries) == 2
    assert today_entries[0].subject == "Data Structures"
    assert today_entries[1].subject == "Algorithms Lab"

def test_next_class_approaching_context(db_session, test_user):
    # Class at 10:00, current time 09:52 (8 minutes before class -> approaching!)
    now = datetime(2026, 9, 21, 9, 52) # Monday
    entry = TimetableEntry(
        user_id=test_user.id,
        subject="Data Structures",
        day_of_week=0,
        start_time="10:00",
        end_time="11:00",
        classroom="AB-204"
    )
    db_session.add(entry)
    db_session.commit()

    res = TimetableService.get_next_class(db_session, test_user, now)
    assert res.has_class is True
    assert res.subject == "Data Structures"
    assert res.is_ongoing is False
    assert res.is_approaching is True
    assert res.time_remaining_minutes == 8

def test_next_class_ongoing_context(db_session, test_user):
    # Class 10:00 to 11:00, current time 10:25 (ongoing in session!)
    now = datetime(2026, 9, 21, 10, 25)
    entry = TimetableEntry(
        user_id=test_user.id,
        subject="Data Structures",
        day_of_week=0,
        start_time="10:00",
        end_time="11:00",
        classroom="AB-204"
    )
    db_session.add(entry)
    db_session.commit()

    res = TimetableService.get_next_class(db_session, test_user, now)
    assert res.has_class is True
    assert res.is_ongoing is True
    assert res.is_approaching is False
    assert res.time_remaining_minutes == 35 # 11:00 - 10:25 = 35 minutes left
