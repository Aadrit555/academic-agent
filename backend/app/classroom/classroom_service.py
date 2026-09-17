import requests
from datetime import datetime, date, timedelta, timezone
from sqlalchemy.orm import Session
from backend.app.models import User, Course, Coursework, ClassroomIntegration
from backend.app.auth.auth_service import AuthService

API_BASE = "https://classroom.googleapis.com/v1"

def utcnow():
    return datetime.now(timezone.utc)

class ClassroomService:
    @classmethod
    def sync_classroom_data(cls, db: Session, user: User) -> list[Coursework]:
        token, is_demo = AuthService.get_valid_token(db, user)
        if not token or is_demo:
            raise RuntimeError("Google Classroom is not connected. Please connect with your Google Cloud OAuth credentials.")

        return cls._sync_live_data(db, user, token)

    @classmethod
    def _sync_live_data(cls, db: Session, user: User, token: str) -> list[Coursework]:
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        # 1. Fetch courses
        cr = requests.get(f"{API_BASE}/courses", headers=headers, params={"courseStates": "ACTIVE", "pageSize": 50}, timeout=20)
        cr.raise_for_status()
        courses_data = cr.json().get("courses", [])

        synced_coursework = []
        for c in courses_data:
            cid = c.get("id")
            cname = c.get("name") or "Course"
            
            # Find or create local Course
            course = db.query(Course).filter_by(user_id=user.id, classroom_id=cid).first()
            if not course:
                course = Course(
                    user_id=user.id,
                    code=c.get("section") or cid[:6].upper(),
                    name=cname,
                    instructor="",
                    classroom_id=cid
                )
                db.add(course)
                db.commit()
                db.refresh(course)

            # 2. Fetch coursework for this course
            wr = requests.get(f"{API_BASE}/courses/{cid}/courseWork", headers=headers, params={"pageSize": 50}, timeout=20)
            if wr.status_code != 200:
                continue
            works = wr.json().get("courseWork", [])

            for w in works:
                wid = w.get("id")
                title = w.get("title", "Assignment")
                desc = w.get("description", "")
                pts = float(w.get("maxPoints") or 100.0)
                link = w.get("alternateLink", "")

                # Due date / time
                due_obj = w.get("dueDate") or {}
                due_date_str = None
                if due_obj.get("year") and due_obj.get("month") and due_obj.get("day"):
                    due_date_str = f"{due_obj['year']:04d}-{due_obj['month']:02d}-{due_obj['day']:02d}"

                time_obj = w.get("dueTime") or {}
                due_time_str = None
                if time_obj.get("hours") is not None:
                    h = time_obj.get("hours", 23)
                    m = time_obj.get("minutes", 59)
                    due_time_str = f"{h:02d}:{m:02d}:00"

                # Check student submissions
                sub_id = ""
                sub_state = "NOT_STARTED"
                try:
                    sr = requests.get(f"{API_BASE}/courses/{cid}/courseWork/{wid}/studentSubmissions", 
                                      headers=headers, params={"userId": "me"}, timeout=15)
                    if sr.status_code == 200:
                        subs = sr.json().get("studentSubmissions", [])
                        if subs:
                            sub_id = subs[0].get("id", "")
                            if subs[0].get("state") == "TURNED_IN":
                                sub_state = "SUBMITTED"
                except Exception:
                    pass

                cw = db.query(Coursework).filter_by(user_id=user.id, coursework_id=wid).first()
                if not cw:
                    cw = Coursework(
                        user_id=user.id,
                        course_id=course.id,
                        classroom_course_id=cid,
                        coursework_id=wid,
                        title=title,
                        description=desc,
                        due_date=due_date_str,
                        due_time=due_time_str,
                        max_points=pts,
                        alternate_link=link,
                        submission_id=sub_id,
                        status=sub_state
                    )
                    db.add(cw)
                else:
                    cw.title = title
                    cw.description = desc
                    cw.due_date = due_date_str
                    cw.due_time = due_time_str
                    cw.submission_id = sub_id
                    if cw.status == "NOT_STARTED" and sub_state == "SUBMITTED":
                        cw.status = "SUBMITTED"
                db.commit()
                db.refresh(cw)
                synced_coursework.append(cw)

        # Update last synced time
        integ = db.query(ClassroomIntegration).filter_by(user_id=user.id).first()
        if integ:
            integ.last_synced_at = utcnow()
            db.commit()

        return synced_coursework

