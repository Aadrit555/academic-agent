// Google Classroom Module
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

      this.renderCourseTabs(courses);
      this.renderCoursework(coursework);
    } catch (e) {
      console.error("Failed to load classroom:", e);
    }
  },

  async syncClassroom() {
    try {
      const res = await api("/classroom/sync", { method: "POST" });
      alert(`✓ ${res.message}`);
      await this.loadClassroom();
      await loadHomeSummary();
    } catch (e) {
      alert(`Classroom Sync Error: ${e.message}`);
    }
  },

  renderCourseTabs(courses) {
    const container = document.getElementById("classroom-courses-tabs");
    if (!container) return;

    let html = `
      <button class="btn ${this.currentFilterCourseId === null ? 'btn-primary' : 'btn-secondary'}" 
              onclick="ClassroomModule.filterByCourse(null)">
        All Courses (${AppState.coursework.length})
      </button>
    `;

    courses.forEach(c => {
      const isSelected = this.currentFilterCourseId === c.id;
      html += `
        <button class="btn ${isSelected ? 'btn-primary' : 'btn-secondary'}" 
                onclick="ClassroomModule.filterByCourse(${c.id})">
          ${escapeHtml(c.name)}
        </button>
      `;
    });

    container.innerHTML = html;
  },

  filterByCourse(courseId) {
    this.currentFilterCourseId = courseId;
    this.renderCourseTabs(AppState.courses);
    const filtered = courseId 
      ? AppState.coursework.filter(w => w.course_id === courseId)
      : AppState.coursework;
    this.renderCoursework(filtered);
  },

  renderCoursework(items) {
    const container = document.getElementById("classroom-coursework-container");
    if (!container) return;

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 48px; text-align: center; background: var(--bg-card); border-radius: var(--radius-md); border: 1px dashed var(--border);">
          <p style="color: var(--text-secondary); margin-bottom: 16px;">No coursework found for this filter.</p>
          <button class="btn btn-primary" onclick="ClassroomModule.syncClassroom()">Sync from Google Classroom</button>
        </div>
      `;
      return;
    }

    const statusClasses = {
      NOT_STARTED: "status-not_started",
      GENERATING: "status-generating",
      GENERATED: "status-generated",
      VALIDATING: "status-validating",
      READY: "status-ready",
      SCHEDULED: "status-scheduled",
      SUBMITTING: "status-submitting",
      SUBMITTED: "status-submitted",
      FAILED: "status-failed",
    };

    container.innerHTML = items.map(a => {
      const sClass = statusClasses[a.status] || "status-not_started";
      const isSubmitted = a.status === "SUBMITTED";
      const isReady = a.status === "READY";
      const isScheduled = a.status === "SCHEDULED";

      return `
        <div class="assignment-card">
          <div>
            <div class="assignment-top">
              <span class="assignment-course">${escapeHtml(a.course_name || "Academic Course")}</span>
              <span class="status-pill ${sClass}">${a.status.replace("_", " ")}</span>
            </div>
            <h3 class="assignment-title">${escapeHtml(a.title)}</h3>
            <p class="assignment-desc">${escapeHtml(a.description || "No description provided.")}</p>
            <div class="assignment-due" style="margin-bottom: 14px;">
              <span>📅 Due: <b>${a.due_date || "No deadline"} ${a.due_time ? "· " + a.due_time.substring(0, 5) : ""}</b></span>
            </div>

            ${a.schedule ? `
              <div style="background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.3); border-radius: 4px; padding: 8px 10px; font-size: 12px; color: #67e8f9; margin-bottom: 12px;">
                ⏰ Auto-Submit: <b>ON</b> (${a.schedule.offset_hours}h before deadline)
              </div>
            ` : ''}
          </div>

          <div class="assignment-actions">
            <button class="btn btn-secondary" style="font-size: 12px;" onclick="openGeneratorForAssignment(${a.id})">
              ⚡ Open Lab
            </button>
            ${!isSubmitted ? `
              <button class="btn btn-primary" style="font-size: 12px;" onclick="openScheduleModal(${a.id}, '${escapeHtml(a.title)}')">
                ${isScheduled ? 'Manage Schedule' : 'Schedule Submit'}
              </button>
            ` : `
              <span class="status-pill status-submitted" style="font-size: 12px;">✓ Verified in Classroom</span>
            `}
          </div>
        </div>
      `;
    }).join("");
  }
};

// Global openers
function openGeneratorForAssignment(courseworkId) {
  navigateTo("generator");
  GeneratorModule.selectAssignment(courseworkId);
}

let activeSchedulingCourseworkId = null;

function openScheduleModal(courseworkId, title) {
  activeSchedulingCourseworkId = courseworkId;
  document.getElementById("schedule-modal-title").textContent = `Auto-Submit: ${title}`;
  document.getElementById("schedule-assignment-desc").textContent = `Configure automatic Google Classroom turn-in before deadline.`;
  openModal("schedule-modal");
}

document.addEventListener("DOMContentLoaded", () => {
  const syncBtn = document.getElementById("sync-classroom-now-btn");
  if (syncBtn) syncBtn.addEventListener("click", () => ClassroomModule.syncClassroom());

  const confirmSchedBtn = document.getElementById("confirm-schedule-btn");
  if (confirmSchedBtn) {
    confirmSchedBtn.addEventListener("click", async () => {
      if (!activeSchedulingCourseworkId) return;
      const offset = parseFloat(document.getElementById("schedule-offset-select").value);
      try {
        const res = await api(`/assignment/${activeSchedulingCourseworkId}/schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coursework_id: activeSchedulingCourseworkId,
            offset_hours: offset,
            auto_submit_enabled: true
          })
        });
        closeModal("schedule-modal");
        alert(`✓ Auto-submit scheduled! Deliverable will be submitted ${offset} hours before the deadline.`);
        loadHomeSummary();
        ClassroomModule.loadClassroom();
        SchedulerModule.loadSchedules();
      } catch (e) {
        alert(`Scheduling Error: ${e.message}`);
      }
    });
  }
});
