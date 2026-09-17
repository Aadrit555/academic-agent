from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime

# User Schemas
class UserBase(BaseModel):
    email: str
    name: str

class UserCreate(UserBase):
    pass

class UserRegister(BaseModel):
    email: str
    name: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(UserBase):
    id: int
    role: str = "student"
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    user: UserResponse

# Course Schemas
class CourseBase(BaseModel):
    code: Optional[str] = ""
    name: str
    instructor: Optional[str] = ""
    color: Optional[str] = "#4f46e5"
    classroom_id: Optional[str] = ""

class CourseCreate(CourseBase):
    pass

class CourseResponse(CourseBase):
    id: int
    user_id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

# Timetable Schemas
class TimetableEntryBase(BaseModel):
    subject: str
    day_of_week: int # 0=Monday, ..., 6=Sunday
    start_time: str # "10:00"
    end_time: str # "11:00"
    classroom: Optional[str] = "TBD"
    faculty: Optional[str] = ""
    course_id: Optional[int] = None

class TimetableEntryCreate(TimetableEntryBase):
    pass

class TimetableEntryResponse(TimetableEntryBase):
    id: int
    user_id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class NextClassResponse(BaseModel):
    has_class: bool
    is_ongoing: bool = False
    is_approaching: bool = False # within 15 min
    subject: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    classroom: Optional[str] = None
    faculty: Optional[str] = None
    day_of_week: Optional[int] = None
    day_name: Optional[str] = None
    time_remaining_minutes: Optional[int] = None
    course_id: Optional[int] = None

# Classroom & Coursework Schemas
class CourseworkResponse(BaseModel):
    id: int
    user_id: int
    course_id: Optional[int]
    course_name: Optional[str] = ""
    classroom_course_id: str
    coursework_id: str
    title: str
    description: Optional[str] = ""
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    max_points: Optional[float] = 100.0
    alternate_link: Optional[str] = ""
    status: str
    submission_id: Optional[str] = ""
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

# Documents & Study Brain Schemas
class DocumentResponse(BaseModel):
    id: int
    course_id: int
    course_name: Optional[str] = ""
    filename: str
    file_type: str
    file_size: int
    page_count: int
    uploaded_at: datetime
    chunk_count: Optional[int] = 0
    model_config = ConfigDict(from_attributes=True)

class StudyBrainRequest(BaseModel):
    course_id: int
    action: str # "summary", "questions", "explanation", "targeted_study"
    query: Optional[str] = ""
    document_id: Optional[int] = None

class StudyCitation(BaseModel):
    document_name: str
    page_number: int
    snippet: str

class StudyBrainResponse(BaseModel):
    action: str
    title: str
    content: str
    citations: List[StudyCitation] = []
    course_id: int
    document_name: Optional[str] = None

# Assignment Generation Schemas
class AssignmentSpecificationResponse(BaseModel):
    course: str
    title: str
    description: str
    deadline: Optional[str] = None
    language: str
    required_files: List[str] = []
    required_formats: List[str] = []
    required_programs: List[str] = []
    required_tests: List[str] = []
    required_experiments: List[str] = []
    required_figures: List[str] = []
    required_tables: List[str] = []
    required_report: bool = False
    required_outputs: List[str] = []
    compiler_flags: Optional[str] = ""
    submission_constraints: List[str] = []
    packaging_requirements: Optional[str] = ""
    submission_requirements: List[str] = []

class GenerateAssignmentRequest(BaseModel):
    coursework_id: int
    custom_instructions: Optional[str] = ""

class GeneratedAssignmentResponse(BaseModel):
    id: int
    coursework_id: int
    file_name: str
    file_path: str
    file_type: str
    language: str
    code_or_content: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

# Validation Schemas
class ValidationCheckItem(BaseModel):
    step: str
    title: str
    passed: bool
    details: Optional[str] = ""

class ValidationResponse(BaseModel):
    id: int
    assignment_id: int
    passed: bool
    status: str
    checklist: List[ValidationCheckItem]
    stdout: Optional[str] = ""
    stderr: Optional[str] = ""
    model_config = ConfigDict(from_attributes=True)

# Submission Scheduling Schemas
class ScheduleSubmissionRequest(BaseModel):
    coursework_id: int
    offset_hours: Optional[float] = 4.0 # Default: 4 hours before deadline
    auto_submit_enabled: Optional[bool] = True

class SubmissionScheduleResponse(BaseModel):
    id: int
    coursework_id: int
    assignment_id: Optional[int]
    deadline_datetime: datetime
    offset_hours: float
    scheduled_time: datetime
    auto_submit_enabled: bool
    status: str
    failure_reason: Optional[str] = ""
    attempts: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class SubmitNowRequest(BaseModel):
    coursework_id: int

class SubmissionResultResponse(BaseModel):
    coursework_id: int
    submission_id: str
    state: str
    drive_file_id: Optional[str] = ""
    turned_in_at: datetime
    message: str

# Home / Add-on Summary
class HomeSummaryResponse(BaseModel):
    next_class: NextClassResponse
    current_class: Optional[NextClassResponse] = None
    assignments: List[CourseworkResponse]
    stats: Dict[str, Any]
    user_name: Optional[str] = "Student"
    user_email: Optional[str] = ""

# ERP & University Portal Schemas
class ERPLiveConnectRequest(BaseModel):
    erp_id: str
    password: str

class ERPConnectSessionRequest(BaseModel):
    portal_url: str
    session_cookie: str
    student_id: Optional[str] = ""

class ERPImportScheduleRequest(BaseModel):
    content: str # JSON, CSV, or ICS

class GoogleCredentialsConfigRequest(BaseModel):
    client_id: str
    client_secret: str
    redirect_uri: Optional[str] = "http://localhost:8000/api/auth/google/callback"

# Discovery API v1 Classroom Add-on Schemas
class CreateAddonAttachmentRequest(BaseModel):
    course_id: str
    item_id: str
    title: Optional[str] = "Academic Agent AI Assignment Executor"
    max_points: Optional[float] = 100.0
    base_url: Optional[str] = None

class GradePassbackRequest(BaseModel):
    course_id: str
    item_id: str
    attachment_id: str
    submission_id: str
    points_earned: float

class ReclaimSubmissionRequest(BaseModel):
    coursework_id: int

