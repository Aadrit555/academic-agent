from datetime import datetime, timezone
from sqlalchemy.orm import Session
from backend.app.models import AttendanceRecord, User, Course
from backend.app.timetable.timetable_service import TimetableService

def utcnow():
    return datetime.now(timezone.utc)

class AttendanceService:
    @classmethod
    def mark_attendance(
        cls, 
        db: Session, 
        user: User, 
        attendance_code: str, 
        subject: str = None, 
        course_id: int = None
    ) -> AttendanceRecord:
        clean_code = attendance_code.strip().upper()
        if not clean_code:
            raise ValueError("Attendance code cannot be empty.")

        # If subject is not provided, detect from current class via timetable
        if not subject:
            next_class_info = TimetableService.get_next_class(db, user)
            if next_class_info.has_class and next_class_info.subject:
                subject = next_class_info.subject
                course_id = next_class_info.course_id
            else:
                subject = "General Class"

        # Record attendance
        record = AttendanceRecord(
            user_id=user.id,
            course_id=course_id,
            subject=subject,
            attendance_code=clean_code,
            marked_at=utcnow(),
            status="MARKED"
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    @classmethod
    def get_recent_records(cls, db: Session, user: User, limit: int = 5) -> list[AttendanceRecord]:
        return (
            db.query(AttendanceRecord)
            .filter_by(user_id=user.id)
            .order_by(AttendanceRecord.marked_at.desc())
            .limit(limit)
            .all()
        )
