// ==========================================================================
// ACADEMIC AGENT — Google Classroom Add-On Native Controller
// Clean, zero-simulation, production runtime
// ==========================================================================

const AddonApp = {
  state: {
    courseId: null,
    itemId: null,
    courses: [],
    coursework: [],
    selectedId: null,
    activeItem: null,
    spec: null,
    deliverable: null,
    validation: null,
    schedule: null,
    nextClass: null,
    erpStatus: null,
    googleStatus: null,
    isExecuting: false,
    isValidating: false
  },

  async init() {
    this.parseUrlContext();
    await this.loadAuthStatus();
    await this.loadNextClass();
    await this.loadCoursework();
  },

  parseUrlContext() {
    const params = new URLSearchParams(window.location.search);
    this.state.courseId = params.get("courseId");
    this.state.itemId = params.get("itemId");
    
    // Auth redirect callback handling
    if (params.get("auth_success") === "true") {
      Toast.success("Google Classroom connected successfully!");
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("auth_error")) {
      Toast.error(`Google Authentication Error: ${params.get("auth_error")}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  },

  async loadAuthStatus() {
    try {
      const [googleRes, erpRes] = await Promise.all([
        api("/auth/status").catch(() => ({ connected: false })),
        api("/erp/status").catch(() => ({ is_connected: false }))
      ]);

      this.state.googleStatus = googleRes;
      this.state.erpStatus = erpRes;

      // Update Header Badges
      const gBadge = document.getElementById("addon-google-chip");
      if (gBadge) {
        if (googleRes.connected) {
          gBadge.className = "status-chip connected";
          gBadge.innerHTML = `<span class="chip-dot"></span><span>Google: ${escapeHtml(googleRes.email || 'Connected')}</span>`;
        } else {
          gBadge.className = "status-chip disconnected";
          gBadge.innerHTML = `<span class="chip-dot"></span><span>Connect Google</span>`;
          gBadge.onclick = () => AddonApp.launchGoogleOAuth();
        }
      }

      const erpBadge = document.getElementById("addon-erp-chip");
      if (erpBadge) {
        if (erpRes.is_connected) {
          erpBadge.className = "status-chip connected";
          erpBadge.innerHTML = `<span class="chip-dot"></span><span>SRM ERP: ${escapeHtml(erpRes.student_id || erpRes.student_name || 'Active')}</span>`;
        } else {
          erpBadge.className = "status-chip disconnected";
          erpBadge.innerHTML = `<span class="chip-dot"></span><span>Connect SRM ERP</span>`;
        }
      }
    } catch (e) {
      console.warn("Error loading auth status:", e);
    }
  },

  // ── 1. Next Class Widget (Real ERP Timetable) ──────────────────────────
  async loadNextClass() {
    const card = document.getElementById("next-class-content");
    if (!card) return;

    try {
      const next = await api("/erp/next-class").catch(() => null) 
        || await api("/timetable/next").catch(() => null);

      this.state.nextClass = next;

      if (!next || !next.has_class) {
        card.innerHTML = `
          <div class="empty-compact">
            <span>No upcoming classes scheduled for the current session.</span>
          </div>
        `;
        return;
      }

      const isOngoing = next.is_ongoing;
      const statusBadge = isOngoing 
        ? '<span class="pill pill-green">IN SESSION NOW</span>' 
        : '<span class="pill pill-blue">NEXT CLASS</span>';

      card.innerHTML = `
        <div class="next-class-box ${isOngoing ? 'is-ongoing' : ''}">
          <div class="nc-top">
            ${statusBadge}
            <span class="nc-time">${escapeHtml(next.start_time)} – ${escapeHtml(next.end_time)}</span>
          </div>
          <div class="nc-subject">${escapeHtml(next.subject)}</div>
          <div class="nc-meta">
            <span class="nc-room">Room: <b>${escapeHtml(next.classroom || 'TBD')}</b></span>
            ${next.faculty ? `<span class="nc-faculty">• ${escapeHtml(next.faculty)}</span>` : ''}
          </div>
        </div>
      `;
    } catch (e) {
      card.innerHTML = `<div class="empty-compact text-danger">Failed to load timetable slot: ${escapeHtml(e.message)}</div>`;
    }
  },

  // ── 2. Current Assignment & Coursework Context ─────────────────────────
  async loadCoursework() {
    const selector = document.getElementById("coursework-select");
    try {
      const coursework = await api("/classroom/coursework");
      this.state.coursework = coursework || [];

      if (!coursework || coursework.length === 0) {
        if (selector) selector.innerHTML = `<option value="">No assignments found</option>`;
        this.renderEmptyAssignmentState();
        return;
      }

      // Populate selector
      if (selector) {
        selector.innerHTML = coursework.map(c => `
          <option value="${c.id}">${escapeHtml(c.title)} (${escapeHtml(c.course_name || 'Classroom')})</option>
        `).join("");
      }

      // Prioritize URL context itemId if launched from specific assignment in Google Classroom
      let targetId = coursework[0].id;
      if (this.state.itemId) {
        const matched = coursework.find(c => String(c.coursework_id) === String(this.state.itemId) || String(c.id) === String(this.state.itemId));
        if (matched) targetId = matched.id;
      }

      await this.selectCoursework(targetId);
    } catch (e) {
      this.renderEmptyAssignmentState(e.message);
    }
  },

  async selectCoursework(id) {
    if (!id) return;
    this.state.selectedId = Number(id);
    this.state.activeItem = this.state.coursework.find(c => c.id === this.state.selectedId);

    const selector = document.getElementById("coursework-select");
    if (selector) selector.value = String(this.state.selectedId);

    // Fetch existing specification, deliverable, validation, and schedule if already processed
    await Promise.all([
      this.loadAssignmentSpec(this.state.selectedId),
      this.loadAssignmentDeliverable(this.state.selectedId),
      this.loadSubmissionSchedule(this.state.selectedId)
    ]);

    this.renderAssignmentSection();
    this.renderProgressTracker();
  },

  async loadAssignmentSpec(cwId) {
    try {
      this.state.spec = await api(`/assignment/${cwId}/spec`);
    } catch {
      this.state.spec = null;
    }
  },

  async loadAssignmentDeliverable(cwId) {
    try {
      const deliv = await api(`/assignment/${cwId}/deliverable`);
      this.state.deliverable = deliv;
      if (deliv && deliv.code_or_content) {
        // Attempt to load validation
        try {
          this.state.validation = await api(`/assignment/${cwId}/validate`);
        } catch {
          this.state.validation = null;
        }
      }
    } catch {
      this.state.deliverable = null;
      this.state.validation = null;
    }
  },

  async loadSubmissionSchedule(cwId) {
    try {
      const schedules = await api("/schedules");
      const sched = (schedules || []).find(s => s.coursework_id === Number(cwId));
      this.state.schedule = sched || null;
    } catch {
      this.state.schedule = null;
    }
  },

  renderAssignmentSection() {
    const item = this.state.activeItem;
    if (!item) {
      this.renderEmptyAssignmentState();
      return;
    }

    const container = document.getElementById("assignment-details-box");
    if (!container) return;

    const deadlineStr = item.due_date ? `${item.due_date} ${item.due_time || ''}` : "No deadline specified";
    const reqCount = this.state.spec && this.state.spec.required_files 
      ? this.state.spec.required_files.length 
      : 0;

    container.innerHTML = `
      <div class="assignment-meta-card">
        <div class="meta-row">
          <span class="meta-course">${escapeHtml(item.course_name || 'Course')}</span>
          <span class="status-pill status-${(item.status || 'not_started').toLowerCase()}">${escapeHtml(item.status || 'NOT_STARTED')}</span>
        </div>
        <h3 class="meta-title">${escapeHtml(item.title)}</h3>
        <p class="meta-desc">${escapeHtml(item.description || 'No description provided by instructor.')}</p>
        
        <div class="meta-footer">
          <div class="due-tag">
            <span class="tag-label">Due:</span>
            <span class="tag-val">${escapeHtml(deadlineStr)}</span>
          </div>
          <div class="req-tag">
            <span class="tag-label">Requirements:</span>
            <span class="tag-val">${reqCount > 0 ? `${reqCount} detected` : 'Analyze to detect'}</span>
          </div>
        </div>

        <button class="btn btn-primary btn-block btn-execute" id="btn-execute-assignment" onclick="AddonApp.executeAssignment()">
          ${this.state.isExecuting ? '⚡ Analyzing & Executing...' : (this.state.deliverable ? '↻ RE-EXECUTE ASSIGNMENT' : '⚡ EXECUTE ASSIGNMENT')}
        </button>
      </div>
    `;

    this.renderDeliverablesBox();
    this.renderAutomationSection();
  },

  renderEmptyAssignmentState(errMsg = null) {
    const container = document.getElementById("assignment-details-box");
    if (!container) return;
    container.innerHTML = `
      <div class="empty-state-box">
        <div class="empty-icon">📋</div>
        <div class="empty-title">NO ASSIGNMENTS FOUND</div>
        <div class="empty-desc">${errMsg ? escapeHtml(errMsg) : 'No Google Classroom assignments were found. Sign in with Google or click Sync Classroom below.'}</div>
        <button class="btn btn-secondary btn-sm" onclick="AddonApp.syncClassroom()">Sync Classroom</button>
      </div>
    `;
  },

  // ── 3. Progress State Machine Tracker ──────────────────────────────────
  renderProgressTracker() {
    const container = document.getElementById("progress-tracker-box");
    if (!container) return;

    const hasSpec = !!this.state.spec;
    const hasFiles = !!this.state.deliverable;
    const isValidated = !!(this.state.validation && this.state.validation.passed);
    const isScheduled = !!(this.state.schedule && this.state.schedule.status === "SCHEDULED");
    const isSubmitted = !!(this.state.activeItem && this.state.activeItem.status === "SUBMITTED");

    container.innerHTML = `
      <div class="progress-stepper">
        <div class="step-item ${hasSpec ? 'step-done' : (this.state.isExecuting ? 'step-active' : '')}">
          <span class="step-icon">${hasSpec ? '✓' : '○'}</span>
          <span class="step-label">Assignment analyzed</span>
        </div>
        <div class="step-item ${hasFiles ? 'step-done' : ''}">
          <span class="step-icon">${hasFiles ? '✓' : '○'}</span>
          <span class="step-label">Files generated</span>
        </div>
        <div class="step-item ${isValidated ? 'step-done' : (this.state.isValidating ? 'step-active' : '')}">
          <span class="step-icon">${isValidated ? '✓' : '○'}</span>
          <span class="step-label">Validation passed</span>
        </div>
        <div class="step-item ${isSubmitted ? 'step-done' : (isScheduled ? 'step-scheduled' : '')}">
          <span class="step-icon">${isSubmitted ? '✓' : (isScheduled ? '⏰' : '○')}</span>
          <span class="step-label">${isSubmitted ? 'Turned in to Classroom' : (isScheduled ? 'Submission scheduled' : 'Submission pending')}</span>
        </div>
      </div>
    `;
  },

  // ── 4. AI Assignment Execution ─────────────────────────────────────────
  async executeAssignment() {
    if (!this.state.selectedId || this.state.isExecuting) return;
    this.state.isExecuting = true;
    this.renderAssignmentSection();

    try {
      Toast.info("Analyzing assignment specification and synthesizing deliverables...");
      
      const genRes = await api("/assignment/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coursework_id: this.state.selectedId })
      });

      Toast.success(`Generated deliverable: ${genRes.file_name}`);

      // Refresh spec and deliverable
      await Promise.all([
        this.loadAssignmentSpec(this.state.selectedId),
        this.loadAssignmentDeliverable(this.state.selectedId)
      ]);

      // Automatically run validation
      await this.validateDeliverable();
    } catch (e) {
      Toast.error(`Execution Failed: ${e.message}`);
    } finally {
      this.state.isExecuting = false;
      this.renderAssignmentSection();
      this.renderProgressTracker();
    }
  },

  // ── 5. Real Validation Engine ──────────────────────────────────────────
  async validateDeliverable() {
    if (!this.state.selectedId || this.state.isValidating) return;
    this.state.isValidating = true;
    this.renderDeliverablesBox();

    try {
      Toast.info("Executing compiler and running verification test suite...");
      const valRes = await api(`/assignment/${this.state.selectedId}/validate`, {
        method: "POST"
      });

      this.state.validation = valRes;
      if (valRes.passed) {
        Toast.success("Real validation passed! All compiler checks succeeded.");
      } else {
        Toast.warning("Validation flagged issues. Inspect compiler checklist.");
      }
    } catch (e) {
      Toast.error(`Validation Error: ${e.message}`);
    } finally {
      this.state.isValidating = false;
      this.renderDeliverablesBox();
      this.renderProgressTracker();
    }
  },

  renderDeliverablesBox() {
    const box = document.getElementById("deliverables-box");
    if (!box) return;

    const deliv = this.state.deliverable;
    const val = this.state.validation;

    if (!deliv) {
      box.innerHTML = `
        <div class="empty-compact">
          <span>Deliverables not yet generated. Click <b>Execute Assignment</b> above.</span>
        </div>
      `;
      return;
    }

    const codeSnippet = (deliv.code_or_content || "").slice(0, 500);
    const checklist = val && val.checklist ? val.checklist : [];

    box.innerHTML = `
      <div class="deliv-card">
        <div class="deliv-header">
          <div class="deliv-name">
            <span class="file-ext">${escapeHtml(deliv.file_type || '.c')}</span>
            <b>${escapeHtml(deliv.file_name)}</b>
          </div>
          <div class="deliv-actions">
            <button class="btn btn-secondary btn-xs" onclick="AddonApp.downloadDeliverable()">Download File</button>
            <button class="btn btn-success btn-xs" onclick="AddonApp.validateDeliverable()" ${this.state.isValidating ? 'disabled' : ''}>
              ${this.state.isValidating ? 'Compiling...' : 'Run Compiler'}
            </button>
          </div>
        </div>

        <div class="code-preview-wrap">
          <pre class="code-preview"><code>${escapeHtml(codeSnippet)}${deliv.code_or_content && deliv.code_or_content.length > 500 ? '\n... [truncated]' : ''}</code></pre>
        </div>

        ${checklist.length > 0 ? `
          <div class="val-checklist">
            <div class="val-title">COMPILER VALIDATION VERIFICATION:</div>
            ${checklist.map(c => `
              <div class="check-item ${c.passed ? 'check-pass' : 'check-fail'}">
                <span>${c.passed ? '✓' : '✗'}</span>
                <span class="check-text">${escapeHtml(c.title)}: ${escapeHtml(c.details || '')}</span>
              </div>
            `).join("")}
          </div>
        ` : ''}
      </div>
    `;
  },

  async downloadDeliverable() {
    if (!this.state.selectedId) return;
    try {
      const blob = await api(`/assignment/${this.state.selectedId}/download`);
      const fileName = (this.state.deliverable && this.state.deliverable.file_name) || "deliverable.c";
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      Toast.success(`Downloaded ${fileName}`);
    } catch (e) {
      Toast.error(`Download failed: ${e.message}`);
    }
  },

  // ── 6. Course Material AI ──────────────────────────────────────────────
  async queryMaterial(actionType) {
    if (!this.state.activeItem || !this.state.activeItem.course_id) {
      Toast.warning("Please select an active course assignment first.");
      return;
    }

    const outputEl = document.getElementById("material-output-box");
    if (outputEl) {
      outputEl.style.display = "block";
      outputEl.innerHTML = `<div class="loading-pulse">Querying course material with AI...</div>`;
    }

    try {
      const res = await api("/study-brain/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: this.state.activeItem.course_id,
          action: actionType,
          query: ""
        })
      });

      if (outputEl) {
        outputEl.innerHTML = `
          <div class="material-ai-result">
            <div class="result-header">
              <b>${actionType === 'summary' ? '📖 Course Syllabus Summary' : '❓ Grounded Practice Questions'}</b>
              <button class="btn-icon" onclick="document.getElementById('material-output-box').style.display='none'">&times;</button>
            </div>
            <div class="result-body">${escapeHtml(res.content)}</div>
          </div>
        `;
      }
    } catch (e) {
      if (outputEl) outputEl.innerHTML = `<div class="text-danger">Failed to process material: ${escapeHtml(e.message)}</div>`;
    }
  },

  async handleMaterialUpload(fileInput) {
    if (!fileInput.files || fileInput.files.length === 0) return;
    if (!this.state.activeItem || !this.state.activeItem.course_id) {
      Toast.warning("Select an assignment to associate material with its course.");
      return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("file", file);
    formData.append("course_id", this.state.activeItem.course_id);

    try {
      Toast.info(`Uploading and indexing ${file.name}...`);
      const res = await api("/documents/upload", {
        method: "POST",
        body: formData
      });
      Toast.success(res.message || "Document indexed for AI assignment context!");
      fileInput.value = "";
    } catch (e) {
      Toast.error(`Upload Failed: ${e.message}`);
    }
  },

  // ── 7. Auto-Submission Scheduler ───────────────────────────────────────
  renderAutomationSection() {
    const container = document.getElementById("automation-details-box");
    if (!container) return;

    const sched = this.state.schedule;
    const isAutoOn = !!(sched && sched.auto_submit_enabled);
    const schedTimeStr = sched && sched.scheduled_time 
      ? new Date(sched.scheduled_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) 
      : 'Default: 4 hours before deadline';

    container.innerHTML = `
      <div class="auto-box">
        <div class="auto-row">
          <div>
            <div class="auto-title">AUTO SUBMIT</div>
            <div class="auto-sub">Scheduled: <b>${escapeHtml(schedTimeStr)}</b></div>
          </div>
          <button class="btn btn-sm ${isAutoOn ? 'btn-success' : 'btn-secondary'}" onclick="AddonApp.toggleAutoSubmit()">
            ${isAutoOn ? 'ENABLED (ON)' : 'ENABLE AUTO-SUBMIT'}
          </button>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button class="btn btn-primary btn-sm btn-block" onclick="AddonApp.submitNow()">
            Turn In Now (Classroom API)
          </button>
        </div>
      </div>
    `;
  },

  async toggleAutoSubmit() {
    if (!this.state.selectedId) return;
    const currentlyOn = !!(this.state.schedule && this.state.schedule.auto_submit_enabled);
    const newStatus = !currentlyOn;

    try {
      const res = await api(`/assignment/${this.state.selectedId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coursework_id: this.state.selectedId,
          offset_hours: 4.0,
          auto_submit_enabled: newStatus
        })
      });

      Toast.success(newStatus ? "Auto-Submit scheduled in database!" : "Auto-Submit disabled.");
      await this.loadSubmissionSchedule(this.state.selectedId);
      this.renderAutomationSection();
      this.renderProgressTracker();
    } catch (e) {
      Toast.error(`Scheduling Error: ${e.message}`);
    }
  },

  async submitNow() {
    if (!this.state.selectedId) return;
    if (!confirm("Are you sure you want to upload deliverables to Google Drive and turn in to Google Classroom?")) return;

    try {
      Toast.info("Executing Classroom submission pipeline...");
      const res = await api(`/assignment/${this.state.selectedId}/submit-now`, {
        method: "POST"
      });

      Toast.success(res.message || "Assignment turned in successfully!");
      if (this.state.activeItem) this.state.activeItem.status = "SUBMITTED";
      this.renderAssignmentSection();
      this.renderProgressTracker();
    } catch (e) {
      // Handles honest MANUAL_ACTION_REQUIRED or permission restrictions
      Toast.error(`Submission: ${e.message}`);
    }
  },

  // ── 8. Integrations & Auth Triggers ────────────────────────────────────
  async syncClassroom() {
    try {
      Toast.info("Syncing enrolled courses and coursework from Google Classroom...");
      await api("/classroom/sync", { method: "POST" });
      Toast.success("Classroom synchronized!");
      await this.loadCoursework();
    } catch (e) {
      Toast.error(`Sync Failed: ${e.message}`);
    }
  },

  async launchGoogleOAuth() {
    try {
      const res = await api("/auth/google/url");
      if (res && res.url) {
        window.location.href = res.url;
      }
    } catch (e) {
      Toast.error(`Cannot launch Google auth: ${e.message}`);
    }
  },

  async connectERP() {
    const idInput = document.getElementById("erp-id-input");
    const pwInput = document.getElementById("erp-password-input");
    const erpId = idInput ? idInput.value.trim().toUpperCase() : "";
    const password = pwInput ? pwInput.value.trim() : "";

    if (!erpId || !password) {
      Toast.warning("Please enter your SRM AP Registration Number and Portal Password.");
      return;
    }

    const btn = document.getElementById("btn-erp-submit");
    if (btn) {
      btn.textContent = "Solving Captcha & Authenticating...";
      btn.disabled = true;
    }

    try {
      const res = await api("/erp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ erp_id: erpId, password: password })
      });

      if (res.access_token) {
        localStorage.setItem("academic_agent_jwt", res.access_token);
      }

      Toast.success("Connected to SRM AP eVarsity! Real timetable synchronized.");
      if (pwInput) pwInput.value = "";
      closeModal("erp-modal");
      await this.loadAuthStatus();
      await this.loadNextClass();
    } catch (e) {
      Toast.error(`ERP Connection Failed: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "Connect SRM AP ERP";
        btn.disabled = false;
      }
    }
  }
};

// ── Generic API & Toast Utilities ──────────────────────────────────────────
async function api(path, options = {}) {
  const token = localStorage.getItem("academic_agent_jwt");
  const headers = Object.assign({}, options.headers || {});
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res = await fetch(`/api${path}`, { ...options, headers });
  
  if (res.status === 401 && token) {
    localStorage.removeItem("academic_agent_jwt");
    delete headers["Authorization"];
    res = await fetch(`/api${path}`, { ...options, headers });
  }

  if (!res.ok) {
    let detail = "Request failed";
    try {
      const j = await res.json();
      detail = j.detail || j.error || JSON.stringify(j);
    } catch {
      detail = await res.text() || res.statusText;
    }
    throw new Error(detail);
  }

  const ctype = res.headers.get("content-type");
  if (ctype && ctype.includes("application/octet-stream")) {
    return res.blob();
  }
  return res.json();
}

const Toast = {
  container: null,
  init() {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "toast-container";
      document.body.appendChild(this.container);
    }
  },
  show(msg, type = "info", duration = 4000) {
    this.init();
    const item = document.createElement("div");
    item.className = `toast-item toast-${type}`;
    item.innerHTML = `<span>${escapeHtml(msg)}</span>`;
    this.container.appendChild(item);
    setTimeout(() => {
      item.classList.add("fade-out");
      setTimeout(() => item.remove(), 250);
    }, duration);
  },
  success(m) { this.show(m, "success"); },
  error(m) { this.show(m, "error", 5500); },
  info(m) { this.show(m, "info"); },
  warning(m) { this.show(m, "warning"); }
};

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add("active");
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove("active");
}

document.addEventListener("DOMContentLoaded", () => {
  AddonApp.init();

  const selector = document.getElementById("coursework-select");
  if (selector) {
    selector.addEventListener("change", (e) => AddonApp.selectCoursework(e.target.value));
  }

  const erpSubmitBtn = document.getElementById("btn-erp-submit");
  if (erpSubmitBtn) {
    erpSubmitBtn.addEventListener("click", () => AddonApp.connectERP());
  }

  const erpPwInput = document.getElementById("erp-password-input");
  if (erpPwInput && erpSubmitBtn) {
    erpPwInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") erpSubmitBtn.click();
    });
  }
});
