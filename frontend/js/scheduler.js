// Auto-Submission Scheduler Module
const SchedulerModule = {
  async loadSchedules() {
    const container = document.getElementById("schedules-table-container");
    if (!container) return;

    try {
      const schedules = await api("/schedules");
      if (!schedules || schedules.length === 0) {
        container.innerHTML = `
          <div style="padding: 24px; text-align: center; color: var(--text-secondary); font-size: 13px;">
            No scheduled auto-submissions active. Click 'Schedule Auto-Submit' on any validated assignment.
          </div>
        `;
        return;
      }

      const statusClasses = {
        SCHEDULED: "status-scheduled",
        SUBMITTING: "status-submitting",
        SUBMITTED: "status-submitted",
        FAILED: "status-failed",
        CANCELLED: "status-not_started"
      };

      container.innerHTML = `
        <table class="schedules-table">
          <thead>
            <tr>
              <th>ASSIGNMENT</th>
              <th>COURSE</th>
              <th>DEADLINE</th>
              <th>OFFSET</th>
              <th>SCHEDULED TIME</th>
              <th>STATUS</th>
              <th style="text-align: right;">ACTION</th>
            </tr>
          </thead>
          <tbody>
            ${schedules.map(s => {
        const sClass = statusClasses[s.status] || "status-scheduled";
        const isSubmitted = s.status === "SUBMITTED";
        return `
                <tr>
                  <td style="font-weight: 600; color: #fff;">${escapeHtml(s.title)}</td>
                  <td style="color: #94a3b8;">${escapeHtml(s.course_name)}</td>
                  <td style="font-family: monospace;">${new Date(s.deadline).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>${s.offset_hours}h before</td>
                  <td style="font-family: monospace; color: #60a5fa;"><b>${new Date(s.scheduled_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b></td>
                  <td><span class="status-pill ${sClass}">${s.status}</span></td>
                  <td style="text-align: right;">
                    ${!isSubmitted ? `
                      <button class="btn btn-secondary btn-sm" onclick="SchedulerModule.submitNow(${s.coursework_id})">
                        Submit Now
                      </button>
                    ` : `
                      <span style="color: #34d399; font-weight: 600; font-size: 12px;">Verified</span>
                    `}
                  </td>
                </tr>
              `;
      }).join("")}
          </tbody>
        </table>
      `;
    } catch (e) {
      container.innerHTML = `<div style="color: #f87171; font-size: 12px;">Error loading schedules: ${e.message}</div>`;
    }
  },

  async submitNow(courseworkId) {
    try {
      const res = await api(`/assignment/${courseworkId}/submit-now`, { method: "POST" });
      Toast.success(`${res.message} (Submission State: ${res.state})`);
      await this.loadSchedules();
      loadHomeSummary();
      ClassroomModule.loadClassroom();
    } catch (e) {
      Toast.error(`Submission Error: ${e.message}`);
    }
  }
};

let activeSchedulingCourseworkId = null;

function openScheduleModal(courseworkId, title) {
  activeSchedulingCourseworkId = courseworkId;
  const titleEl = document.getElementById("schedule-modal-title");
  if (titleEl) titleEl.textContent = `Auto-Submit: ${title}`;
  openModal("schedule-modal");
}

document.addEventListener("DOMContentLoaded", () => {
  const confirmSchedBtn = document.getElementById("confirm-schedule-btn");
  if (confirmSchedBtn) {
    confirmSchedBtn.addEventListener("click", async () => {
      if (!activeSchedulingCourseworkId) return;
      const offsetInput = document.getElementById("schedule-offset-select");
      const offset = offsetInput ? parseFloat(offsetInput.value) : 4.0;

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
        Toast.success(`Auto-submit scheduled: Deliverable will be submitted ${offset} hours before the deadline.`);
        loadHomeSummary();
        ClassroomModule.loadClassroom();
        SchedulerModule.loadSchedules();
      } catch (e) {
        Toast.error(`Scheduling Error: ${e.message}`);
      }
    });
  }
});
