import threading
import time
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from backend.app.database import SessionLocal
from backend.app.models import SubmissionSchedule, Coursework, User, GeneratedAssignment, AssignmentValidation
from backend.app.submission.submission_service import SubmissionService

logger = logging.getLogger("academic_agent.scheduler")

def utcnow():
    return datetime.now(timezone.utc)

class SchedulerService:
    _thread: threading.Thread | None = None
    _running: bool = False
    _lock = threading.Lock()

    @classmethod
    def start(cls):
        with cls._lock:
            if cls._running:
                return
            cls._running = True
            cls._thread = threading.Thread(target=cls._worker_loop, daemon=True, name="AcademicAgentScheduler")
            cls._thread.start()
            logger.info("Academic Agent Scheduler started.")

    @classmethod
    def stop(cls):
        with cls._lock:
            cls._running = False

    @classmethod
    def create_or_update_schedule(
        cls, 
        db: Session, 
        coursework: Coursework, 
        offset_hours: float = 4.0, 
        auto_submit_enabled: bool = True
    ) -> SubmissionSchedule:
        """Calculates submission_time = deadline - offset_hours and persists it."""
        # Calculate deadline datetime
        if coursework.due_date:
            due_str = coursework.due_date
            time_str = coursework.due_time or "23:59:00"
            try:
                # Naive date/time interpreted as UTC for calculation
                deadline_dt = datetime.strptime(f"{due_str} {time_str}", "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            except Exception:
                deadline_dt = utcnow() + timedelta(days=1)
        else:
            # Fallback if no deadline is specified by instructor
            deadline_dt = utcnow() + timedelta(days=1)

        scheduled_dt = deadline_dt - timedelta(hours=offset_hours)
        
        # If scheduled time has already passed, schedule for immediate submission if still before deadline
        now = utcnow()
        if scheduled_dt < now and deadline_dt > now:
            # Schedule within 5 seconds
            scheduled_dt = now + timedelta(seconds=5)

        assignment = db.query(GeneratedAssignment).filter_by(coursework_id=coursework.id).order_by(GeneratedAssignment.id.desc()).first()

        schedule = db.query(SubmissionSchedule).filter_by(coursework_id=coursework.id).first()
        if not schedule:
            schedule = SubmissionSchedule(
                coursework_id=coursework.id,
                assignment_id=assignment.id if assignment else None,
                deadline_datetime=deadline_dt,
                offset_hours=offset_hours,
                scheduled_time=scheduled_dt,
                auto_submit_enabled=auto_submit_enabled,
                status="SCHEDULED" if auto_submit_enabled else "CANCELLED"
            )
            db.add(schedule)
        else:
            schedule.deadline_datetime = deadline_dt
            schedule.offset_hours = offset_hours
            schedule.scheduled_time = scheduled_dt
            schedule.auto_submit_enabled = auto_submit_enabled
            if assignment:
                schedule.assignment_id = assignment.id
            schedule.status = "SCHEDULED" if auto_submit_enabled else "CANCELLED"
            schedule.failure_reason = ""

        if auto_submit_enabled:
            coursework.status = "SCHEDULED"

        db.commit()
        db.refresh(schedule)
        return schedule

    @classmethod
    def _worker_loop(cls):
        while cls._running:
            try:
                cls._check_and_execute_due_schedules()
            except Exception as e:
                logger.error(f"[Scheduler] Error in worker loop: {e}", exc_info=True)
            time.sleep(5)

    @classmethod
    def _check_and_execute_due_schedules(cls):
        db = SessionLocal()
        try:
            now = utcnow()
            due_schedules = (
                db.query(SubmissionSchedule)
                .filter(
                    SubmissionSchedule.auto_submit_enabled == True,
                    SubmissionSchedule.status == "SCHEDULED",
                    SubmissionSchedule.scheduled_time <= now
                )
                .all()
            )

            for schedule in due_schedules:
                coursework = db.query(Coursework).filter_by(id=schedule.coursework_id).first()
                if not coursework:
                    schedule.status = "FAILED"
                    schedule.failure_reason = "Coursework not found"
                    db.commit()
                    continue

                user = db.query(User).filter_by(id=coursework.user_id).first()
                if not user:
                    schedule.status = "FAILED"
                    schedule.failure_reason = "User not found"
                    db.commit()
                    continue

                schedule.status = "SUBMITTING"
                schedule.attempts += 1
                db.commit()

                try:
                    # 1. Autonomous deliverable generation if not already created
                    assignment = (
                        db.query(GeneratedAssignment)
                        .filter_by(coursework_id=coursework.id)
                        .order_by(GeneratedAssignment.id.desc())
                        .first()
                    )
                    if not assignment:
                        from backend.app.generation.generator_service import GeneratorService
                        logger.info(f"[Scheduler] Auto-generating deliverable for '{coursework.title}'...")
                        assignment = GeneratorService.generate_assignment(db, coursework)
                        schedule.assignment_id = assignment.id
                        db.commit()

                    # 2. Autonomous compiler sandbox validation if not yet validated or not passed
                    validation = (
                        db.query(AssignmentValidation)
                        .filter_by(assignment_id=assignment.id)
                        .order_by(AssignmentValidation.id.desc())
                        .first()
                    )
                    if not validation or not validation.passed:
                        from backend.app.validation.validation_service import ValidationService
                        logger.info(f"[Scheduler] Auto-validating deliverable for '{coursework.title}'...")
                        validation = ValidationService.validate_assignment(db, assignment)

                    if not validation.passed:
                        coursework.status = "MANUAL_ACTION_REQUIRED"
                        schedule.status = "MANUAL_ACTION_REQUIRED"
                        schedule.failure_reason = f"Verification failed: {validation.error_details or 'Compiler or test errors'}"
                        db.commit()
                        logger.warning(f"[Scheduler] Halting submission: validation failed for '{coursework.title}'")
                        continue

                    # 3. Authorized submission: Drive upload, modifyAttachments, turnIn
                    SubmissionService.execute_submission(db, user, coursework)
                    schedule.status = "SUBMITTED"
                    schedule.failure_reason = ""
                    db.commit()
                    logger.info(f"[Scheduler] Successfully auto-submitted '{coursework.title}'")
                except Exception as e:
                    if coursework.status != "MANUAL_ACTION_REQUIRED":
                        coursework.status = "FAILED"
                    schedule.status = "MANUAL_ACTION_REQUIRED" if coursework.status == "MANUAL_ACTION_REQUIRED" else "FAILED"
                    schedule.failure_reason = str(e)
                    db.commit()
                    logger.error(f"[Scheduler] Auto-submission status update for '{coursework.title}': {e}")
        finally:
            db.close()

