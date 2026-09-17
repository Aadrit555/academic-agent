// ==========================================================================
// Google Classroom API Integration & Coursework Feed Controller
// ==========================================================================

const ClassroomModule = {
  currentFilterCourseId: null,

  async loadClassroom() {
    try {
      const [courses, coursework] = await Promise.all([
        api("/classroom/courses").catch(() => []),
        api("/classroom/coursework").catch(() => [])
      ]);

      AppState.courses = courses;
      AppState.coursework = coursework;

      this.renderCourseSelector(courses);
      this.filterByCourse(this.currentFilterCourseId);
    } catch (e) {
      console.error("Failed to load classroom stream:", e);
    }
  },

  async syncClassroom() {
    const btn = document.getElementById("sync-classroom-btn");
    if (btn) {
      btn.textContent = "Syncing with Google...";
      btn.disabled = true;
    }

    try {
      const res = await api("/classroom/sync", { method: "POST" });
      Toast.success(res.message || "Classroom synchronized successfully.");
      await this.loadClassroom();
      if (typeof loadHomeSummary === "function") loadHomeSummary();
    } catch (e) {
      Toast.error(`Classroom Sync Error: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "Sync Classroom";
        btn.disabled = false;
      }
    }
  },

  renderCourseSelector(courses) {
    const select = document.getElementById("classroom-course-select");
    if (!select) return;

    if (!courses || courses.length === 0) {
      select.innerHTML = `<option value="">All Enrolled Courses (0)</option>`;
      return;
    }

    select.innerHTML = `<option value="">All Enrolled Courses (${courses.length})</option>` + courses.map(c => `
      <option value="${c.id}">${escapeHtml(c.code ? `${c.code} - ${c.name}` : c.name)}</option>
    `).join("");

    if (this.currentFilterCourseId && courses.find(c => c.id === this.currentFilterCourseId)) {
      select.value = this.currentFilterCourseId;
    }

    select.onchange = () => {
      this.currentFilterCourseId = select.value ? parseInt(select.value) : null;
      this.filterByCourse(this.currentFilterCourseId);
    };
  },

  filterByCourse(courseId) {
    this.currentFilterCourseId = courseId;
    const filtered = courseId
      ? AppState.coursework.filter(w => w.course_id === courseId)
      : AppState.coursework;
    this.renderClassroomStream(filtered);
  },

  renderClassroomStream(items) {
    const container = document.getElementById("classroom-stream-feed");
    if (!container) return;

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state-box">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">NO ASSIGNMENTS</div>
          <div class="empty-state-desc">No Google Classroom assignments were found for this selection. Connect your Google account with OAuth or click Sync Classroom to fetch active coursework.</div>
          <div style="display: flex; gap: 8px; margin-top: 8px;">
            <button class="btn btn-secondary btn-sm" onclick="ClassroomModule.syncClassroom()">Sync Classroom</button>
            <button class="btn btn-primary btn-sm" onclick="openModal('integrations-modal')">Google OAuth Setup</button>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(a => {
      const isSubmitted = a.status === "SUBMITTED";
      return `
        <div class="coursework-card" onclick="openAssignmentInAddon(${a.id})">
          <div class="cw-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <h4 style="font-size: 15px; font-weight: 700; color: #fff;">${escapeHtml(a.title)}</h4>
              <span class="status-pill status-${a.status.toLowerCase()}">${a.status.replace(/_/g, " ")}</span>
            </div>
            <p style="color: var(--text-secondary); font-size: 13px; margin: 6px 0 10px; line-height: 1.4;">${escapeHtml(a.description || "Open to extract specifications, synthesize code, and validate compiler tests.")}</p>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-muted); flex-wrap: wrap; gap: 6px;">
              <div>
                <span>Due: <b style="color: #cbd5e1;">${a.due_date || "Upcoming"} ${a.due_time || ""}</b></span>
                ${a.max_points ? `<span style="margin-left: 10px;">• ${a.max_points} Points</span>` : ''}
              </div>
              <span style="color: #60a5fa; font-weight: 600;">Open in Compiler Studio &rarr;</span>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const syncBtn = document.getElementById("sync-classroom-btn");
  if (syncBtn) syncBtn.addEventListener("click", () => ClassroomModule.syncClassroom());
});
