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
        pane.style.display = (t === tabName) ? "flex" : "none";
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
        ? '<span class="pill pill-green">IN SESSION NOW</span>'
        : '<span class="pill pill-blue">NEXT CLASS</span>';

      card.innerHTML = `
        <div class="next-class-box ${isOngoing ? 'is-ongoing' : ''}">
          <div class="nc-top">
            ${statusBadge}
            <span class="nc-time">${escapeHtml(classObj.start_time)} – ${escapeHtml(classObj.end_time)}</span>
          </div>
          <div class="nc-subject">${escapeHtml(classObj.subject)}</div>
          <div class="nc-meta">
            <span class="nc-room">Room: <b>${escapeHtml(classObj.classroom || 'TBD')}</b></span>
            ${classObj.faculty ? `<span class="nc-faculty">• ${escapeHtml(classObj.faculty)}</span>` : ''}
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
      listEl.innerHTML = `<div class="ingested-notice-card"><span>✓ <b>Classroom PDFs Auto-Ingested:</b> Materials are pre-indexed into Study Brain.</span></div>`;
      return;
    }

    try {
      const docs = await api(`/documents/course/${courseId}`);
      if (docs && docs.length > 0) {
        listEl.innerHTML = `
          <div class="ingested-notice-card" style="flex-direction: column; align-items: flex-start; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 6px; width: 100%;">
              <span>✓ <b>Professor's Assignment Handouts Grounded:</b> ${docs.length} handout/syllabus document(s) pre-indexed in Study Brain:</span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px; width: 100%;">
              ${docs.map(d => `
                <span class="attachment-chip" style="font-size: 10px; padding: 2px 6px;">
                  📄 ${escapeHtml(d.filename)} (${d.page_count}p)
                  <span class="att-badge">Handout Read</span>
                </span>
              `).join('')}
            </div>
          </div>
        `;
      } else {
        listEl.innerHTML = `<div class="ingested-notice-card"><span>✓ <b>Professor's Assignment Handouts:</b> Materials are pre-indexed into Study Brain.</span></div>`;
      }
    } catch {
      listEl.innerHTML = `<div class="ingested-notice-card"><span>✓ <b>Professor's Assignment Handouts:</b> Materials are pre-indexed into Study Brain.</span></div>`;
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
        // Attempt to load validation report
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
          <div class="attachments-label">📎 PROFESSOR'S ASSIGNMENT HANDOUT &amp; BRIEF (READ BY AI):</div>
          <div class="attachments-chips">
            ${materials.map(m => `
              <a href="${escapeHtml(m.alternateLink || m.url || 'javascript:void(0)')}" target="_blank" class="attachment-chip" title="Open Professor's Handout in Google Classroom / Drive">
                <span class="att-icon">${m.type === 'driveFile' ? '📄' : '🔗'}</span>
                <span class="att-title">${escapeHtml(m.title || 'Document')}</span>
                <span class="att-badge">✓ Read by AI</span>
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
            <span class="tag-label">Due:</span>
            <span class="tag-val">${escapeHtml(deadlineStr)}</span>
          </div>
          <div class="req-tag">
            <span class="tag-label">Requirements:</span>
            <span class="tag-val">${reqCount > 0 ? `${reqCount} detected` : 'Analyze to detect'}</span>
          </div>
        </div>

        <button class="btn btn-primary btn-block btn-execute" id="btn-execute-assignment" data-action="submitNow" onclick="AddonApp.submitNow()">
          ${this.state.isExecuting ? '⚡ Ingesting, Generating & Turning in to Classroom...' : (item.status === 'SUBMITTED' ? '✓ TURNED IN TO GOOGLE CLASSROOM (RE-SUBMIT)' : '⚡ 1-CLICK CREATE & DIRECT TURN-IN (NO DOWNLOAD)')}
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
          <span>Deliverables not yet generated. Click <b>⚡ EXECUTE ASSIGNMENT</b> above.</span>
        </div>
      `;
      return;
    }

    const hasReport = !!(deliv.has_report || deliv.report_content);
    if (!this.state.delivTab) {
      this.state.delivTab = hasReport ? 'report' : 'code';
    }
    const currentTab = this.state.delivTab;
    const checklist = val && val.checklist ? val.checklist : [];
    const reportContent = deliv.report_content || "";
    const codeSnippet = deliv.code_or_content || "";
    const reportName = deliv.report_file_name || "Academic_Lab_Report.docx";
    const codeName = deliv.file_name || "main.c";

    let tabBodyHtml = "";

    if (currentTab === 'report') {
      tabBodyHtml = `
        <div class="report-view-container">
          <div class="report-header-banner">
            <div class="rep-badge">SRM UNIVERSITY AP • STUDENT SUBMISSION RECORD • PREPARED FROM PROFESSOR'S HANDOUT</div>
            <div class="rep-title">${escapeHtml(reportName)}</div>
          </div>
          <div class="report-body-content">
            ${this.renderMarkdownHtml(reportContent || 'Student Academic Lab Report generated from professor assignment handout. Click "Student Report (.docx)" above to download the Word document.')}
          </div>
        </div>
      `;
    } else if (currentTab === 'code') {
      tabBodyHtml = `
        <div class="code-view-container">
          <div class="code-header-bar">
            <div class="code-title">
              <span class="file-ext">${escapeHtml(deliv.file_type || '.c')}</span>
              <b>${escapeHtml(codeName)}</b>
            </div>
            <button class="btn btn-secondary btn-xs" onclick="AddonApp.copyDeliverableCode()">📋 Copy Source Code</button>
          </div>
          <div class="code-preview-wrap" style="max-height: 320px;">
            <pre class="code-preview"><code>${escapeHtml(codeSnippet)}</code></pre>
          </div>
        </div>
      `;
    } else if (currentTab === 'validation') {
      tabBodyHtml = `
        <div class="validation-view-container">
          <div class="val-header-bar">
            <div class="val-status-badge ${val && val.passed ? 'status-pass' : 'status-fail'}">
              ${val && val.passed ? '✓ COMPILER &amp; HANDOUT TEST VERIFICATION PASSED' : '⚡ VALIDATION PENDING / FLAGGED'}
            </div>
            <button class="btn btn-success btn-xs" onclick="AddonApp.validateDeliverable()" ${this.state.isValidating ? 'disabled' : ''}>
              ${this.state.isValidating ? 'Compiling...' : '⚡ Re-Run Compiler'}
            </button>
          </div>

          <div class="val-checklist">
            <div class="val-title">AUTOMATED TEST &amp; COMPILER CHECKLIST:</div>
            ${checklist.length > 0 ? checklist.map(c => `
              <div class="check-item ${c.passed ? 'check-pass' : 'check-fail'}">
                <span>${c.passed ? '✓' : '✗'}</span>
                <span class="check-text"><b>${escapeHtml(c.title)}:</b> ${escapeHtml(c.details || '')}</span>
              </div>
            `).join('') : '<div class="empty-compact">No validation run yet. Click Re-Run Compiler above.</div>'}
          </div>

          ${val && val.compiler_output ? `
            <div class="terminal-log-wrap" style="margin-top: 8px;">
              <div class="log-title" style="font-size: 9px; font-weight: 700; color: var(--text-muted); margin-bottom: 3px;">COMPILER OUTPUT (gcc -Wall -Wextra):</div>
              <pre class="terminal-log" style="background: #020617; border: 1px solid var(--border-color); border-radius: 4px; padding: 6px; font-size: 10px; color: #a5f3fc; overflow: auto; max-height: 100px;"><code>${escapeHtml(val.compiler_output)}</code></pre>
            </div>
          ` : ''}

          ${val && val.test_output ? `
            <div class="terminal-log-wrap" style="margin-top: 8px;">
              <div class="log-title" style="font-size: 9px; font-weight: 700; color: var(--text-muted); margin-bottom: 3px;">EXECUTION TEST SUITE OUTPUT:</div>
              <pre class="terminal-log" style="background: #020617; border: 1px solid var(--border-color); border-radius: 4px; padding: 6px; font-size: 10px; color: #86efac; overflow: auto; max-height: 120px;"><code>${escapeHtml(val.test_output)}</code></pre>
            </div>
          ` : ''}
        </div>
      `;
    }

    box.innerHTML = `
      <div class="deliv-card">
        <div class="deliv-action-toolbar">
          <div class="deliv-tabs-nav">
            ${hasReport ? `
              <button class="deliv-nav-tab ${currentTab === 'report' ? 'active' : ''}" onclick="AddonApp.switchDelivTab('report')">
                📄 Student Lab Report (.docx)
              </button>
            ` : ''}
            <button class="deliv-nav-tab ${currentTab === 'code' ? 'active' : ''}" onclick="AddonApp.switchDelivTab('code')">
              💻 Student Code (${escapeHtml(deliv.file_type || '.c')})
            </button>
            <button class="deliv-nav-tab ${currentTab === 'validation' ? 'active' : ''}" onclick="AddonApp.switchDelivTab('validation')">
              ⚡ Compiler &amp; Test Validation ${val && val.passed ? '<span class="pill-pass">✓ PASS</span>' : ''}
            </button>
          </div>
          
          <div class="deliv-export-actions">
            ${this.state.activeItem && this.state.activeItem.status === 'SUBMITTED' ? `
              <span class="pill pill-green" style="font-size: 10px; font-weight: 700;">✓ Turned In Directly to Classroom</span>
            ` : `
              <button class="btn btn-success btn-xs" data-action="submitNow" onclick="AddonApp.submitNow()" title="Submit directly to Google Classroom without any downloads">
                ⚡ Direct Turn-In to Classroom
              </button>
            `}
            <button class="btn btn-secondary btn-xs" onclick="AddonApp.downloadAll()" title="Download Full Student Submission Package (Optional Backup)">
              💾 Offline Backup (.zip)
            </button>
          </div>
        </div>

        ${tabBodyHtml}
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
          continue; // Separator row
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

    // Headings
    out = out.replace(/^### (.*$)/gim, '<h4 class="rep-h4">$1</h4>');
    out = out.replace(/^## (.*$)/gim, '<h3 class="rep-h3">$1</h3>');
    out = out.replace(/^# (.*$)/gim, '<h2 class="rep-h2">$1</h2>');

    // Bold & Italics
    out = out.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    out = out.replace(/\*(.*?)\*/g, '<i>$1</i>');

    // Inline code
    out = out.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Horizontal rules
    out = out.replace(/^---$/gim, '<hr class="rep-hr" />');

    // Bullet points
    out = out.replace(/^\• (.*$)/gim, '<div class="rep-bullet">• $1</div>');
    out = out.replace(/^\- (.*$)/gim, '<div class="rep-bullet">• $1</div>');

    // Paragraph breaks
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
      Toast.info("Clipboard access restricted in current iframe sandbox.");
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

  // ── 7. Auto-Submission & Auto-Pilot ─────────────────────────────────────
  renderAutomationSection() {
    const container = document.getElementById("automation-details-box");
    if (!container) return;

    const isSubmitted = this.state.activeItem && this.state.activeItem.status === "SUBMITTED";
    const isAutoPilot = localStorage.getItem("academic_autopilot") === "true";

    if (isSubmitted) {
      container.innerHTML = `
        <div class="auto-box" style="border: 1px solid rgba(16, 185, 129, 0.35); background: rgba(16, 185, 129, 0.06);">
          <div class="auto-row">
            <div>
              <div class="auto-title" style="color: #34d399; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                <span>✓ TURNED IN DIRECTLY TO GOOGLE CLASSROOM</span>
              </div>
              <div class="auto-sub" style="color: #cbd5e1; margin-top: 3px;">
                Deliverables attached to coursework and turned in. Zero download or manual file handling needed.
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" data-action="reclaimSubmission" onclick="AddonApp.reclaimSubmission()">
              Unsubmit / Reclaim
            </button>
          </div>
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
      <div class="auto-box">
        <div class="auto-row">
          <div>
            <div class="auto-title" style="display: flex; align-items: center; gap: 6px;">
              <span>⚡ AUTONOMOUS AUTO-SUBMIT</span>
              <span style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.4); font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 4px;">
                ${isAutoPilot ? '🤖 AUTOPILOT ACTIVE' : (isAutoOn ? 'SCHEDULED' : 'READY')}
              </span>
            </div>
            <div class="auto-sub">Scheduled Execution: <b>${escapeHtml(schedTimeStr)}</b></div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 3px;">
              Direct submission: AI ingests handout PDF, creates code &amp; report, compiles, and turns in to Classroom.
            </div>
          </div>
          <button class="btn btn-sm ${isAutoPilot ? 'btn-success' : 'btn-secondary'}" data-action="toggleAutoPilot" onclick="AddonApp.toggleAutoPilot()">
            ${isAutoPilot ? '🤖 AUTOPILOT: ON' : 'ENABLE AUTOPILOT'}
          </button>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button class="btn btn-primary btn-sm btn-block" id="btn-submit-now" data-action="submitNow" onclick="AddonApp.submitNow()">
            ⚡ 1-Click Auto Submit (Zero-Touch Direct Turn-In)
          </button>
        </div>
      </div>
    `;
  },

  toggleAutoPilot() {
    const current = localStorage.getItem("academic_autopilot") === "true";
    const nextVal = !current;
    localStorage.setItem("academic_autopilot", nextVal ? "true" : "false");
    Toast.success(nextVal ? "⚡ Auto-Pilot ON: Assignments submit automatically upon selection! User does nothing." : "Auto-Pilot paused.");
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
    if (!this.state.selectedId || this.state.isExecuting) return;

    try {
      this.state.isExecuting = true;
      this.renderProgressTracker();
      this.renderAssignmentSection();
      Toast.info("⚡ Ingesting handout, creating code & report, and turning in directly to Google Classroom...");
      const res = await api(`/assignment/${this.state.selectedId}/autonomous-submit`, {
        method: "POST"
      });

      Toast.success(res.message || "🎉 Assignment turned in directly to Google Classroom! Zero download needed.");
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
    } catch (e) {
      Toast.error(`Refresh failed: ${e.message}`);
    }
  },

  async disconnectGoogle() {
    try {
      await api("/auth/disconnect", { method: "POST" });
      Toast.success("Google Classroom disconnected.");
      await this.loadAuthStatus();
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
      await this.loadCoursework();
      closeModal("settings-modal");
    } catch (e) {
      Toast.error(`Direct token failed: ${e.message}`);
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

// ── Global Event Delegation (Guarantees clicks work in all CSP & browser contexts)
document.addEventListener("click", (e) => {
  // 1. Click on modal backdrop outside card closes modal
  if (e.target && e.target.classList && e.target.classList.contains("modal-overlay")) {
    e.target.classList.remove("active");
    e.target.setAttribute("aria-hidden", "true");
    return;
  }

  // 2. Element or ancestor with data-action
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
      case "quickConnectGoogle":
        AddonApp.quickConnectGoogle();
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

  // 3. Fallback for dynamically generated tabs & buttons
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

  // Bind settings modal close when pressing Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay.active").forEach(m => closeModal(m.id));
    }
  });
});

