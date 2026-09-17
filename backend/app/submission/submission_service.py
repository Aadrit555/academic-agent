import json
import requests
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from backend.app.models import Coursework, GeneratedAssignment, AssignmentValidation, Submission, ClassroomIntegration, User
from backend.app.drive.drive_service import DriveService
from backend.app.auth.auth_service import AuthService

API_BASE = "https://classroom.googleapis.com/v1"

def utcnow():
    return datetime.now(timezone.utc)

class SubmissionService:
    @classmethod
    def execute_submission(cls, db: Session, user: User, coursework: Coursework) -> Submission:
        """Executes full authorized submission flow:
        Pre-checks -> Drive Upload -> modifyAttachments -> turnIn -> verify -> record.
        """
        # 1. Pre-check: Already submitted?
        if coursework.status == "SUBMITTED":
            raise RuntimeError(f"Assignment '{coursework.title}' has already been submitted.")

        # 2. Check generated file exists
        assignment = db.query(GeneratedAssignment).filter_by(coursework_id=coursework.id).order_by(GeneratedAssignment.id.desc()).first()
        if not assignment:
            raise RuntimeError(f"No generated deliverable found for assignment '{coursework.title}'. Please generate it first.")

        # 3. Check validation passed
        validation = db.query(AssignmentValidation).filter_by(assignment_id=assignment.id).order_by(AssignmentValidation.id.desc()).first()
        if not validation or not validation.passed:
            raise RuntimeError("Submission blocked: Assignment deliverable has not passed code/document validation.")

        # 4. Check Google Auth
        token, _ = AuthService.get_valid_token(db, user)
        if not token:
            raise RuntimeError("Google authorization expired or not connected. Please connect Google Classroom with valid OAuth credentials.")

        coursework.status = "SUBMITTING"
        db.commit()

        try:
            # 5. Upload file to Drive
            drive_file_id, file_name = DriveService.upload_file(assignment.file_path, token)

            # Live Google Classroom API
            headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
            cid = coursework.classroom_course_id
            wid = coursework.coursework_id

            # Get student submission ID if not already cached
            submission_id = coursework.submission_id
            if not submission_id:
                sr = requests.get(f"{API_BASE}/courses/{cid}/courseWork/{wid}/studentSubmissions?userId=me", headers=headers, timeout=15)
                sr.raise_for_status()
                subs = sr.json().get("studentSubmissions", [])
                if not subs:
                    raise RuntimeError(f"No student submission slot found in Classroom for course {cid}, coursework {wid}.")
                submission_id = subs[0]["id"]
                coursework.submission_id = submission_id

            # Attach drive file
            attach_url = f"{API_BASE}/courses/{cid}/courseWork/{wid}/studentSubmissions/{submission_id}:modifyAttachments"
            attach_body = {"addAttachments": [{"driveFile": {"id": drive_file_id}}]}
            ar = requests.post(attach_url, json=attach_body, headers=headers, timeout=20)
            ar.raise_for_status()

            # Turn in
            turnin_url = f"{API_BASE}/courses/{cid}/courseWork/{wid}/studentSubmissions/{submission_id}:turnIn"
            tr = requests.post(turnin_url, json={}, headers=headers, timeout=20)
            tr.raise_for_status()
            response_payload = tr.json()

            # Verify state
            verify_url = f"{API_BASE}/courses/{cid}/courseWork/{wid}/studentSubmissions/{submission_id}"
            vr = requests.get(verify_url, headers=headers, timeout=15)
            vr.raise_for_status()
            verified_data = vr.json()
            verified_state = verified_data.get("state", "TURNED_IN")

            # Record in DB
            sub_record = Submission(
                coursework_id=coursework.id,
                classroom_submission_id=submission_id,
                drive_file_id=drive_file_id,
                drive_file_name=file_name,
                turned_in_at=utcnow(),
                verified_state=verified_state,
                response_payload=json.dumps(response_payload)
            )
            db.add(sub_record)
            coursework.status = "SUBMITTED"
            db.commit()
            db.refresh(sub_record)
            return sub_record

        except requests.exceptions.HTTPError as he:
            status_code = he.response.status_code if he.response is not None else 500
            err_msg = str(he)
            if he.response is not None:
                try:
                    err_json = he.response.json()
                    err_msg = err_json.get("error", {}).get("message", str(he))
                except Exception:
                    pass

            if status_code == 403 or "ATTACHMENT_NOT_OWNED" in err_msg or "PERMISSION_DENIED" in err_msg or "permission" in err_msg.lower():
                coursework.status = "MANUAL_ACTION_REQUIRED"
                db.commit()
                link = coursework.alternate_link or "Google Classroom"
                raise RuntimeError(
                    f"Classroom requires manual student confirmation: {err_msg}. "
                    f"Deliverable '{assignment.file_name}' is compiled, verified, and uploaded to Drive. "
                    f"Please complete turn-in directly in Classroom: {link}"
                ) from he
            else:
                coursework.status = "FAILED"
                db.commit()
                raise RuntimeError(f"Classroom submission failed (HTTP {status_code}): {err_msg}") from he

        except Exception as e:
            coursework.status = "FAILED"
            db.commit()
            raise RuntimeError(f"Classroom submission failed: {str(e)}") from e

