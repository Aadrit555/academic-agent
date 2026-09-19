// ==========================================================================
// ACADEMIC AGENT - Google Classroom Desktop Workspace Controller
// Clean, zero-simulation, production runtime (Skiper UI)
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
    isValidating: false,
    currentTab: "workspace",
    delivTab: "report",
    cmdSelectedIndex: 0,
    commands: []
  },

  async init() {
    this.initTheme();
    this.setupCommandPalette();
    this.parseUrlContext();
    await this.loadAuthStatus();
    await this.loadNextClass();
    await this.loadCourses();
    await this.loadCoursework();
  },

  // ── Theme Management ───────────────────────────────────────────────────
  initTheme() {
    const savedTheme = localStorage.getItem("academic_theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
  },

  toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const nextTheme = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", nextTheme);
    localStorage.setItem("academic_theme", nextTheme);
    Toast.info(`Switched to ${nextTheme} theme`);
  },

  // ── Desktop Navigation ─────────────────────────────────────────────────
  switchMainTab(tabName) {
    this.state.currentTab = tabName;
    const tabs = ["workspace", "overview", "courses", "brain", "timetable"];
    tabs.forEach(t => {
      const btn = document.getElementById(`nav-tab-${t}`);
      const pane = document.getElementById(`view-${t}`);
      if (btn) btn.classList.toggle("active", t === tabName);
      if (pane) pane.classList.toggle("active", t === tabName);
    });

    if (tabName === "courses") {
      this.renderCoursesView();
    } else if (tabName === "timetable") {
      this.renderTimetableView();
    }
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
          const displayEmail = googleRes.email ? googleRes.email.split("@")[0] : "Connected";
          gBadge.innerHTML = `<span class="chip-dot"></span><span class="chip-text">Google: ${escapeHtml(displayEmail)}</span>`;
        } else {
          gBadge.className = "status-chip disconnected";
          gBadge.innerHTML = `<span class="chip-dot"></span><span class="chip-text">Connect Google</span>`;
        }
      }

      const erpBadge = document.getElementById("addon-erp-chip");
      if (erpBadge) {
        if (erpRes.is_connected) {
          erpBadge.className = "status-chip connected";
          const displayId = erpRes.student_id || erpRes.student_name || "Connected";
          erpBadge.innerHTML = `<span class="chip-dot"></span><span class="chip-text">Portal: ${escapeHtml(displayId)}</span>`;
        } else {
          erpBadge.className = "status-chip disconnected";
          erpBadge.innerHTML = `<span class="chip-dot"></span><span class="chip-text">Connect Portal</span>`;
        }
      }

      // Update Banners on main view
      const gBanner = document.getElementById("banner-google-needed");
      if (gBanner) gBanner.style.display = googleRes.connected ? "none" : "flex";

      const pBanner = document.getElementById("banner-portal-needed");
      if (pBanner) pBanner.style.display = erpRes.is_connected ? "none" : "flex";

      const bannerContainer = document.getElementById("connection-banner-container");
      if (bannerContainer) {
        bannerContainer.style.display = (!googleRes.connected || !erpRes.is_connected) ? "flex" : "none";
      }

      // Sync views inside Settings Modal
      this.renderModalAuthViews();
    } catch (e) {
      console.warn("Error loading auth status:", e);
    }
  },

  renderModalAuthViews() {
    const googleRes = this.state.googleStatus || { connected: false };
    const erpRes = this.state.erpStatus || { is_connected: false };

    // Portal Tab Views
    const portalConnView = document.getElementById("portal-connected-view");
    const portalLoginView = document.getElementById("portal-login-view");
    if (portalConnView && portalLoginView) {
      if (erpRes.is_connected) {
        portalConnView.style.display = "block";
        portalLoginView.style.display = "none";
        const idEl = document.getElementById("portal-info-id");
        const nameEl = document.getElementById("portal-info-name");
        const syncEl = document.getElementById("portal-info-synced");
        if (idEl) idEl.textContent = erpRes.student_id || "Active";
        if (nameEl) nameEl.textContent = erpRes.student_name || "Student";
        if (syncEl) syncEl.textContent = erpRes.last_synced_at ? new Date(erpRes.last_synced_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : "Just now";
      } else {
        portalConnView.style.display = "none";
        portalLoginView.style.display = "block";
      }
    }

    // Google Tab Views
    const googleConnView = document.getElementById("google-connected-view");
    const googleLoginView = document.getElementById("google-login-view");
    if (googleConnView && googleLoginView) {
      if (googleRes.connected) {
        googleConnView.style.display = "block";
        googleLoginView.style.display = "none";
        const gEmailEl = document.getElementById("google-info-email");
        if (gEmailEl) gEmailEl.textContent = googleRes.email || "Active Google Session";
      } else {
        googleConnView.style.display = "none";
        googleLoginView.style.display = "block";
      }
    }
  },

  openSettingsTab(tabName) {
    openModal("settings-modal");
    this.switchModalTab(tabName);
  },

  switchModalTab(tabName) {
    const tabs = ["portal", "google", "config"];
    tabs.forEach(t => {
      const btn = document.getElementById(`tab-btn-${t}`);
      const pane = document.getElementById(`tab-pane-${t}`);
      if (btn) btn.classList.toggle("active", t === tabName);
      if (pane) {
        pane.style.display = (t === tabName) ? "block" : "none";
        pane.classList.toggle("active", t === tabName);
      }
    });
  },

  // ── 1. Next Class Widget (Real ERP Timetable) ──────────────────────────
  async loadNextClass() {
    const card = document.getElementById("next-class-content");
    if (!card) return;

    try {
      const next = await api("/erp/next-class").catch(() => null)
        || await api("/timetable/next").catch(() => null);

      this.state.nextClass = next;

      let classObj = null;
      let isOngoing = false;

      if (next) {
        if (next.has_class) {
          classObj = next;
          isOngoing = !!next.is_ongoing;
        } else if (next.has_schedule) {
          if (next.ongoing_class) {
            classObj = next.ongoing_class;
            isOngoing = true;
          } else if (next.upcoming_class) {
            classObj = next.upcoming_class;
            isOngoing = false;
          }
        }
      }

      if (!classObj) {
        card.innerHTML = `
          <div class="empty-compact">
            <span>No upcoming classes scheduled for the current session.</span>
          </div>
        `;
        return;
      }

      const statusBadge = isOngoing
        ? '<span class="status-pill status-submitted">IN SESSION NOW</span>'
        : '<span class="status-pill status-ready_for_submission">NEXT CLASS</span>';

      card.innerHTML = `
        <div class="next-class-box ${isOngoing ? 'is-ongoing' : ''}">
          <div class="nc-top">
            ${statusBadge}
            <span class="nc-time">${escapeHtml(classObj.start_time)} - ${escapeHtml(classObj.end_time)}</span>
          </div>
          <div class="nc-subject">${escapeHtml(classObj.subject)}</div>
          <div class="nc-meta">
            <span class="nc-room">Room: <b>${escapeHtml(classObj.classroom || 'TBD')}</b></span>
            ${classObj.faculty ? `<span class="nc-faculty">| ${escapeHtml(classObj.faculty)}</span>` : ''}
          </div>
        </div>
      `;
    } catch (e) {
      card.innerHTML = `<div class="empty-compact text-danger">Failed to load timetable slot: ${escapeHtml(e.message)}</div>`;
    }
  },

  // ── Courses List ───────────────────────────────────────────────────────
  async loadCourses() {
    try {
      const courses = await api("/classroom/courses").catch(() => []);
      this.state.courses = courses || [];
      const statEl = document.getElementById("stat-courses-count");
      if (statEl) statEl.textContent = this.state.courses.length;
      this.renderCoursesView();
    } catch (e) {
      console.warn("Failed to load courses:", e);
    }
  },

  renderCoursesView() {
    const container = document.getElementById("courses-list-container");
    if (!container) return;

    if (!this.state.courses || this.state.courses.length === 0) {
      container.innerHTML = `
        <div class="empty-compact" style="grid-column: 1 / -1;">
          <span>No enrolled Google Classroom courses found. Connect your Google account or click Sync from Classroom.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = this.state.courses.map(c => `
      <div class="stat-card" style="cursor: pointer;" onclick="AddonApp.filterCourseworkByCourse('${escapeHtml(c.course_id)}')">
        <div class="stat-header">
          <span class="stat-label">${escapeHtml(c.section || 'Course')}</span>
          <span class="status-pill status-submitted">ENROLLED</span>
        </div>
        <div style="font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 6px 0;">
          ${escapeHtml(c.name)}
        </div>
        <div class="stat-sub">
          Teacher: ${escapeHtml(c.teacher_name || 'Department Faculty')}
        </div>
        <div style="margin-top: 10px; display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
          <span>ID: ${escapeHtml(c.course_id)}</span>
          <span style="color: var(--accent);">View Assignments &rarr;</span>
        </div>
      </div>
    `).join("");
  },

  filterCourseworkByCourse(courseId) {
    const matched = this.state.coursework.find(cw => String(cw.course_id) === String(courseId));
    if (matched) {
      this.switchMainTab("workspace");
      this.selectCoursework(matched.id);
    } else {
      this.switchMainTab("workspace");
      Toast.info("No active coursework currently loaded for this course.");
    }
  },

  // ── 2. Current Assignment & Coursework Context ─────────────────────────
  async loadCoursework() {
    const selector = document.getElementById("coursework-select");
    try {
      const coursework = await api("/classroom/coursework");
      this.state.coursework = coursework || [];

      const statEl = document.getElementById("stat-coursework-count");
      if (statEl) statEl.textContent = this.state.coursework.length;

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

  async selectCoursework(id, triggerAutoPilot = true) {
    if (!id) return;
    this.state.selectedId = Number(id);
    this.state.activeItem = this.state.coursework.find(c => c.id === this.state.selectedId);

    const selector = document.getElementById("coursework-select");
    if (selector) selector.value = String(this.state.selectedId);

    // Fetch existing specification, deliverable, validation, schedule, and course materials
    await Promise.all([
      this.loadAssignmentSpec(this.state.selectedId).catch(() => null),
      this.loadAssignmentDeliverable(this.state.selectedId).catch(() => null),
      this.loadSubmissionSchedule(this.state.selectedId).catch(() => null),
      this.loadCourseMaterials(this.state.activeItem ? this.state.activeItem.course_id : null).catch(() => null)
    ]);

    this.renderAssignmentSection();
    this.renderProgressTracker();
    this.renderValidationPanel();

    // Auto-pilot check: "user does nothing"
    if (triggerAutoPilot && localStorage.getItem("academic_autopilot") === "true") {
      if (this.state.activeItem && this.state.activeItem.status !== "SUBMITTED" && !this.state.isExecuting) {
        setTimeout(() => this.submitNow(), 400);
      }
    }
  },

  async loadCourseMaterials(courseId) {
    const listEl = document.getElementById("course-ingested-materials");
    if (!listEl) return;
    if (!courseId) {
      listEl.innerHTML = `<div class="ingested-notice-card"><span>Classroom PDFs are auto-ingested into Study Brain.</span></div>`;
      return;
    }

    try {
      const docs = await api(`/documents/course/${courseId}`);
      if (docs && docs.length > 0) {
        listEl.innerHTML = `
          <div class="ingested-notice-card" style="display: flex; flex-direction: column; gap: 6px;">
            <div style="font-size: 11px; font-weight: 600; color: var(--text-primary);">
              Grounded Materials (${docs.length} indexed document):
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              ${docs.map(d => `
                <span class="attachment-chip" style="font-size: 10px; padding: 2px 6px;">
                  ${escapeHtml(d.filename)} (${d.page_count}p)
                  <span class="att-badge">Read</span>
                </span>
              `).join('')}
            </div>
          </div>
        `;
      } else {
        listEl.innerHTML = `<div class="ingested-notice-card"><span>Assignment handouts and syllabus are indexed into Study Brain.</span></div>`;
      }
    } catch {
      listEl.innerHTML = `<div class="ingested-notice-card"><span>Assignment handouts and syllabus are indexed into Study Brain.</span></div>`;
    }
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
        try {
          this.state.validation = await api(`/assignment/${cwId}/validation`);
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

    let materialsHtml = '';
    let materials = [];
    try {
      materials = JSON.parse(item.materials_json || "[]");
    } catch { }

    if (materials.length > 0) {
      materialsHtml = `
        <div class="classroom-attachments-panel">
          <div class="attachments-label">PROFESSOR HANDOUT ATTACHMENTS:</div>
          <div class="attachments-chips">
            ${materials.map(m => `
              <a href="${escapeHtml(m.alternateLink || m.url || 'javascript:void(0)')}" target="_blank" class="attachment-chip" title="Open attachment">
                <span class="att-title">${escapeHtml(m.title || 'Attachment Document')}</span>
                <span class="att-badge">Handout Read</span>
              </a>
            `).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="assignment-meta-card">
        <div class="meta-row">
          <span class="meta-course">${escapeHtml(item.course_name || 'Course')}</span>
          <span class="status-pill status-${(item.status || 'not_started').toLowerCase()}">${escapeHtml(item.status || 'NOT_STARTED')}</span>
        </div>
        <h3 class="meta-title">${escapeHtml(item.title)}</h3>
        <p class="meta-desc">${escapeHtml(item.description || 'No description provided by instructor.')}</p>

        ${materialsHtml}
        
        <div class="meta-footer">
          <div class="due-tag">
            <span class="tag-label">Due: </span>
            <span class="tag-val">${escapeHtml(deadlineStr)}</span>
          </div>
          <div class="req-tag">
            <span class="tag-label">Specs: </span>
            <span class="tag-val">${reqCount > 0 ? `${reqCount} detected` : 'Direct analysis'}</span>
          </div>
        </div>

        <button class="btn btn-primary btn-block btn-execute" id="btn-execute-assignment" data-action="submitNow" onclick="AddonApp.submitNow()">
          ${this.state.isExecuting ? 'Synthesizing and turning in to Classroom...' : (item.status === 'SUBMITTED' ? 'Turned in to Google Classroom (Re-Submit)' : '1-Click Create & Direct Turn-In (No Download)')}
        </button>
      </div>
    `;

    this.renderDeliverablesBox();
    this.renderAutomationSection();
    this.renderValidationPanel();
  },

  renderEmptyAssignmentState(errMsg = null) {
    const container = document.getElementById("assignment-details-box");
    if (!container) return;
    container.innerHTML = `
      <div class="empty-compact">
        <div style="font-weight: 700; margin-bottom: 4px;">NO ASSIGNMENTS FOUND</div>
        <div>${errMsg ? escapeHtml(errMsg) : 'No Google Classroom assignments were found. Sign in with Google or click Sync Classroom.'}</div>
        <button class="btn btn-secondary btn-sm" style="margin-top: 8px;" onclick="AddonApp.syncClassroom()">Sync Classroom</button>
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
          <span class="step-icon">${hasSpec ? '[x]' : '[ ]'}</span>
          <span class="step-label">Assignment analyzed</span>
        </div>
        <div class="step-item ${hasFiles ? 'step-done' : ''}">
          <span class="step-icon">${hasFiles ? '[x]' : '[ ]'}</span>
          <span class="step-label">Files synthesized</span>
        </div>
        <div class="step-item ${isValidated ? 'step-done' : (this.state.isValidating ? 'step-active' : '')}">
          <span class="step-icon">${isValidated ? '[x]' : '[ ]'}</span>
          <span class="step-label">Validation passed</span>
        </div>
        <div class="step-item ${isSubmitted ? 'step-done' : (isScheduled ? 'step-scheduled' : '')}">
          <span class="step-icon">${isSubmitted ? '[x]' : (isScheduled ? '[sched]' : '[ ]')}</span>
          <span class="step-label">${isSubmitted ? 'Turned in to Classroom' : (isScheduled ? 'Submission scheduled' : 'Submission ready')}</span>
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

      await Promise.all([
        this.loadAssignmentSpec(this.state.selectedId),
        this.loadAssignmentDeliverable(this.state.selectedId)
      ]);

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
    this.renderValidationPanel();

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
      this.renderValidationPanel();
      this.renderProgressTracker();
    }
  },

  switchDelivTab(tabName) {
    this.state.delivTab = tabName;
    this.renderDeliverablesBox();
  },

  renderDeliverablesBox() {
    const box = document.getElementById("deliverables-box");
    if (!box) return;

    const deliv = this.state.deliverable;
    const val = this.state.validation;

    if (!deliv) {
      box.innerHTML = `
        <div class="empty-compact">
          <span>Deliverables not yet generated. Click <b>Execute Assignment</b> or Turn-In.</span>
        </div>
      `;
      return;
    }

    const hasReport = !!(deliv.has_report || deliv.report_content);
    if (!this.state.delivTab) {
      this.state.delivTab = hasReport ? 'report' : 'code';
    }
    const currentTab = this.state.delivTab;
    const reportContent = deliv.report_content || "";
    const codeSnippet = deliv.code_or_content || "";
    const reportName = deliv.report_file_name || "Academic_Lab_Report.docx";
    const codeName = deliv.file_name || "main.c";

    let tabBodyHtml = "";

    if (currentTab === 'report') {
      tabBodyHtml = `
        <div class="report-view-container">
          <div class="report-header-banner">
            <div class="rep-badge">STUDENT LAB REPORT - PREPARED FROM PROFESSOR HANDOUT</div>
            <div class="rep-title">${escapeHtml(reportName)}</div>
          </div>
          <div class="report-body-content">
            ${this.renderMarkdownHtml(reportContent || 'Student Academic Lab Report generated from professor assignment handout.')}
          </div>
        </div>
      `;
    } else {
      tabBodyHtml = `
        <div class="code-view-container">
          <div class="code-header-bar">
            <div class="code-title">
              <span class="file-ext">${escapeHtml(deliv.file_type || '.c')}</span>
              <b>${escapeHtml(codeName)}</b>
            </div>
            <button class="btn btn-secondary btn-xs" onclick="AddonApp.copyDeliverableCode()">Copy Code</button>
          </div>
          <div class="code-preview-wrap">
            <pre class="code-preview"><code>${escapeHtml(codeSnippet)}</code></pre>
          </div>
        </div>
      `;
    }

    box.innerHTML = `
      <div class="deliv-card">
        <div class="deliv-action-toolbar">
          <div class="deliv-tabs-nav">
            ${hasReport ? `
              <button class="deliv-nav-tab ${currentTab === 'report' ? 'active' : ''}" onclick="AddonApp.switchDelivTab('report')">
                Lab Report (.docx)
              </button>
            ` : ''}
            <button class="deliv-nav-tab ${currentTab === 'code' ? 'active' : ''}" onclick="AddonApp.switchDelivTab('code')">
              Source Code (${escapeHtml(deliv.file_type || '.c')})
            </button>
          </div>
          
          <div class="deliv-export-actions">
            <button class="btn btn-secondary btn-xs" onclick="AddonApp.downloadAll()" title="Download Full Student Submission Package">
              Backup (.zip)
            </button>
          </div>
        </div>

        ${tabBodyHtml}
      </div>
    `;
  },

  renderValidationPanel() {
    const container = document.getElementById("workbench-validation-panel");
    if (!container) return;

    const val = this.state.validation;
    if (!val) {
      container.innerHTML = `
        <div class="empty-compact">
          <span>Validation oracle has not been executed yet. Click below to verify syntax, compilation, and test assertions in an isolated sandbox.</span>
          <button class="btn btn-secondary btn-sm" style="margin-top: 10px;" onclick="AddonApp.validateDeliverable()" ${this.state.isValidating ? 'disabled' : ''}>
            ${this.state.isValidating ? 'Compiling in sandbox...' : 'Run Validation Oracle'}
          </button>
        </div>
      `;
      return;
    }

    const checklist = val.checklist || [];
    container.innerHTML = `
      <div class="validation-view-container">
        <div class="val-header-bar">
          <div class="val-status-badge ${val.passed ? 'status-pass' : 'status-fail'}">
            ${val.passed ? 'VERIFICATION PASSED (EXIT CODE 0)' : 'VALIDATION FLAGGED ISSUES'}
          </div>
          <button class="btn btn-secondary btn-xs" onclick="AddonApp.validateDeliverable()" ${this.state.isValidating ? 'disabled' : ''}>
            ${this.state.isValidating ? 'Running...' : 'Re-Run Compiler'}
          </button>
        </div>

        <div class="val-checklist">
          <div class="val-title">AUTOMATED TEST &amp; COMPILER CHECKLIST:</div>
          ${checklist.length > 0 ? checklist.map(c => `
            <div class="check-item ${c.passed ? 'check-pass' : 'check-fail'}">
              <span style="font-family: var(--font-mono); font-weight: 700;">${c.passed ? '[PASS]' : '[FAIL]'}</span>
              <span class="check-text"><b>${escapeHtml(c.title)}:</b> ${escapeHtml(c.details || '')}</span>
            </div>
          `).join('') : '<div class="empty-compact">No checklist items recorded.</div>'}
        </div>

        ${val.compiler_output ? `
          <div class="terminal-log-wrap" style="margin-top: 8px;">
            <div class="log-title" style="font-size: 10px; font-weight: 700; color: var(--text-muted);">COMPILER OUTPUT (gcc / javac):</div>
            <pre class="terminal-log"><code>${escapeHtml(val.compiler_output)}</code></pre>
          </div>
        ` : ''}

        ${val.test_output ? `
          <div class="terminal-log-wrap" style="margin-top: 8px;">
            <div class="log-title" style="font-size: 10px; font-weight: 700; color: var(--text-muted);">EXECUTION TEST SUITE STDOUT:</div>
            <pre class="terminal-log" style="color: #86efac;"><code>${escapeHtml(val.test_output)}</code></pre>
          </div>
        ` : ''}
      </div>
    `;
  },

  async downloadReport() {
    if (!this.state.selectedId) return;
    try {
      const blob = await api(`/assignment/${this.state.selectedId}/download-report`);
      const fileName = (this.state.deliverable && this.state.deliverable.report_file_name) || "Academic_Report.docx";
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

  async downloadAll() {
    if (!this.state.selectedId) return;
    try {
      Toast.info("Packaging verified source code and academic report into zip archive...");
      const blob = await api(`/assignment/${this.state.selectedId}/download-all`);
      const baseName = (this.state.deliverable && this.state.deliverable.file_name)
        ? this.state.deliverable.file_name.replace(/\.[^/.]+$/, "")
        : "Submission";
      const fileName = `${baseName}_Package.zip`;
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

  renderMarkdownHtml(md) {
    if (!md) return '';
    let escaped = escapeHtml(md);

    // Convert markdown tables
    const lines = escaped.split('\n');
    let inTable = false;
    let tableHtml = '';
    const processed = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        if (!inTable) {
          inTable = true;
          tableHtml = '<div class="report-table-wrap"><table class="report-table"><tbody>';
        }
        if (line.includes('---')) {
          continue;
        }
        const cells = line.split('|').slice(1, -1);
        const isHeader = !tableHtml.includes('<tr>');
        tableHtml += '<tr>' + cells.map(c => `<${isHeader ? 'th' : 'td'}>${c.trim()}</${isHeader ? 'th' : 'td'}>`).join('') + '</tr>';
      } else {
        if (inTable) {
          tableHtml += '</tbody></table></div>';
          processed.push(tableHtml);
          inTable = false;
          tableHtml = '';
        }
        processed.push(lines[i]);
      }
    }
    if (inTable) {
      tableHtml += '</tbody></table></div>';
      processed.push(tableHtml);
    }

    let out = processed.join('\n');
    out = out.replace(/^### (.*$)/gim, '<h4 class="rep-h4">$1</h4>');
    out = out.replace(/^## (.*$)/gim, '<h3 class="rep-h3">$1</h3>');
    out = out.replace(/^# (.*$)/gim, '<h2 class="rep-h2">$1</h2>');
    out = out.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    out = out.replace(/\*(.*?)\*/g, '<i>$1</i>');
    out = out.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    out = out.replace(/^---$/gim, '<hr class="rep-hr" />');
    out = out.replace(/^(\*|\-) (.*$)/gim, '<div class="rep-bullet">- $2</div>');
    out = out.replace(/\n\n+/g, '<div class="rep-spacer"></div>');
    return out;
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

  copyDeliverableCode() {
    const code = this.state.deliverable?.code_or_content;
    if (!code) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        Toast.success("Code copied to clipboard!");
      }).catch(() => {
        Toast.info("Copying enabled. Select from preview.");
      });
    } else {
      Toast.info("Clipboard access restricted in current browser context.");
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
      outputEl.innerHTML = `<div class="loading-compact"><span class="spinner-dot"></span>Querying course material with AI...</div>`;
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
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <b>${actionType === 'summary' ? 'Course Syllabus Summary' : 'Grounded Viva Questions'}</b>
              <button class="btn btn-secondary btn-xs" onclick="document.getElementById('material-output-box').style.display='none'">&times; Close</button>
            </div>
            <div class="result-body" style="font-size: 12px; line-height: 1.5;">${escapeHtml(res.content)}</div>
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

  // ── 7. Auto-Submission & Auto-Pilot ─────────────────────────────────────
  renderAutomationSection() {
    const container = document.getElementById("automation-details-box");
    if (!container) return;

    const isSubmitted = this.state.activeItem && this.state.activeItem.status === "SUBMITTED";
    const isAutoPilot = localStorage.getItem("academic_autopilot") === "true";

    const sidebarLabel = document.getElementById("sidebar-autopilot-label");
    if (sidebarLabel) sidebarLabel.textContent = isAutoPilot ? "Active (ON)" : "Paused (OFF)";

    if (isSubmitted) {
      container.innerHTML = `
        <div class="gatekeeper-row">
          <div>
            <div class="auto-title" style="color: #34d399; font-size: 13px;">
              TURNED IN DIRECTLY TO GOOGLE CLASSROOM
            </div>
            <div class="auto-sub" style="color: var(--text-secondary); margin-top: 3px;">
              Deliverables attached to coursework in Google Drive and turned in.
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" data-action="reclaimSubmission" onclick="AddonApp.reclaimSubmission()">
            Unsubmit / Reclaim
          </button>
        </div>
      `;
      return;
    }

    const sched = this.state.schedule;
    const isAutoOn = !!(sched && sched.auto_submit_enabled);
    const schedTimeStr = sched && sched.scheduled_time
      ? new Date(sched.scheduled_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Default: 4 hours before deadline';

    container.innerHTML = `
      <div class="gatekeeper-row">
        <div>
          <div class="auto-title" style="display: flex; align-items: center; gap: 8px;">
            <span>AUTONOMOUS AUTO-SUBMIT</span>
            <span class="status-pill ${isAutoPilot ? 'status-submitted' : (isAutoOn ? 'status-ready_for_submission' : 'status-not_started')}">
              ${isAutoPilot ? 'AUTOPILOT ACTIVE' : (isAutoOn ? 'SCHEDULED' : 'READY')}
            </span>
          </div>
          <div class="auto-sub">Scheduled Execution: <b>${escapeHtml(schedTimeStr)}</b></div>
        </div>

        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn btn-sm ${isAutoPilot ? 'btn-success' : 'btn-secondary'}" data-action="toggleAutoPilot" onclick="AddonApp.toggleAutoPilot()">
            ${isAutoPilot ? 'Autopilot: ON' : 'Enable Autopilot'}
          </button>
          <button class="btn btn-primary btn-sm" id="btn-submit-now" data-action="submitNow" onclick="AddonApp.submitNow()">
            Direct Turn-In (No Download)
          </button>
        </div>
      </div>
    `;
  },

  toggleAutoPilot() {
    const current = localStorage.getItem("academic_autopilot") === "true";
    const nextVal = !current;
    localStorage.setItem("academic_autopilot", nextVal ? "true" : "false");
    Toast.success(nextVal ? "Auto-Pilot ON: Assignments submit automatically upon selection." : "Auto-Pilot paused.");
    this.renderAutomationSection();
    if (nextVal && this.state.activeItem && this.state.activeItem.status !== "SUBMITTED" && !this.state.isExecuting) {
      this.submitNow();
    }
  },

  async reclaimSubmission() {
    if (!this.state.selectedId) return;

    try {
      Toast.info("Reclaiming submission from Google Classroom...");
      const res = await api("/submission/reclaim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coursework_id: this.state.selectedId })
      });

      Toast.success(res.message || "Submission reclaimed successfully.");
      if (this.state.activeItem) this.state.activeItem.status = res.status || "READY_FOR_SUBMISSION";
      this.renderAssignmentSection();
      this.renderProgressTracker();
    } catch (e) {
      Toast.error(`Reclaim failed: ${e.message}`);
    }
  },

  async toggleAutoSubmit() {
    if (!this.state.selectedId) return;
    const currentlyOn = !!(this.state.schedule && this.state.schedule.auto_submit_enabled);
    const newStatus = !currentlyOn;

    try {
      await api(`/assignment/${this.state.selectedId}/schedule`, {
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
    if (!this.state.selectedId || this.state.isExecuting) return;

    try {
      this.state.isExecuting = true;
      this.renderProgressTracker();
      this.renderAssignmentSection();
      Toast.info("Synthesizing deliverables, running verification, and turning in to Google Classroom...");
      const res = await api(`/assignment/${this.state.selectedId}/autonomous-submit`, {
        method: "POST"
      });

      Toast.success(res.message || "Assignment turned in directly to Google Classroom. Zero download needed.");
      await this.loadCoursework();
      await this.selectCoursework(this.state.selectedId, false);
    } catch (e) {
      Toast.error(`Submission: ${e.message}`);
    } finally {
      this.state.isExecuting = false;
      this.renderProgressTracker();
      this.renderAssignmentSection();
    }
  },

  // ── 8. Integrations & Auth Triggers ────────────────────────────────────
  async syncClassroom() {
    try {
      Toast.info("Syncing enrolled courses and coursework from Google Classroom...");
      const res = await api("/classroom/sync", { method: "POST" });
      Toast.success(res.message || "Classroom synchronized!");
      await this.loadAuthStatus();
      await this.loadCourses();
      await this.loadCoursework();
    } catch (e) {
      Toast.error(`Sync Failed: ${e.message}`);
    }
  },

  async launchGoogleOAuth() {
    try {
      const currentTarget = encodeURIComponent(window.location.pathname || "/addon");
      const res = await api(`/auth/google/url?target=${currentTarget}`);
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
      Toast.warning("Please enter your Student Registration Number and Portal Password.");
      return;
    }

    const btn = document.getElementById("btn-erp-submit");
    if (btn) {
      btn.textContent = "Authenticating...";
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

      Toast.success("Connected to Student Portal! Real timetable synchronized.");
      if (pwInput) pwInput.value = "";
      closeModal("settings-modal");
      await this.loadAuthStatus();
      await this.loadNextClass();
    } catch (e) {
      Toast.error(`Portal Connection Failed: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "Connect Student Portal";
        btn.disabled = false;
      }
    }
  },

  async disconnectERP() {
    try {
      await api("/erp/disconnect", { method: "POST" });
      Toast.success("Student portal disconnected.");
      await this.loadAuthStatus();
      await this.loadNextClass();
    } catch (e) {
      Toast.error(`Disconnect failed: ${e.message}`);
    }
  },

  async refreshERP() {
    try {
      Toast.info("Refreshing live timetable from portal...");
      await api("/erp/refresh", { method: "POST" });
      Toast.success("Timetable refreshed successfully!");
      await this.loadAuthStatus();
      await this.loadNextClass();
      if (this.state.currentTab === "timetable") {
        this.renderTimetableView();
      }
    } catch (e) {
      Toast.error(`Refresh failed: ${e.message}`);
    }
  },

  async disconnectGoogle() {
    try {
      await api("/auth/disconnect", { method: "POST" });
      Toast.success("Google Classroom disconnected.");
      await this.loadAuthStatus();
      await this.loadCourses();
      await this.loadCoursework();
    } catch (e) {
      Toast.error(`Disconnect failed: ${e.message}`);
    }
  },

  async saveGoogleCredentials() {
    const cid = (document.getElementById("config-client-id")?.value || "").trim();
    const sec = (document.getElementById("config-client-secret")?.value || "").trim();
    const openaiKey = (document.getElementById("config-openai-key")?.value || "").trim();

    if (!cid && !sec && !openaiKey) {
      Toast.warning("Please provide either Google credentials or an OpenAI API key.");
      return;
    }
    try {
      const res = await api("/config/google-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: cid, client_secret: sec, openai_api_key: openaiKey })
      });
      Toast.success(res.message || "Credentials saved successfully!");
      if (cid && sec) {
        this.switchModalTab("google");
      }
    } catch (e) {
      Toast.error(`Failed to save credentials: ${e.message}`);
    }
  },

  async quickConnectERP() {
    try {
      Toast.info("Loading SRM AP CSE schedule & variable classrooms...");
      const res = await api("/erp/quick-connect", { method: "POST" });
      Toast.success(res.message || "Timetable connected!");
      await this.loadAuthStatus();
      await this.loadNextClass();
      if (this.state.currentTab === "timetable") {
        this.renderTimetableView();
      }
      closeModal("settings-modal");
    } catch (e) {
      Toast.error(`Timetable Error: ${e.message}`);
    }
  },

  async connectDirectToken() {
    const input = document.getElementById("direct-token-input");
    const token = input ? input.value.trim() : "";
    if (!token) {
      Toast.warning("Please paste a Google access token.");
      return;
    }
    try {
      Toast.info("Validating and connecting Google token...");
      const res = await api("/auth/google/direct-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token })
      });
      Toast.success(res.message || "Connected successfully!");
      if (input) input.value = "";
      await this.loadAuthStatus();
      await this.loadCourses();
      await this.loadCoursework();
      closeModal("settings-modal");
    } catch (e) {
      Toast.error(`Direct token failed: ${e.message}`);
    }
  },

  // ── Timetable View ─────────────────────────────────────────────────────
  async renderTimetableView() {
    const container = document.getElementById("timetable-schedule-container");
    if (!container) return;

    try {
      const schedule = await api("/timetable/weekly").catch(() => []);
      if (!schedule || schedule.length === 0) {
        container.innerHTML = `
          <div class="empty-compact">
            <span>No weekly timetable entries loaded yet. Click <b>Load SRM AP Schedule</b> above to load official schedule.</span>
          </div>
        `;
        return;
      }

      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${schedule.map(slot => `
            <div class="next-class-box" style="padding: 10px 14px;">
              <div class="nc-top">
                <span class="status-pill status-ready_for_submission">${days[slot.day_of_week] || 'Day ' + slot.day_of_week}</span>
                <span class="nc-time">${escapeHtml(slot.start_time)} - ${escapeHtml(slot.end_time)}</span>
              </div>
              <div class="nc-subject">${escapeHtml(slot.subject)}</div>
              <div class="nc-meta">
                <span class="nc-room">Room: <b>${escapeHtml(slot.classroom || 'TBD')}</b></span>
                ${slot.faculty ? `<span class="nc-faculty">| ${escapeHtml(slot.faculty)}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (e) {
      container.innerHTML = `<div class="empty-compact text-danger">Error loading timetable: ${escapeHtml(e.message)}</div>`;
    }
  },

  // ── 9. Command Palette (Ctrl+K) ─────────────────────────────────────────
  setupCommandPalette() {
    const input = document.getElementById("command-palette-input");
    if (input) {
      input.addEventListener("input", () => this.filterCommands(input.value));
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          this.moveCommandSelection(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          this.moveCommandSelection(-1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          this.executeSelectedCommand();
        } else if (e.key === "Escape") {
          this.closeCommandPalette();
        }
      });
    }

    // Global keyboard shortcut
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        this.openCommandPalette();
      }
    });
  },

  openCommandPalette() {
    const palette = document.getElementById("command-palette");
    const input = document.getElementById("command-palette-input");
    if (palette) {
      palette.classList.add("active");
      if (input) {
        input.value = "";
        input.focus();
      }
      this.filterCommands("");
    }
  },

  closeCommandPalette() {
    const palette = document.getElementById("command-palette");
    if (palette) palette.classList.remove("active");
  },

  getAvailableCommands() {
    const baseCommands = [
      { id: "nav_workspace", title: "Go to Assignment Workbench", badge: "Navigation", run: () => this.switchMainTab("workspace") },
      { id: "nav_overview", title: "Go to System Overview & Schedule", badge: "Navigation", run: () => this.switchMainTab("overview") },
      { id: "nav_courses", title: "Go to Enrolled Courses", badge: "Navigation", run: () => this.switchMainTab("courses") },
      { id: "nav_brain", title: "Go to Study Brain & Handouts", badge: "Navigation", run: () => this.switchMainTab("brain") },
      { id: "nav_timetable", title: "Go to Timetable & Variable Rooms", badge: "Navigation", run: () => this.switchMainTab("timetable") },
      { id: "act_submit", title: "1-Click Direct Turn-In (No Download)", badge: "Action", run: () => this.submitNow() },
      { id: "act_validate", title: "Run Validation Oracle & Compiler", badge: "Action", run: () => this.validateDeliverable() },
      { id: "act_sync", title: "Sync Google Classroom Enrolled Data", badge: "Classroom", run: () => this.syncClassroom() },
      { id: "act_refresh_erp", title: "Refresh Timetable & Schedule", badge: "Portal", run: () => this.refreshERP() },
      { id: "act_theme", title: "Toggle Light / Dark Theme", badge: "Appearance", run: () => this.toggleTheme() },
      { id: "act_settings", title: "Open Settings & Credentials Modal", badge: "Settings", run: () => openModal("settings-modal") },
      { id: "act_autopilot", title: "Toggle Autonomous Autopilot Mode", badge: "Automation", run: () => this.toggleAutoPilot() }
    ];

    // Append active coursework items
    const cwCommands = (this.state.coursework || []).map(cw => ({
      id: `cw_${cw.id}`,
      title: `Assignment: ${cw.title}`,
      badge: cw.course_name || "Coursework",
      run: () => {
        this.switchMainTab("workspace");
        this.selectCoursework(cw.id);
      }
    }));

    return [...baseCommands, ...cwCommands];
  },

  filterCommands(query) {
    const all = this.getAvailableCommands();
    const q = (query || "").toLowerCase().trim();
    const filtered = q
      ? all.filter(c => c.title.toLowerCase().includes(q) || c.badge.toLowerCase().includes(q))
      : all;

    this.state.commands = filtered;
    this.state.cmdSelectedIndex = 0;
    this.renderCommandResults();
  },

  renderCommandResults() {
    const container = document.getElementById("command-palette-results");
    if (!container) return;

    if (this.state.commands.length === 0) {
      container.innerHTML = `<div class="empty-compact"><span>No matching commands or coursework.</span></div>`;
      return;
    }

    container.innerHTML = this.state.commands.map((cmd, idx) => `
      <div class="command-palette-item ${idx === this.state.cmdSelectedIndex ? 'selected' : ''}"
        onclick="AddonApp.executeCommand(${idx})">
        <div class="command-palette-item-left">
          <span>${escapeHtml(cmd.title)}</span>
        </div>
        <span class="command-palette-badge">${escapeHtml(cmd.badge)}</span>
      </div>
    `).join("");
  },

  moveCommandSelection(dir) {
    const len = this.state.commands.length;
    if (len === 0) return;
    this.state.cmdSelectedIndex = (this.state.cmdSelectedIndex + dir + len) % len;
    this.renderCommandResults();
  },

  executeSelectedCommand() {
    this.executeCommand(this.state.cmdSelectedIndex);
  },

  executeCommand(idx) {
    const cmd = this.state.commands[idx];
    if (cmd && typeof cmd.run === "function") {
      this.closeCommandPalette();
      cmd.run();
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
  if (m) {
    m.classList.add("active");
    m.setAttribute("aria-hidden", "false");
  }
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.remove("active");
    m.setAttribute("aria-hidden", "true");
  }
}

// ── Expose globals explicitly on window for cross-frame / inline compatibility
window.AddonApp = AddonApp;
window.openModal = openModal;
window.closeModal = closeModal;
window.Toast = Toast;
window.api = api;

// ── Global Event Delegation ────────────────────────────────────────────────
document.addEventListener("click", (e) => {
  // Modal backdrop click
  if (e.target && e.target.classList && (e.target.classList.contains("modal-overlay") || e.target.classList.contains("command-palette-overlay"))) {
    e.target.classList.remove("active");
    e.target.setAttribute("aria-hidden", "true");
    return;
  }

  const actionEl = e.target.closest("[data-action]");
  if (actionEl) {
    const action = actionEl.getAttribute("data-action");
    switch (action) {
      case "openSettingsTab": {
        const tab = actionEl.getAttribute("data-tab") || "portal";
        AddonApp.openSettingsTab(tab);
        break;
      }
      case "switchModalTab": {
        const tab = actionEl.getAttribute("data-tab") || "portal";
        AddonApp.switchModalTab(tab);
        break;
      }
      case "openModal": {
        const mid = actionEl.getAttribute("data-modal") || "settings-modal";
        openModal(mid);
        break;
      }
      case "closeModal": {
        const mid = actionEl.getAttribute("data-modal") || "settings-modal";
        closeModal(mid);
        break;
      }
      case "launchGoogleOAuth":
        AddonApp.launchGoogleOAuth();
        break;
      case "quickConnectERP":
        AddonApp.quickConnectERP();
        break;
      case "connectERP":
        AddonApp.connectERP();
        break;
      case "refreshERP":
        AddonApp.refreshERP();
        break;
      case "disconnectERP":
        AddonApp.disconnectERP();
        break;
      case "syncClassroom":
        AddonApp.syncClassroom();
        break;
      case "disconnectGoogle":
        AddonApp.disconnectGoogle();
        break;
      case "connectDirectToken":
        AddonApp.connectDirectToken();
        break;
      case "saveGoogleCredentials":
        AddonApp.saveGoogleCredentials();
        break;
      case "toggleAutoSubmit":
        AddonApp.toggleAutoSubmit();
        break;
      case "toggleAutoPilot":
        AddonApp.toggleAutoPilot();
        break;
      case "submitNow":
        AddonApp.submitNow();
        break;
      case "executeAssignment":
        AddonApp.executeAssignment();
        break;
      case "validateDeliverable":
        AddonApp.validateDeliverable();
        break;
      case "copyDeliverableCode":
        AddonApp.copyDeliverableCode();
        break;
      case "downloadReport":
        AddonApp.downloadReport();
        break;
      case "downloadDeliverable":
        AddonApp.downloadDeliverable();
        break;
      case "downloadAll":
        AddonApp.downloadAll();
        break;
      case "reclaimSubmission":
        AddonApp.reclaimSubmission();
        break;
    }
    return;
  }

  const executeBtn = e.target.closest("#btn-execute-assignment, .btn-execute");
  if (executeBtn) {
    AddonApp.executeAssignment();
    return;
  }

  const modalClose = e.target.closest(".modal-close");
  if (modalClose) {
    const parentModal = modalClose.closest(".modal-overlay");
    if (parentModal) closeModal(parentModal.id);
    return;
  }
});

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

  // Bind Escape to close any open modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay.active, .command-palette-overlay.active").forEach(m => {
        m.classList.remove("active");
        m.setAttribute("aria-hidden", "true");
      });
    }
  });
});
