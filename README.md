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

### 7. 🏛️ Direct SRM AP ERP / eVarsity Live Integration
- **Direct Live Authentication**: Securely authenticates against `student.srmap.edu.in` using the student's registration number and password.
- **Local In-Memory ONNX CRNN Captcha Solver**: Solves portal alphanumerical image challenges locally in <10ms without external API dependencies.
- **Dynamic Timetable Engine**: Synchronizes all weekly timetable slots, handling variable room numbers per subject per day (e.g. `CSE 207` in `X-201` on Tuesday, `C-1011` on Thursday, `C-504` on Friday).
- **Subject-Wise Safe Bunk Calculator**: Continuously computes whether attendance is \(\ge 75\%\), calculating safe bunks remaining or consecutive classes required to restore eligibility.
- **Next Class Live Countdown**: Computes current ongoing or upcoming class and room location in real-time.
- **Zero Plaintext Storage**: Student ERP passwords and session cookies are encrypted at rest using AES-128 CBC via Fernet encryption keys.

### 8. 📷 Lens-Style Camera Attendance Scanner
- **Optical Attendance Verification**: Real-time camera viewfinder with viewfinder target matching current timetable period codes.
- **One-Tap Verification**: Verifies attendance code against schedule and records entry directly.

### 9. 🔒 Enterprise Security & OWASP Hardening
- **Zero Secret Leaks**: Strict `.gitignore` protecting credentials, SQLite databases, and environment secrets.
- **Cryptographic Password Storage**: PBKDF2-HMAC-SHA256 with unique 16-byte random salts.
- **AES Fernet Encryption**: All integration secrets and portal passwords encrypted at rest.
- **Sliding-Window Rate Limiting**: In-memory rate limiting preventing brute-force login and API flooding.
- **Strict Security Headers**: CSP, X-Frame-Options (`SAMEORIGIN`), X-Content-Type-Options (`nosniff`), Referrer-Policy, and Permissions-Policy.
- **Input Sanitization & XSS Mitigation**: Automated string and payload sanitization across all request inputs.
- **IDOR Protection**: All course, coursework, timetable, and document operations enforce user boundary checks.
- **Production Static Pages**: Custom 404 error page, Terms & Conditions, and Privacy Policy included.

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
│       ├── auth/                    # OAuth 2.0, JWT, Fernet encryption, password hashing
│       ├── erp/                     # SRM AP eVarsity integration
│       │   ├── captcha_solver.py    # Local ONNX CRNN captcha solver (<10ms)
│       │   ├── erp_client.py        # Browser-mimicking HTTP client
│       │   ├── erp_scraper.py       # Profile, courses, attendance, & timetable scraper
│       │   ├── timetable_service.py # Countdown, ongoing, & upcoming class calculator
│       │   └── models/              # ONNX runtime model files
│       ├── classroom/               # Google Classroom API integration
│       ├── drive/                   # Direct Google Drive v3 multipart upload
│       ├── submission/              # Classroom modifyAttachments & turnIn
│       ├── scheduler/               # Persistent background auto-submit engine
│       ├── documents/               # Multi-format ingestion (PDF, DOCX, TXT, MD)
│       ├── rag/                     # Course-scoped chunking, search, QA
│       ├── ai/                      # Multi-tier AI (Gemini, Groq, heuristic fallback)
│       ├── generation/              # Code (.c, .py) & Document (.docx, .pdf) generation
│       ├── validation/              # Isolated gcc/javac/python compiler & tests
│       └── middleware/              # Rate limiting & OWASP security headers
├── frontend/                        # Responsive Classroom-first Single Page Application
│   ├── index.html                   # Master Classroom surface & Companion Add-on
│   ├── 404.html                     # Custom 404 page
│   ├── privacy.html                 # Privacy policy
│   ├── terms.html                   # Terms & conditions
│   ├── favicon.svg                  # Brand favicon
│   ├── css/styles.css               # Clean, non-vibecoded professional design system
│   └── js/                          # Modular controllers & API client
├── tests/                           # 53 automated tests (100% passing)
│   ├── test_erp_live.py             # SRM AP ERP, captcha solver, attendance & timetable tests
│   ├── test_security.py             # Security audit, auth, IDOR, XSS, rate limiting tests
│   ├── test_api_endpoints.py        # REST API endpoint tests
│   ├── test_generation.py           # Deliverable generation tests
│   ├── test_validation.py           # GCC compiler & validator tests
│   ├── test_submission_flow.py      # Scheduled submission engine tests
│   ├── test_timetable.py            # Timetable and room allocation tests
│   └── test_rag_and_brain.py        # RAG and study brain tests
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
Copy `.env.example` to `.env` for production deployments:
```bash
cp .env.example .env
```

### 3. Run Automated Tests
```bash
python -m pytest tests/ -v
```
*53 passed tests verifying ERP connectivity, CRNN captcha inference, security headers, IDOR, XSS sanitization, RAG, and GCC validation.*

### 4. Start the Application
```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open your browser at **`http://localhost:8000`**.

---

## 📜 Attribution & Open-Source Licenses

Academic Agent reuses and adapts implementations from:
- **IntelliPlan** ([https://github.com/UAnirudh/IntelliPlan](https://github.com/UAnirudh/IntelliPlan)) — MIT License
- **Srmap-Api** ([https://github.com/StoreVia/Srmap-Api](https://github.com/StoreVia/Srmap-Api)) — MIT License
- **claude-classroom-submit** ([https://github.com/yolo-labz/claude-classroom-submit](https://github.com/yolo-labz/claude-classroom-submit)) — MIT License
- **PaperBrain** ([https://github.com/Apyhtml20/PaperBrain](https://github.com/Apyhtml20/PaperBrain)) — MIT License

See [`ATTRIBUTION.md`](ATTRIBUTION.md) and [`LICENSE`](LICENSE) for complete copyright notices.

