// Google Classroom Stream & Coursework Module
const ClassroomModule = {
  currentFilterCourseId: null,

  async loadClassroom() {
    try {
      const [courses, coursework] = await Promise.all([
        api("/classroom/courses"),
        api("/classroom/coursework")
      ]);

      AppState.courses = courses;
      AppState.coursework = coursework;

      this.renderCourseSelector(courses);
      this.renderClassroomStream(coursework);
      this.renderClassworkTab(coursework);
      this.renderUpcomingDeadlines(coursework);
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
      Toast.success(res.message);
      await this.loadClassroom();
      await loadHomeSummary();
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
    const headerTitle = document.getElementById("classroom-active-course-title");
    if (!select) return;

    if (!courses || courses.length === 0) {
      select.innerHTML = `<option value="">No enrolled courses</option>`;
      if (headerTitle) headerTitle.textContent = "Google Classroom";
      return;
    }

    select.innerHTML = courses.map(c => `
      <option value="${c.id}">${escapeHtml(c.code ? `${c.code} - ${c.name}` : c.name)}</option>
    `).join("");

    if (!this.currentFilterCourseId || !courses.find(c => c.id === this.currentFilterCourseId)) {
      this.currentFilterCourseId = courses[0].id;
    }
    select.value = this.currentFilterCourseId;

    const activeCourse = courses.find(c => c.id === this.currentFilterCourseId);
    this.updateCourseBanner(activeCourse);

    select.onchange = () => {
      this.currentFilterCourseId = parseInt(select.value);
      const chosen = courses.find(c => c.id === this.currentFilterCourseId);
      this.updateCourseBanner(chosen);
      this.filterByCourse(this.currentFilterCourseId);
    };
  },

  updateCourseBanner(course) {
    if (!course) return;
    const headerTitle = document.getElementById("classroom-active-course-title");
    const bannerTitle = document.getElementById("course-banner-title");
    const bannerSub = document.getElementById("course-banner-sub");
    const metaSemester = document.getElementById("course-meta-semester");
    const metaSection = document.getElementById("course-meta-section");
    const metaInst = document.getElementById("course-meta-inst");

    if (headerTitle) headerTitle.textContent = course.name;
    if (bannerTitle) bannerTitle.textContent = `${course.name} (${course.code})`;

    let info = course.instructor ? `Faculty: ${course.instructor}` : "Academic Course";
    if (bannerSub) bannerSub.textContent = info;

    const prof = (AppState.erpStatus && AppState.erpStatus.profile) || {};
    if (metaSemester) metaSemester.textContent = prof.semester || "III SEMESTER";
    if (metaSection) metaSection.textContent = prof.section ? `SECTION ${prof.section.replace(/'/g, '')}` : "SECTION K";
    if (metaInst) metaInst.textContent = "SRM UNIVERSITY AP";
  },

  filterByCourse(courseId) {
    this.currentFilterCourseId = courseId;
    const activeCourse = AppState.courses.find(c => c.id === courseId);
    if (activeCourse) this.updateCourseBanner(activeCourse);

    const filtered = courseId
      ? AppState.coursework.filter(w => w.course_id === courseId)
      : AppState.coursework;
    this.renderClassroomStream(filtered);
    this.renderClassworkTab(filtered);
    this.renderUpcomingDeadlines(filtered);
  },

  renderUpcomingDeadlines(items) {
    const container = document.getElementById("classroom-upcoming-deadlines-list");
    if (!container) return;

    if (!items || items.length === 0) {
      container.innerHTML = `<div style="font-size: 12px; color: var(--text-muted);">No upcoming deadlines.</div>`;
      return;
    }

    const sorted = [...items].sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
    container.innerHTML = sorted.slice(0, 3).map(a => `
      <div style="padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 12px;">
        <div style="color: #fff; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(a.title)}</div>
        <div style="color: var(--text-muted); font-size: 11px;">Due: ${a.due_date || "Tomorrow"}</div>
      </div>
    `).join("");
  },

  renderClassroomStream(items) {
    const container = document.getElementById("classroom-stream-feed");
    if (!container) return;

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div style="padding: 32px; text-align: center; border: 1px dashed var(--border); border-radius: var(--radius-sm); color: var(--text-secondary);">
          <p>No coursework published for this course yet.</p>
          <button class="btn btn-secondary btn-sm" style="margin-top: 10px;" onclick="ClassroomModule.syncClassroom()">Sync Classroom</button>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(a => {
      const isSubmitted = a.status === "SUBMITTED";
      return `
        <div class="stream-assignment-card" onclick="openAssignmentInAddon(${a.id})">
          <div class="stream-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <h4 style="font-size: 14px; font-weight: 600; color: #fff;">${escapeHtml(a.title)}</h4>
              <span class="status-pill status-${a.status.toLowerCase()}">${a.status.replace(/_/g, " ")}</span>
            </div>
            <p style="color: var(--text-secondary); font-size: 12px; margin: 4px 0 8px; line-height: 1.4;">${escapeHtml(a.description || "Open to inspect specification and generate deliverables.")}</p>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted);">
              <span>Due: <b style="color: #94a3b8;">${a.due_date || "Tomorrow"} ${a.due_time || ""}</b></span>
              <span style="color: #3b82f6; font-weight: 500;">Open in Academic Agent &rarr;</span>
            </div>
          </div>
        </div>
      `;
    }).join("");
  },

  renderClassworkTab(items) {
    const container = document.getElementById("classroom-classwork-tab-content");
    if (!container) return;
    this.renderClassroomStream(items);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const syncBtn = document.getElementById("sync-classroom-btn");
  if (syncBtn) syncBtn.addEventListener("click", () => ClassroomModule.syncClassroom());

  // Classroom Top Tabs Switching
  document.querySelectorAll(".gc-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".gc-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const tabName = tab.getAttribute("data-gc-tab");
      const streamFeed = document.getElementById("classroom-stream-feed");
      const sidebarBox = document.querySelector(".gc-sidebar-box");
      if (tabName === "stream") {
        if (sidebarBox) sidebarBox.style.display = "block";
        if (streamFeed) streamFeed.style.display = "flex";
      } else if (tabName === "classwork") {
        if (sidebarBox) sidebarBox.style.display = "none";
        if (streamFeed) streamFeed.style.display = "flex";
      } else {
        if (sidebarBox) sidebarBox.style.display = "none";
        if (streamFeed) {
          streamFeed.innerHTML = `
            <div style="padding: 32px; text-align: center; border: 1px dashed var(--border); border-radius: var(--radius-sm); color: var(--text-secondary);">
              <h3 style="color: #fff; font-size: 14px; margin-bottom: 6px;">${tab.textContent}</h3>
              <p style="font-size: 12px;">Synced from institutional Google Workspace domain.</p>
            </div>
          `;
        }
      }
    });
  });
});
