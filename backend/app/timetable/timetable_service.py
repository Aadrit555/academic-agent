from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from backend.app.models import TimetableEntry, Course, User
from backend.app.schemas import NextClassResponse

def utcnow():
    return datetime.now(timezone.utc)

class TimetableService:
    @classmethod
    def get_entries_for_user(cls, db: Session, user: User) -> list[TimetableEntry]:
        return (
            db.query(TimetableEntry)
            .filter_by(user_id=user.id)
            .order_by(TimetableEntry.day_of_week, TimetableEntry.start_time)
            .all()
        )

    @classmethod
    def get_today_entries(cls, db: Session, user: User, now_dt: datetime = None) -> list[TimetableEntry]:
        dt = now_dt or datetime.now()
        current_day = dt.weekday() # 0 = Monday, ..., 6 = Sunday
        return (
            db.query(TimetableEntry)
            .filter_by(user_id=user.id, day_of_week=current_day)
            .order_by(TimetableEntry.start_time)
            .all()
        )

    @classmethod
    def get_next_class(cls, db: Session, user: User, now_dt: datetime = None) -> NextClassResponse:
        dt = now_dt or datetime.now()
        current_day = dt.weekday()
        current_time_str = dt.strftime("%H:%M")

        today_classes = cls.get_today_entries(db, user, dt)
        if not today_classes:
            # Check upcoming days this week
            for day_offset in range(1, 7):
                check_day = (current_day + day_offset) % 7
                upcoming = (
                    db.query(TimetableEntry)
                    .filter_by(user_id=user.id, day_of_week=check_day)
                    .order_by(TimetableEntry.start_time)
                    .first()
                )
                if upcoming:
                    return NextClassResponse(
                        has_class=True,
                        is_ongoing=False,
                        is_approaching=False,
                        subject=upcoming.subject,
                        start_time=upcoming.start_time,
                        end_time=upcoming.end_time,
                        classroom=upcoming.classroom,
                        course_id=upcoming.course_id
                    )
            return NextClassResponse(has_class=False)

        # 1. Check if any class is ongoing right now
        for entry in today_classes:
            if entry.start_time <= current_time_str <= entry.end_time:
                # Class is currently in session!
                end_hour, end_min = map(int, entry.end_time.split(":"))
                now_hour, now_min = dt.hour, dt.minute
                rem = (end_hour * 60 + end_min) - (now_hour * 60 + now_min)
                return NextClassResponse(
                    has_class=True,
                    is_ongoing=True,
                    is_approaching=False,
                    subject=entry.subject,
                    start_time=entry.start_time,
                    end_time=entry.end_time,
                    classroom=entry.classroom,
                    time_remaining_minutes=max(0, rem),
                    course_id=entry.course_id
                )

        # 2. Check for upcoming class later today
        for entry in today_classes:
            if entry.start_time > current_time_str:
                start_hour, start_min = map(int, entry.start_time.split(":"))
                now_hour, now_min = dt.hour, dt.minute
                diff_minutes = (start_hour * 60 + start_min) - (now_hour * 60 + now_min)
                is_approaching = 0 <= diff_minutes <= 15
                return NextClassResponse(
                    has_class=True,
                    is_ongoing=False,
                    is_approaching=is_approaching,
                    subject=entry.subject,
                    start_time=entry.start_time,
                    end_time=entry.end_time,
                    classroom=entry.classroom,
                    time_remaining_minutes=diff_minutes,
                    course_id=entry.course_id
                )

        # 3. All classes finished today -> pick next available day
        for day_offset in range(1, 7):
            check_day = (current_day + day_offset) % 7
            upcoming = (
                db.query(TimetableEntry)
                .filter_by(user_id=user.id, day_of_week=check_day)
                .order_by(TimetableEntry.start_time)
                .first()
            )
            if upcoming:
                return NextClassResponse(
                    has_class=True,
                    is_ongoing=False,
                    is_approaching=False,
                    subject=upcoming.subject,
                    start_time=upcoming.start_time,
                    end_time=upcoming.end_time,
                    classroom=upcoming.classroom,
                    course_id=upcoming.course_id
                )

        # Fallback to the first class today if recurring
        first_today = today_classes[0]
        return NextClassResponse(
            has_class=True,
            is_ongoing=False,
            is_approaching=False,
            subject=first_today.subject,
            start_time=first_today.start_time,
            end_time=first_today.end_time,
            classroom=first_today.classroom,
            course_id=first_today.course_id
        )

    @classmethod
    def import_entries(cls, db: Session, user: User, entries: list[dict]):
        """Replaces or appends timetable entries."""
        for e in entries:
            subject = e.get("subject", "").strip()
            if not subject:
                continue
            day = int(e.get("day_of_week", 0))
            start_t = e.get("start_time", "10:00").strip()
            end_t = e.get("end_time", "11:00").strip()
            room = e.get("classroom", "AB-204").strip()

            course = db.query(Course).filter_by(user_id=user.id, name=subject).first()
            course_id = course.id if course else None

            entry = TimetableEntry(
                user_id=user.id,
                course_id=course_id,
                subject=subject,
                day_of_week=day,
                start_time=start_t,
                end_time=end_t,
                classroom=room
            )
            db.add(entry)
        db.commit()

    @classmethod
    def seed_default_timetable(cls, db: Session, user: User):
        existing = db.query(TimetableEntry).filter_by(user_id=user.id).first()
        if existing:
            return
            
        current_day = datetime.now().weekday()
        # Seed classes for Monday-Friday, including current day
        days = [current_day, (current_day + 1) % 7, (current_day + 2) % 7]
        entries = []
        for d in set(days):
            entries.extend([
                {"subject": "Data Structures", "day_of_week": d, "start_time": "10:00", "end_time": "11:00", "classroom": "AB-204"},
                {"subject": "Discrete Mathematics", "day_of_week": d, "start_time": "12:00", "end_time": "13:00", "classroom": "AB-302"},
                {"subject": "Algorithms Lab", "day_of_week": d, "start_time": "14:00", "end_time": "16:00", "classroom": "LAB-7"},
            ])
        cls.import_entries(db, user, entries)
