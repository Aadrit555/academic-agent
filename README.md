# Academic Agent 🎓⚡

> **An AI Operating Layer for College Work**
> 
> *Not an institutional student portal. Not a college ERP. Not an SRMAPI clone.*
> Academic Agent gives a student one place that understands their academic environment and can actually perform repetitive academic workflows for them.

---

## 💡 Core Concept & Product Philosophy

Most student utilities simply display fragmented information: grades on one portal, assignments on another, lecture PDFs scattered in folders, and timetables on a static screenshot.

**Academic Agent connects the complete academic graph:**

$$\text{Student} \longrightarrow \text{Courses} \longrightarrow \text{Timetable} \longrightarrow \text{Classroom} \longrightarrow \text{Materials} \longrightarrow \text{Assignments} \longrightarrow \text{Deadlines} \longrightarrow \text{Generated Work} \longrightarrow \text{Validation} \longrightarrow \text{Auto-Submission}$$

The core product loop is:
$$\mathbf{UNDERSTAND} \longrightarrow \mathbf{PLAN} \longrightarrow \mathbf{GENERATE} \longrightarrow \mathbf{VALIDATE} \longrightarrow \mathbf{SCHEDULE} \longrightarrow \mathbf{SUBMIT}$$

---

## 🚀 Key Capabilities

### 1. 📅 Timetable & Contextual Awareness
- **Today's Timeline**: Interactive schedule displaying ongoing and upcoming classes.
- **Contextual Next Class Widget**: Real-time awareness of what class is approaching (within 15 minutes) or currently in session.
- **Fast Attendance Action**: One-tap attendance marking right from the hero widget using current class context.

### 2. 📚 Google Classroom Integration
- **Authorized OAuth 2.0 Integration**: Connects via official Google Classroom REST APIs (`classroom.courses.readonly`, `classroom.coursework.me`, `drive.file`).
- **Assignment Pipeline**: Retrieves courses, coursework, descriptions, deadlines, and submission states.
- **Zero-Friction Demo Mode**: Built-in simulation mode allows instant, frictionless evaluation without external Google Cloud keys.

### 3. 🧠 AI Study Brain & Document RAG
- **Course-Scoped Ingestion**: Upload course materials (`PDF`, `DOCX`, `TXT`, `MD`, `PPTX`) organized by course (e.g. `Data Structures/Unit-2.pdf`).
- **Sentence-Aware Boundary Chunking**: 600-character chunks with sliding overlap (inspired by PaperBrain).
- **4 Core AI Actions**:
  1. `Summary`: Concise, structured breakdown in simple language.
  2. `Questions`: 10–15 high-yield exam and viva questions with model answers.
  3. `Concept Explanation`: Deep explanations grounded in uploaded course notes.
  4. `Targeted Study`: Prioritized study strategy ("What should I study first?").
- **Source Attribution**: Pinpoints exact source document names and page numbers for every claim.

### 4. ⚡ Assignment Generator
- **Requirement Detection**: Automatically parses assignment titles and descriptions to detect deliverables:
  - Code: `.c`, `.cpp`, `.java`, `.py`
  - Document: `.docx`, `.pdf`
- **Context-Grounded Generation**: Uses assignment instructions and uploaded course materials (e.g. Lab Manual, Unit Notes) as ground truth.
- **Live Code & Document Viewer**: Inspect, edit, and download deliverables directly.

### 5. ✓ Code & Document Validation Pipeline
- **Never submits code blindly**: Every deliverable must pass automated validation first.
- **Isolated Execution Environment**: Process limits, temporary working directory, and timeout protection.
- **Compilers & Checkers**:
  - C: `gcc -Wall -Wextra` + binary execution test
  - C++: `g++ -Wall -Wextra` + test
  - Java: `javac` + `java`
  - Python: `py_compile` + test execution
  - Documents: Structural integrity, required sections, formatting checks
- **6-Step UI Validation Report**:
  - `[✓] Instructions understood`
  - `[✓] Required file generated`
  - `[✓] File format correct`
  - `[✓] Compilation successful`
  - `[✓] Tests passed`
  - `[✓] Submission package created`
  - `Status: READY FOR SUBMISSION` (or `SUBMISSION BLOCKED` with compiler error inspection)

### 6. ⏰ Scheduled Auto-Submission
- **Headline Automation**: Student enables `AUTO SUBMIT [ ON ]` with a configurable offset (default: 4 hours before deadline).
- **Persistent Schedule Engine**: Background scheduler tracks:
  $$\text{submission\_time} = \text{deadline} - \text{configured\_offset}$$
- **Atomic Submission Workflow**:
  $$\text{Verify Open} \longrightarrow \text{Verify Validation} \longrightarrow \text{Drive Multipart Upload} \longrightarrow \text{Classroom modifyAttachments} \longrightarrow \text{Classroom turnIn} \longrightarrow \text{Verify State}$$
- **Audit Trail**: Every submission records Drive File ID, Classroom Submission ID, and timestamp.

### 7. 🎬 Interactive 12-Step Guided Expo Demonstration
- Run the complete end-to-end story with one click from the sidebar (`Run 12-Step Expo Demo`):
  1. Connect Google Classroom
  2. Import Academic Timetable
  3. Upload Course Materials (`Unit-2.pdf`, `Lab-Manual.pdf`)
  4. Detect Classroom Assignment (`DAA LAB 4: Implement Merge Sort in C`)
  5. Generate Assignment Deliverable
  6. Run Code Compilation & Validation Pipeline
  7. Enable Auto-Submit 4 Hours Before Deadline
  8. View Persistent Background Schedule
  9. Ask Study Brain: "Summarize Unit 2"
  10. Ask Study Brain: "Generate 10 Important Questions"
  11. Display Next Class Context Widget
  12. Execute Fast Attendance Action

---

## 🛠️ Architecture & Backend Services

```
academic_agent/
├── backend/
│   └── app/
│       ├── main.py                  # FastAPI app & REST endpoints
│       ├── config.py                # App configuration & settings
│       ├── database.py              # SQLite & SQLAlchemy session setup
│       ├── models.py                # Relational data schema
│       ├── schemas.py               # Pydantic v2 schemas
│       ├── auth/auth_service.py     # OAuth 2.0 & demo credentials
│       ├── classroom/classroom_service.py # Google Classroom API integration
│       ├── drive/drive_service.py   # Direct Google Drive v3 multipart upload
│       ├── submission/submission_service.py # Classroom modifyAttachments & turnIn
│       ├── scheduler/scheduler_service.py   # Persistent background auto-submit engine
│       ├── timetable/timetable_service.py   # Timetable engine & next class calculation
│       ├── documents/document_service.py    # Multi-format ingestion (PDF, DOCX, TXT, MD)
│       ├── rag/rag_service.py       # Course-scoped chunking, search, QA
│       ├── ai/ai_service.py         # Multi-tier AI (Gemini, Groq, offline fallback)
│       ├── generation/generator_service.py  # Code (.c, .py) & Document (.docx, .pdf) generation
│       ├── validation/validation_service.py # Isolated gcc/javac/python compiler & tests
│       └── attendance/attendance_service.py # Fast attendance action
├── frontend/                        # Modern responsive Single Page Application
│   ├── index.html                   # Shell layout
│   ├── css/styles.css               # Design system
│   └── js/                          # Modular controllers & Expo Demo runner
├── tests/                           # Comprehensive pytest test suite
└── uploads/                         # Course materials and generated deliverables
```

---

## ⚡ Quick Start & Installation

### Prerequisites
- Python 3.10+ (tested on Python 3.14)
- GCC / MinGW (for C compilation)
- Git

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Configure Environment (Optional)
Create a `.env` file (or set environment variables) for live Google Cloud and AI features:
```env
# Google Cloud OAuth 2.0 (For live Classroom & Drive)
GOOGLE_CLASSROOM_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLASSROOM_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback

# AI Provider Keys (Optional: works with built-in heuristic engine if unset)
GEMINI_API_KEY=your-gemini-api-key
GROQ_API_KEY=your-groq-api-key
```

### 3. Run Automated Tests
```bash
python -m pytest -v tests/
```
*Expected: 25 passed tests covering timetable, RAG, code generation, GCC validation, Drive uploads, submission state machine, and API endpoints.*

### 4. Start the Application
```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open your browser at **`http://localhost:8000`**.

---

## 📜 Attribution & Open-Source Licenses

Academic Agent reuses and adapts implementations from:
- **IntelliPlan** ([https://github.com/UAnirudh/IntelliPlan](https://github.com/UAnirudh/IntelliPlan)) — MIT License
- **claude-classroom-submit** ([https://github.com/yolo-labz/claude-classroom-submit](https://github.com/yolo-labz/claude-classroom-submit)) — MIT License
- **PaperBrain** ([https://github.com/Apyhtml20/PaperBrain](https://github.com/Apyhtml20/PaperBrain)) — MIT License

See [`ATTRIBUTION.md`](ATTRIBUTION.md) and [`LICENSE`](LICENSE) for complete copyright notices.
