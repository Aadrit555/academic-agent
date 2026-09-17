// Auto-Submission Scheduler Module
const SchedulerModule = {
  async loadSchedules() {
    const container = document.getElementById("schedules-table-container");
    if (!container) return;

    try {
      const schedules = await api("/schedules");
      if (!schedules || schedules.length === 0) {
        container.innerHTML = `
          <div style="padding: 32px; text-align: center; color: var(--text-secondary);">
            No scheduled auto-submissions yet. You can enable auto-submit on any validated assignment.
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
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border); color: var(--text-secondary);">
              <th style="padding: 10px 12px;">ASSIGNMENT</th>
              <th style="padding: 10px 12px;">COURSE</th>
              <th style="padding: 10px 12px;">DEADLINE</th>
              <th style="padding: 10px 12px;">OFFSET</th>
              <th style="padding: 10px 12px;">SCHEDULED SUBMIT TIME</th>
              <th style="padding: 10px 12px;">STATUS</th>
              <th style="padding: 10px 12px; text-align: right;">ACTION</th>
            </tr>
          </thead>
          <tbody>
            ${schedules.map(s => {
              const sClass = statusClasses[s.status] || "status-scheduled";
              const isSubmitted = s.status === "SUBMITTED";
              return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                  <td style="padding: 12px; font-weight: 600; color: #fff;">${escapeHtml(s.title)}</td>
                  <td style="padding: 12px; color: #818cf8;">${escapeHtml(s.course_name)}</td>
                  <td style="padding: 12px; font-family: monospace;">${new Date(s.deadline).toLocaleString()}</td>
                  <td style="padding: 12px;">${s.offset_hours} hrs before</td>
                  <td style="padding: 12px; font-family: monospace; color: #60a5fa;"><b>${new Date(s.scheduled_time).toLocaleString()}</b></td>
                  <td style="padding: 12px;"><span class="status-pill ${sClass}">${s.status}</span></td>
                  <td style="padding: 12px; text-align: right;">
                    ${!isSubmitted ? `
                      <button class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px;" onclick="SchedulerModule.submitNow(${s.coursework_id})">
                        Submit Now
                      </button>
                    ` : `
                      <span style="color: #34d399; font-weight: 600;">✓ Verified</span>
                    `}
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      `;
    } catch (e) {
      container.innerHTML = `<div style="color: #fb7185;">Error loading schedules: ${e.message}</div>`;
    }
  },

  async submitNow(courseworkId) {
    if (!confirm("Are you sure you want to trigger authorized Google Classroom submission immediately?")) {
      return;
    }

    try {
      const res = await api(`/assignment/${courseworkId}/submit-now`, { method: "POST" });
      alert(`✓ ${res.message} (Submission State: ${res.state})`);
      await this.loadSchedules();
      loadHomeSummary();
      ClassroomModule.loadClassroom();
    } catch (e) {
      alert(`Submission Error: ${e.message}`);
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const refBtn = document.getElementById("refresh-schedules-btn");
  if (refBtn) refBtn.addEventListener("click", () => SchedulerModule.loadSchedules());
});
