from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from backend.app.models import User, TimetableEntry

DAYS_MAP = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

def parse_time_to_minutes(time_str: str) -> int:
    """Converts '09:30' or '14:00' to minutes since midnight."""
    try:
        parts = time_str.strip().split(":")
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        # If hour is 1..7 (pm in 12hr), adjust to 24hr if appropriate
        if h < 8:
            h += 12
        return h * 60 + m
    except Exception:
        return 0

def format_minutes_to_countdown(minutes: int) -> str:
    """Formats countdown into 'in 25 mins' or 'in 1 hr 15 mins'."""
    if minutes <= 0:
        return "now"
    if minutes < 60:
        return f"in {minutes}m"
    hours = minutes // 60
    rem_m = minutes % 60
    return f"in {hours}h {rem_m}m" if rem_m > 0 else f"in {hours}h"

class TimetableService:
    @staticmethod
    def get_current_and_next_class(db: Session, user: User, now_dt: Optional[datetime] = None) -> Dict[str, Any]:
        """
        Dynamically calculates the student's ongoing class and next upcoming class
        based on live ERP timetable entries and current time.
        """
        if now_dt is None:
            # SRM AP is in India Standard Time (UTC+5:30)
            ist_offset = timezone(timedelta(hours=5, minutes=30))
            now_dt = datetime.now(ist_offset)

        current_weekday = now_dt.weekday() # 0 = Monday, 6 = Sunday
        current_mins = now_dt.hour * 60 + now_dt.minute

        # Fetch all timetable entries for the user
        all_entries = db.query(TimetableEntry).filter_by(user_id=user.id).order_by(
            TimetableEntry.day_of_week,
            TimetableEntry.start_time
        ).all()

        if not all_entries:
            return {
                "has_schedule": False,
                "ongoing_class": None,
                "upcoming_class": None,
                "today_classes": [],
                "today_count": 0,
                "remaining_today": 0,
                "message": "No timetable synced. Connect your SRM ERP to view your live schedule."
            }

        # Filter entries for today
        today_entries = [e for e in all_entries if e.day_of_week == current_weekday]
        # Sort by start minutes
        today_entries.sort(key=lambda e: parse_time_to_minutes(e.start_time))

        ongoing_class: Optional[Dict[str, Any]] = None
        upcoming_class: Optional[Dict[str, Any]] = None
        today_classes_summary: List[Dict[str, Any]] = []

        for e in today_entries:
            s_min = parse_time_to_minutes(e.start_time)
            e_min = parse_time_to_minutes(e.end_time)

            status = "upcoming"
            if current_mins >= e_min:
                status = "completed"
            elif current_mins >= s_min and current_mins < e_min:
                status = "ongoing"

            class_dict = {
                "id": e.id,
                "subject": e.subject,
                "course_code": getattr(e.course, "code", "") if e.course else e.subject[:8],
                "start_time": e.start_time,
                "end_time": e.end_time,
                "classroom": e.classroom or "AB-204",
                "faculty": e.faculty or "",
                "status": status,
                "day_name": DAYS_MAP[current_weekday]
            }
            today_classes_summary.append(class_dict)

            # Check if ongoing right now
            if status == "ongoing" and not ongoing_class:
                rem_mins = max(0, e_min - current_mins)
                ongoing_class = {
                    **class_dict,
                    "minutes_remaining": rem_mins,
                    "countdown": f"{rem_mins}m remaining"
                }

            # Check if next upcoming today
            if status == "upcoming" and not upcoming_class:
                diff_mins = max(0, s_min - current_mins)
                upcoming_class = {
                    **class_dict,
                    "minutes_until_start": diff_mins,
                    "countdown": format_minutes_to_countdown(diff_mins)
                }

        # If no more upcoming classes today, find the earliest class on the next available class day
        if not upcoming_class and not ongoing_class:
            for day_offset in range(1, 7):
                check_day = (current_weekday + day_offset) % 7
                day_classes = [e for e in all_entries if e.day_of_week == check_day]
                if day_classes:
                    day_classes.sort(key=lambda e: parse_time_to_minutes(e.start_time))
                    earliest = day_classes[0]
                    day_label = "Tomorrow" if day_offset == 1 else DAYS_MAP[check_day]
                    upcoming_class = {
                        "id": earliest.id,
                        "subject": earliest.subject,
                        "course_code": getattr(earliest.course, "code", "") if earliest.course else earliest.subject[:8],
                        "start_time": earliest.start_time,
                        "end_time": earliest.end_time,
                        "classroom": earliest.classroom or "AB-204",
                        "faculty": earliest.faculty or "",
                        "status": "upcoming",
                        "day_name": day_label,
                        "countdown": f"{day_label} at {earliest.start_time}"
                    }
                    break

        remaining_count = sum(1 for c in today_classes_summary if c["status"] in ("upcoming", "ongoing"))

        return {
            "has_schedule": True,
            "ongoing_class": ongoing_class,
            "upcoming_class": upcoming_class,
            "today_classes": today_classes_summary,
            "today_count": len(today_classes_summary),
            "remaining_today": remaining_count,
            "message": "Live schedule active"
        }

