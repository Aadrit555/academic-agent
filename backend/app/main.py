import os
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.database import get_db, init_db
from backend.app.models import User, Course, TimetableEntry, Coursework, Document, GeneratedAssignment, AssignmentValidation, SubmissionSchedule, Submission
from backend.app.schemas import (
    HomeSummaryResponse, UserResponse, CourseResponse, TimetableEntryResponse, 
    NextClassResponse, CourseworkResponse, DocumentResponse, StudyBrainRequest, 
    StudyBrainResponse, GenerateAssignmentRequest, GeneratedAssignmentResponse, 
    ValidationResponse, ScheduleSubmissionRequest, SubmissionScheduleResponse, 
    SubmitNowRequest, SubmissionResultResponse, AttendanceMarkRequest, AttendanceResponse
)
from backend.app.auth.auth_service import AuthService, get_or_create_default_user
from backend.app.classroom.classroom_service import ClassroomService
from backend.app.timetable.timetable_service import TimetableService
from backend.app.documents.document_service import DocumentService
from backend.app.rag.rag_service import RAGService
from backend.app.generation.generator_service import GeneratorService
from backend.app.validation.validation_service import ValidationService
from backend.app.submission.submission_service import SubmissionService
from backend.app.scheduler.scheduler_service import SchedulerService
from backend.app.attendance.attendance_service import AttendanceService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("academic_agent")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing Academic Agent Database and Background Scheduler...")
    init_db()
    # Seed default user and timetable
    db = next(get_db())
    try:
        user = get_or_create_default_user(db)
        TimetableService.seed_default_timetable(db, user)
    finally:
        db.close()
    SchedulerService.start()
    yield
    # Shutdown
    SchedulerService.stop()
    logger.info("Academic Agent shutdown complete.")

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper dependency to obtain current user
def current_user(db: Session = Depends(get_db)) -> User:
    return get_or_create_default_user(db)

# ── Home Dashboard Endpoint ──────────────────────────────────────────────────
@app.get("/api/home", response_model=HomeSummaryResponse)
def get_home_summary(db: Session = Depends(get_db), user: User = Depends(current_user)):
    next_class = TimetableService.get_next_class(db, user)
    
    assignments = (
        db.query(Coursework)
        .filter_by(user_id=user.id)
        .order_by(Coursework.due_date.asc())
        .all()
    )

    # Calculate statistics
    materials_count = db.query(Document).filter_by(user_id=user.id).count()
    ready_count = db.query(Coursework).filter_by(user_id=user.id, status="READY").count()
    scheduled_count = (
        db.query(SubmissionSchedule)
        .filter_by(auto_submit_enabled=True, status="SCHEDULED")
        .count()
    )

    assignment_cards = []
    for a in assignments:
        cname = a.course.name if a.course else "Academic Course"
        assignment_cards.append(CourseworkResponse(
            id=a.id,
            user_id=a.user_id,
            course_id=a.course_id,
            course_name=cname,
            classroom_course_id=a.classroom_course_id,
            coursework_id=a.coursework_id,
            title=a.title,
            description=a.description,
            due_date=a.due_date,
            due_time=a.due_time,
            max_points=a.max_points,
            alternate_link=a.alternate_link,
            status=a.status,
            submission_id=a.submission_id,
            created_at=a.created_at
        ))

    return HomeSummaryResponse(
        next_class=next_class,
        current_class=next_class if next_class.is_ongoing else None,
        assignments=assignment_cards,
        stats={
            "materials_count": materials_count,
            "ready_assignments": ready_count,
            "scheduled_submissions": scheduled_count,
            "total_courses": db.query(Course).filter_by(user_id=user.id).count()
        },
        attendance_ready=next_class.has_class and (next_class.is_ongoing or next_class.is_approaching),
        current_subject=next_class.subject if next_class.has_class else None
    )

# ── Auth Endpoints ───────────────────────────────────────────────────────────
@app.get("/api/auth/status")
def get_auth_status(db: Session = Depends(get_db), user: User = Depends(current_user)):
    integ = user.classroom_integration
    return {
        "connected": bool(integ and integ.access_token),
        "email": integ.email if integ else None,
        "is_demo_mode": integ.is_demo_mode if integ else False,
        "last_synced_at": integ.last_synced_at if integ else None
    }

@app.get("/api/auth/google/url")
def get_google_auth_url():
    return {"url": AuthService.get_auth_url()}

@app.get("/api/auth/google/callback")
def google_auth_callback(code: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    try:
        AuthService.exchange_code(db, user, code)
        ClassroomService.sync_classroom_data(db, user)
        return RedirectResponse(url="/?auth_success=true")
    except Exception as e:
        return RedirectResponse(url=f"/?auth_error={str(e)}")

@app.post("/api/auth/connect-demo")
def connect_demo_auth(db: Session = Depends(get_db), user: User = Depends(current_user)):
    AuthService.connect_demo_mode(db, user)
    ClassroomService.sync_classroom_data(db, user)
    return {"message": "Demo Google Classroom environment connected successfully.", "connected": True}

@app.post("/api/auth/disconnect")
def disconnect_auth(db: Session = Depends(get_db), user: User = Depends(current_user)):
    if user.classroom_integration:
        db.delete(user.classroom_integration)
        db.commit()
    return {"message": "Google Classroom disconnected.", "connected": False}

# ── Timetable Endpoints ──────────────────────────────────────────────────────
@app.get("/api/timetable", response_model=list[TimetableEntryResponse])
def get_timetable(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return TimetableService.get_entries_for_user(db, user)

@app.get("/api/timetable/today", response_model=list[TimetableEntryResponse])
def get_today_timetable(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return TimetableService.get_today_entries(db, user)

@app.get("/api/timetable/next", response_model=NextClassResponse)
def get_next_class_info(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return TimetableService.get_next_class(db, user)

@app.post("/api/timetable/import")
def import_timetable(entries: list[dict], db: Session = Depends(get_db), user: User = Depends(current_user)):
    TimetableService.import_entries(db, user, entries)
    return {"message": f"Successfully imported {len(entries)} timetable entries."}

# ── Classroom & Coursework Endpoints ─────────────────────────────────────────
@app.post("/api/classroom/sync")
def sync_classroom(db: Session = Depends(get_db), user: User = Depends(current_user)):
    items = ClassroomService.sync_classroom_data(db, user)
    return {"message": f"Synced {len(items)} assignments from Google Classroom.", "count": len(items)}

@app.get("/api/classroom/courses", response_model=list[CourseResponse])
def get_courses(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.query(Course).filter_by(user_id=user.id).all()

@app.get("/api/classroom/coursework")
def get_coursework_list(db: Session = Depends(get_db), user: User = Depends(current_user)):
    works = db.query(Coursework).filter_by(user_id=user.id).order_by(Coursework.due_date.asc()).all()
    results = []
    for w in works:
        assignment = db.query(GeneratedAssignment).filter_by(coursework_id=w.id).order_by(GeneratedAssignment.id.desc()).first()
        validation = db.query(AssignmentValidation).filter_by(assignment_id=assignment.id).order_by(AssignmentValidation.id.desc()).first() if assignment else None
        schedule = db.query(SubmissionSchedule).filter_by(coursework_id=w.id).first()

        results.append({
            "id": w.id,
            "course_id": w.course_id,
            "course_name": w.course.name if w.course else "Academic Course",
            "classroom_course_id": w.classroom_course_id,
            "coursework_id": w.coursework_id,
            "title": w.title,
            "description": w.description,
            "due_date": w.due_date,
            "due_time": w.due_time,
            "max_points": w.max_points,
            "status": w.status,
            "has_generated_file": bool(assignment),
            "generated_file_name": assignment.file_name if assignment else None,
            "validation_passed": validation.passed if validation else False,
            "schedule": {
                "offset_hours": schedule.offset_hours,
                "scheduled_time": schedule.scheduled_time.isoformat() if schedule else None,
                "auto_submit_enabled": schedule.auto_submit_enabled,
                "status": schedule.status,
            } if schedule else None
        })
    return results

# ── AI Study Brain & Document Ingestion Endpoints ────────────────────────────
@app.post("/api/documents/upload", response_model=DocumentResponse)
async def upload_document(
    course_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user)
):
    content = await file.read()
    doc = DocumentService.ingest_document(db, user, course_id, file.filename, content)
    course = db.query(Course).filter_by(id=course_id).first()
    return DocumentResponse(
        id=doc.id,
        course_id=doc.course_id,
        course_name=course.name if course else "",
        filename=doc.filename,
        file_type=doc.file_type,
        file_size=doc.file_size,
        page_count=doc.page_count,
        uploaded_at=doc.uploaded_at,
        chunk_count=len(doc.chunks)
    )

@app.get("/api/documents/course/{course_id}", response_model=list[DocumentResponse])
def get_course_documents(course_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    docs = db.query(Document).filter_by(course_id=course_id, user_id=user.id).all()
    course = db.query(Course).filter_by(id=course_id).first()
    return [
        DocumentResponse(
            id=d.id,
            course_id=d.course_id,
            course_name=course.name if course else "",
            filename=d.filename,
            file_type=d.file_type,
            file_size=d.file_size,
            page_count=d.page_count,
            uploaded_at=d.uploaded_at,
            chunk_count=len(d.chunks)
        )
        for d in docs
    ]

@app.post("/api/study-brain/query", response_model=StudyBrainResponse)
def query_study_brain(req: StudyBrainRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return RAGService.process_study_action(db, req.course_id, req.action, req.query, req.document_id)

# ── Assignment Generation & Deliverable Endpoints ────────────────────────────
@app.post("/api/assignment/generate", response_model=GeneratedAssignmentResponse)
def generate_assignment(req: GenerateAssignmentRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    cw = db.query(Coursework).filter_by(id=req.coursework_id, user_id=user.id).first()
    if not cw:
        raise HTTPException(status_code=404, detail="Coursework not found")
    return GeneratorService.generate_assignment(db, cw, req.custom_instructions)

@app.get("/api/assignment/{coursework_id}/deliverable")
def get_deliverable(coursework_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    assignment = db.query(GeneratedAssignment).filter_by(coursework_id=coursework_id).order_by(GeneratedAssignment.id.desc()).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="No deliverable generated for this assignment")
    return {
        "id": assignment.id,
        "file_name": assignment.file_name,
        "file_type": assignment.file_type,
        "language": assignment.language,
        "code_or_content": assignment.code_or_content,
        "created_at": assignment.created_at
    }

@app.get("/api/assignment/{coursework_id}/download")
def download_deliverable(coursework_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    assignment = db.query(GeneratedAssignment).filter_by(coursework_id=coursework_id).order_by(GeneratedAssignment.id.desc()).first()
    if not assignment or not os.path.exists(assignment.file_path):
        raise HTTPException(status_code=404, detail="Deliverable file not found on disk")
    return FileResponse(
        path=assignment.file_path,
        filename=assignment.file_name,
        media_type="application/octet-stream"
    )

# ── Code & Document Validation Endpoints ─────────────────────────────────────
@app.post("/api/assignment/{coursework_id}/validate", response_model=ValidationResponse)
def validate_assignment(coursework_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    assignment = db.query(GeneratedAssignment).filter_by(coursework_id=coursework_id).order_by(GeneratedAssignment.id.desc()).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="No deliverable available to validate")
    
    val = ValidationService.validate_assignment(db, assignment)
    checklist = json.loads(val.checklist_json) if val.checklist_json else []
    return ValidationResponse(
        id=val.id,
        assignment_id=val.assignment_id,
        passed=val.passed,
        status=val.status,
        checklist=checklist,
        compiler_output=val.compiler_output,
        test_output=val.test_output,
        error_details=val.error_details,
        validated_at=val.validated_at
    )

@app.get("/api/assignment/{coursework_id}/validation")
def get_validation_report(coursework_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    assignment = db.query(GeneratedAssignment).filter_by(coursework_id=coursework_id).order_by(GeneratedAssignment.id.desc()).first()
    if not assignment:
        return {"has_validation": False}
    val = db.query(AssignmentValidation).filter_by(assignment_id=assignment.id).order_by(AssignmentValidation.id.desc()).first()
    if not val:
        return {"has_validation": False}
    return {
        "has_validation": True,
        "id": val.id,
        "passed": val.passed,
        "status": val.status,
        "checklist": json.loads(val.checklist_json) if val.checklist_json else [],
        "compiler_output": val.compiler_output,
        "test_output": val.test_output,
        "error_details": val.error_details,
        "validated_at": val.validated_at
    }

# ── Scheduling & Submission Endpoints ────────────────────────────────────────
@app.post("/api/assignment/{coursework_id}/schedule", response_model=SubmissionScheduleResponse)
def schedule_submission(coursework_id: int, req: ScheduleSubmissionRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    cw = db.query(Coursework).filter_by(id=coursework_id, user_id=user.id).first()
    if not cw:
        raise HTTPException(status_code=404, detail="Coursework not found")
    return SchedulerService.create_or_update_schedule(db, cw, req.offset_hours or 4.0, req.auto_submit_enabled)

@app.post("/api/assignment/{coursework_id}/submit-now", response_model=SubmissionResultResponse)
def submit_now(coursework_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    cw = db.query(Coursework).filter_by(id=coursework_id, user_id=user.id).first()
    if not cw:
        raise HTTPException(status_code=404, detail="Coursework not found")
    sub = SubmissionService.execute_submission(db, user, cw)
    return SubmissionResultResponse(
        coursework_id=cw.id,
        submission_id=sub.classroom_submission_id,
        state=sub.verified_state,
        drive_file_id=sub.drive_file_id,
        turned_in_at=sub.turned_in_at,
        message="Assignment turned in successfully to Google Classroom."
    )

@app.get("/api/schedules")
def list_schedules(db: Session = Depends(get_db), user: User = Depends(current_user)):
    schedules = (
        db.query(SubmissionSchedule, Coursework)
        .join(Coursework, SubmissionSchedule.coursework_id == Coursework.id)
        .filter(Coursework.user_id == user.id)
        .order_by(SubmissionSchedule.scheduled_time.asc())
        .all()
    )
    results = []
    for s, cw in schedules:
        results.append({
            "schedule_id": s.id,
            "coursework_id": cw.id,
            "title": cw.title,
            "course_name": cw.course.name if cw.course else "Academic Course",
            "deadline": s.deadline_datetime.isoformat(),
            "offset_hours": s.offset_hours,
            "scheduled_time": s.scheduled_time.isoformat(),
            "auto_submit_enabled": s.auto_submit_enabled,
            "status": s.status,
            "failure_reason": s.failure_reason,
            "attempts": s.attempts
        })
    return results

# ── Fast Attendance Action Endpoints ─────────────────────────────────────────
@app.post("/api/attendance/mark", response_model=AttendanceResponse)
def mark_attendance(req: AttendanceMarkRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    try:
        rec = AttendanceService.mark_attendance(db, user, req.attendance_code, req.subject, req.course_id)
        return AttendanceResponse(
            id=rec.id,
            subject=rec.subject,
            attendance_code=rec.attendance_code,
            marked_at=rec.marked_at,
            status=rec.status,
            message=f"Attendance code '{rec.attendance_code}' recorded for {rec.subject}."
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/attendance/recent")
def get_recent_attendance(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return AttendanceService.get_recent_records(db, user)

# ── Expo Demonstration Seeder ────────────────────────────────────────────────
@app.post("/api/demo/setup")
def setup_expo_demonstration(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Seeds the full 12-step demo environment: Classroom, Timetable, Course Materials, Assignment."""
    AuthService.connect_demo_mode(db, user)
    ClassroomService.sync_classroom_data(db, user)
    TimetableService.seed_default_timetable(db, user)

    # Seed sample course documents (Unit-2.pdf and Lab-Manual.pdf)
    ds_course = db.query(Course).filter_by(user_id=user.id, name="Data Structures").first()
    algo_course = db.query(Course).filter_by(user_id=user.id, name="Algorithms Lab").first()

    if ds_course:
        unit2_text = (
            "Data Structures & Algorithms — Unit 2: Divide and Conquer Sorting & Balanced Trees\n\n"
            "1. Merge Sort Algorithm:\n"
            "Merge Sort is an asymptotically optimal divide-and-conquer comparison sorting algorithm. "
            "It divides an array into two halves, recursively sorts both halves using mergeSort(), and "
            "then merges the sorted halves using merge() in O(n) linear time.\n"
            "Recurrence relation: T(n) = 2T(n/2) + O(n). By Master Theorem Case 2, T(n) = Theta(n log n).\n"
            "Space Complexity: Auxiliary space is O(n) for temporary merging buffers.\n\n"
            "2. AVL Trees:\n"
            "An AVL tree is a self-balancing binary search tree where the difference between heights "
            "of left and right subtrees for any node cannot be more than one (Balance Factor = {-1, 0, 1}).\n"
            "When an insertion causes an imbalance:\n"
            "- Left-Left (LL): Resolved by single Right Rotation.\n"
            "- Right-Right (RR): Resolved by single Left Rotation.\n"
            "- Left-Right (LR): Resolved by Left Rotation on child followed by Right Rotation on parent.\n"
            "- Right-Left (RL): Resolved by Right Rotation on child followed by Left Rotation on parent.\n"
            "Lookup, insertion, and deletion all take strictly O(log n) time."
        )
        existing_doc = db.query(Document).filter_by(course_id=ds_course.id, filename="Unit-2.pdf").first()
        if not existing_doc:
            DocumentService.ingest_document(db, user, ds_course.id, "Unit-2.pdf", unit2_text.encode("utf-8"))

    if algo_course:
        lab_manual_text = (
            "Department of Computer Science & Engineering\n"
            "Algorithms Laboratory Manual — Academic Year 2026\n\n"
            "Experiment 4: Implementation of Divide-and-Conquer Merge Sort in C\n"
            "Objective: Write a modular C program to sort an array using Merge Sort.\n"
            "Standard function signatures:\n"
            "void merge(int arr[], int l, int m, int r);\n"
            "void mergeSort(int arr[], int l, int r);\n"
            "Compilation flags: gcc -Wall -Wextra\n"
            "Verification criteria: The code must sort ascending arrays correctly with no compiler warnings."
        )
        existing_lab = db.query(Document).filter_by(course_id=algo_course.id, filename="Lab-Manual.pdf").first()
        if not existing_lab:
            DocumentService.ingest_document(db, user, algo_course.id, "Lab-Manual.pdf", lab_manual_text.encode("utf-8"))

    return {
        "message": "Expo demonstration environment initialized with Classroom, Timetable, Course Materials, and Assignments.",
        "success": True
    }

# ── Serve Frontend SPA ───────────────────────────────────────────────────────
frontend_dir = Path(__file__).resolve().parent.parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/css", StaticFiles(directory=str(frontend_dir / "css")), name="css")
    app.mount("/js", StaticFiles(directory=str(frontend_dir / "js")), name="js")

    @app.get("/")
    def serve_index():
        return FileResponse(str(frontend_dir / "index.html"))
