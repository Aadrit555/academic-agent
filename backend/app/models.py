from datetime import datetime, timezone
import json
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean, Float
from sqlalchemy.orm import relationship
from backend.app.database import Base

def utcnow():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False, default="Student")
    hashed_password = Column(String(255), nullable=False, default="")
    salt = Column(String(64), nullable=False, default="")
    role = Column(String(50), nullable=False, default="student") # "student", "admin"
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)

    # Relationships
    courses = relationship("Course", back_populates="user", cascade="all, delete-orphan")
    timetable_entries = relationship("TimetableEntry", back_populates="user", cascade="all, delete-orphan")
    classroom_integration = relationship("ClassroomIntegration", back_populates="user", uselist=False, cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="user", cascade="all, delete-orphan")
    erp_integration = relationship("ERPIntegration", back_populates="user", uselist=False, cascade="all, delete-orphan")


class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    code = Column(String(50), index=True) # e.g. "CS201"
    name = Column(String(255), nullable=False) # e.g. "Data Structures"
    instructor = Column(String(255), default="")
    color = Column(String(20), default="#4f46e5")
    classroom_id = Column(String(100), default="", index=True) # Google Classroom course ID if linked
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="courses")
    timetable_entries = relationship("TimetableEntry", back_populates="course", cascade="all, delete-orphan")
    coursework = relationship("Coursework", back_populates="course", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="course", cascade="all, delete-orphan")


class TimetableEntry(Base):
    __tablename__ = "timetable_entries"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)
    subject = Column(String(255), nullable=False) # e.g. "Data Structures"
    day_of_week = Column(Integer, nullable=False) # 0=Monday, 1=Tuesday, ..., 6=Sunday
    start_time = Column(String(10), nullable=False) # "10:00"
    end_time = Column(String(10), nullable=False) # "11:00"
    classroom = Column(String(100), default="TBD") # e.g. "C-504", "X-201", "C-1011"
    faculty = Column(String(255), default="") # e.g. "Dr. John Doe"
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="timetable_entries")
    course = relationship("Course", back_populates="timetable_entries")


class ClassroomIntegration(Base):
    __tablename__ = "classroom_integrations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime, nullable=True)
    email = Column(String(255), default="")
    is_demo_mode = Column(Boolean, default=False)
    connected_at = Column(DateTime, default=utcnow)
    last_synced_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="classroom_integration")


class Coursework(Base):
    __tablename__ = "coursework"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)
    classroom_course_id = Column(String(100), nullable=False)
    coursework_id = Column(String(100), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, default="")
    due_date = Column(String(20), nullable=True) # "YYYY-MM-DD"
    due_time = Column(String(20), nullable=True) # "HH:MM:SS"
    max_points = Column(Float, default=100.0)
    alternate_link = Column(String(500), default="")
    submission_id = Column(String(100), default="") # Google studentSubmission ID
    
    # State machine: NOT_STARTED, GENERATING, GENERATED, VALIDATING, READY, SCHEDULED, SUBMITTING, SUBMITTED, FAILED, CANCELLED
    status = Column(String(50), default="NOT_STARTED", index=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    course = relationship("Course", back_populates="coursework")
    generated_assignments = relationship("GeneratedAssignment", back_populates="coursework", cascade="all, delete-orphan")
    submission_schedules = relationship("SubmissionSchedule", back_populates="coursework", cascade="all, delete-orphan")
    submissions = relationship("Submission", back_populates="coursework", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    filename = Column(String(255), nullable=False)
    file_type = Column(String(20), nullable=False) # "pdf", "docx", "txt", "md", "pptx"
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, default=0)
    page_count = Column(Integer, default=1)
    uploaded_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="documents")
    course = relationship("Course", back_populates="documents")
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    page_number = Column(Integer, default=1)
    token_count = Column(Integer, default=0)

    document = relationship("Document", back_populates="chunks")


class GeneratedAssignment(Base):
    __tablename__ = "generated_assignments"

    id = Column(Integer, primary_key=True, index=True)
    coursework_id = Column(Integer, ForeignKey("coursework.id"), nullable=False)
    file_name = Column(String(255), nullable=False) # e.g. "MergeSort.c" or "sorting_report.docx"
    file_path = Column(String(500), nullable=False)
    file_type = Column(String(20), nullable=False) # ".c", ".cpp", ".java", ".py", ".docx", ".pdf"
    language = Column(String(50), default="") # "c", "cpp", "java", "python", "document"
    code_or_content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utcnow)

    coursework = relationship("Coursework", back_populates="generated_assignments")
    validations = relationship("AssignmentValidation", back_populates="assignment", cascade="all, delete-orphan")


class AssignmentValidation(Base):
    __tablename__ = "assignment_validations"

    id = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(Integer, ForeignKey("generated_assignments.id"), nullable=False)
    passed = Column(Boolean, default=False)
    status = Column(String(50), default="PENDING") # "PASSED", "FAILED"
    checklist_json = Column(Text, default="{}") # JSON of checklist steps
    compiler_output = Column(Text, default="")
    test_output = Column(Text, default="")
    error_details = Column(Text, default="")
    validated_at = Column(DateTime, default=utcnow)

    assignment = relationship("GeneratedAssignment", back_populates="validations")


class SubmissionSchedule(Base):
    __tablename__ = "submission_schedules"

    id = Column(Integer, primary_key=True, index=True)
    coursework_id = Column(Integer, ForeignKey("coursework.id"), nullable=False)
    assignment_id = Column(Integer, ForeignKey("generated_assignments.id"), nullable=True)
    deadline_datetime = Column(DateTime, nullable=False)
    offset_hours = Column(Float, default=4.0)
    scheduled_time = Column(DateTime, nullable=False, index=True)
    auto_submit_enabled = Column(Boolean, default=True)
    
    # State: SCHEDULED, SUBMITTING, SUBMITTED, FAILED, CANCELLED
    status = Column(String(50), default="SCHEDULED", index=True)
    failure_reason = Column(Text, default="")
    attempts = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    coursework = relationship("Coursework", back_populates="submission_schedules")


class Submission(Base):
    __tablename__ = "submissions"

    id = Column(Integer, primary_key=True, index=True)
    coursework_id = Column(Integer, ForeignKey("coursework.id"), nullable=False)
    classroom_submission_id = Column(String(100), default="")
    drive_file_id = Column(String(100), default="")
    drive_file_name = Column(String(255), default="")
    turned_in_at = Column(DateTime, default=utcnow)
    verified_state = Column(String(50), default="TURNED_IN")
    response_payload = Column(Text, default="{}")

    coursework = relationship("Coursework", back_populates="submissions")




class ERPIntegration(Base):
    __tablename__ = "erp_integrations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    portal_type = Column(String(50), default="srmap_evarsity") # Strictly SRM AP eVarsity / Student Corner
    portal_url = Column(String(255), default="https://student.srmap.edu.in/srmapstudentcorner")
    session_cookie = Column(Text, default="")
    is_connected = Column(Boolean, default=False)
    student_id = Column(String(100), default="")
    student_name = Column(String(255), default="")
    encrypted_password = Column(Text, default="") # Encrypted ERP password for background refresh
    attendance_data = Column(Text, default="[]") # JSON string of subject-wise attendance percentages
    profile_data = Column(Text, default="{}") # JSON string of student profile (semester, branch, etc.)
    timetable_data = Column(Text, default="[]") # JSON string of full timetable structure
    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="erp_integration")

