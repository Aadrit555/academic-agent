import json
import logging
import requests
from datetime import datetime, date, timedelta, timezone
from sqlalchemy.orm import Session
from backend.app.models import User, Course, Coursework, ClassroomIntegration, Document
from backend.app.auth.auth_service import AuthService
from backend.app.documents.document_service import DocumentService
from backend.app.drive.drive_service import DriveService

API_BASE = "https://classroom.googleapis.com/v1"
logger = logging.getLogger("academic_agent.classroom")

def utcnow():
    return datetime.now(timezone.utc)

class ClassroomService:
    @classmethod
    def _auto_ingest_classroom_drive_file(
        cls,
        db: Session,
        user: User,
        course_id: int,
        drive_id: str,
        file_title: str,
        token: str
    ) -> bool:
        """Downloads classroom drive file and ingests it into Study Brain Document/RAG system if not already present."""
        if not drive_id or not token or token == "demo_google_classroom_token":
            return False

        clean_title = file_title.strip() if file_title else f"classroom_file_{drive_id}.pdf"
        # Avoid duplicate ingestion for this course
        existing = db.query(Document).filter_by(course_id=course_id, filename=clean_title).first()
        if existing:
            return True

        try:
            file_bytes, final_name = DriveService.download_file(drive_id, token, clean_title)
            if file_bytes and len(file_bytes) > 0:
                DocumentService.ingest_document(db, user, course_id, final_name, file_bytes)
                logger.info(f"Auto-ingested Classroom file '{final_name}' into Study Brain for course {course_id}")
                return True
        except Exception as e:
            logger.warning(f"Could not auto-ingest classroom drive file {drive_id} ({file_title}): {e}")
        return False

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

        # Fallback: if no courses found, try querying explicitly as enrolled student
        if not courses_data:
            try:
                r_stud = requests.get(
                    f"{API_BASE}/courses",
                    headers=headers,
                    params={"studentId": "me", "courseStates": "ACTIVE", "pageSize": 50},
                    timeout=20
                )
                if r_stud.status_code == 200:
                    courses_data = r_stud.json().get("courses", [])
            except Exception as e:
                logger.debug(f"Student courses fallback: {e}")

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

            # Auto-ingest course-level materials (courseWorkMaterials) from Classroom
            try:
                cm_resp = requests.get(
                    f"{API_BASE}/courses/{cid}/courseWorkMaterials",
                    headers=headers,
                    params={"pageSize": 50},
                    timeout=15
                )
                if cm_resp.status_code == 200:
                    cm_list = cm_resp.json().get("courseWorkMaterial", [])
                    for cm in cm_list:
                        for m in cm.get("materials", []):
                            df = m.get("driveFile", {}).get("driveFile", {})
                            if df and df.get("id"):
                                cls._auto_ingest_classroom_drive_file(
                                    db, user, course.id, df.get("id"), df.get("title", ""), token
                                )
            except Exception as e:
                logger.debug(f"CourseWorkMaterials fetch skipped for course {cid}: {e}")

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

                # Parse and auto-ingest attached materials (PDFs, drive files, links)
                raw_materials = w.get("materials", [])
                materials_list = []
                for m in raw_materials:
                    df = m.get("driveFile", {}).get("driveFile", {})
                    if df:
                        drive_id = df.get("id")
                        mat_title = df.get("title", "Attached Document")
                        alt_link = df.get("alternateLink", "")
                        ingested = cls._auto_ingest_classroom_drive_file(
                            db, user, course.id, drive_id, mat_title, token
                        )
                        materials_list.append({
                            "id": drive_id,
                            "title": mat_title,
                            "alternateLink": alt_link,
                            "type": "driveFile",
                            "ingested": ingested
                        })
                    elif m.get("link"):
                        lnk = m.get("link", {})
                        materials_list.append({
                            "url": lnk.get("url", ""),
                            "title": lnk.get("title", "External Link"),
                            "type": "link"
                        })

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
                        materials_json=json.dumps(materials_list),
                        status=sub_state
                    )
                    db.add(cw)
                else:
                    cw.title = title
                    cw.description = desc
                    cw.due_date = due_date_str
                    cw.due_time = due_time_str
                    cw.submission_id = sub_id
                    cw.materials_json = json.dumps(materials_list)
                    if cw.status == "NOT_STARTED" and sub_state == "SUBMITTED":
                        cw.status = "SUBMITTED"
                db.commit()
                db.refresh(cw)

                # Default autonomous auto-submission scheduling for active assignments
                if cw.status != "SUBMITTED":
                    from backend.app.scheduler.scheduler_service import SchedulerService
                    SchedulerService.create_or_update_schedule(
                        db, cw, offset_hours=4.0, auto_submit_enabled=True
                    )
                    cw.status = "SCHEDULED"
                    db.commit()
                    db.refresh(cw)

                synced_coursework.append(cw)

        # Update last synced time
        integ = db.query(ClassroomIntegration).filter_by(user_id=user.id).first()
        if integ:
            integ.last_synced_at = utcnow()
            db.commit()

        return synced_coursework


    @classmethod
    def create_addon_attachment(
        cls,
        db: Session,
        user: User,
        course_id: str,
        item_id: str,
        title: str = "Academic Agent AI Assignment Executor",
        base_url: str = "http://127.0.0.1:8000",
        max_points: float = 100.0,
    ) -> dict:
        """Creates an AddOnAttachment on coursework conforming to Google Classroom Discovery v1.
        POST /v1/courses/{courseId}/courseWork/{itemId}/addOnAttachments
        """
        token, is_demo = AuthService.get_valid_token(db, user)
        if not token or is_demo:
            raise RuntimeError("Google Classroom is not connected. Please connect with your Google credentials.")

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        url = f"{API_BASE}/courses/{course_id}/courseWork/{item_id}/addOnAttachments"
        body = {
            "title": title,
            "teacherViewUri": {"uri": f"{base_url}/addon/teacher?courseId={course_id}&itemId={item_id}"},
            "studentViewUri": {"uri": f"{base_url}/addon?courseId={course_id}&itemId={item_id}"},
            "studentWorkReviewUri": {"uri": f"{base_url}/addon/review?courseId={course_id}&itemId={item_id}"},
            "maxPoints": max_points
        }
        resp = requests.post(url, headers=headers, json=body, timeout=20)
        resp.raise_for_status()
        return resp.json()

    @classmethod
    def get_addon_context(cls, db: Session, user: User, course_id: str, item_id: str) -> dict:
        """Fetches AddOnContext for coursework conforming to Google Classroom Discovery v1.
        GET /v1/courses/{courseId}/courseWork/{itemId}/addOnContext
        """
        token, is_demo = AuthService.get_valid_token(db, user)
        if not token or is_demo:
            raise RuntimeError("Google Classroom is not connected.")

        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        url = f"{API_BASE}/courses/{course_id}/courseWork/{item_id}/addOnContext"
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        return resp.json()

    @classmethod
    def list_addon_attachments(cls, db: Session, user: User, course_id: str, item_id: str) -> list[dict]:
        """Lists AddOnAttachments on coursework conforming to Google Classroom Discovery v1.
        GET /v1/courses/{courseId}/courseWork/{itemId}/addOnAttachments
        """
        token, is_demo = AuthService.get_valid_token(db, user)
        if not token or is_demo:
            raise RuntimeError("Google Classroom is not connected.")

        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        url = f"{API_BASE}/courses/{course_id}/courseWork/{item_id}/addOnAttachments"
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        return resp.json().get("addOnAttachments", [])

    @classmethod
    def passback_grade(
        cls,
        db: Session,
        user: User,
        course_id: str,
        item_id: str,
        attachment_id: str,
        submission_id: str,
        points_earned: float
    ) -> dict:
        """Updates student submission points on add-on attachment conforming to Google Classroom Discovery v1.
        PATCH /v1/courses/{courseId}/courseWork/{itemId}/addOnAttachments/{attachmentId}/studentSubmissions/{submissionId}?updateMask=pointsEarned
        """
        token, is_demo = AuthService.get_valid_token(db, user)
        if not token or is_demo:
            raise RuntimeError("Google Classroom is not connected.")

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        url = (
            f"{API_BASE}/courses/{course_id}/courseWork/{item_id}/"
            f"addOnAttachments/{attachment_id}/studentSubmissions/{submission_id}"
            "?updateMask=pointsEarned"
        )
        body = {
            "pointsEarned": float(points_earned)
        }
        resp = requests.patch(url, headers=headers, json=body, timeout=20)
        resp.raise_for_status()
        return resp.json()

