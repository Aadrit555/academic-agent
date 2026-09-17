// Timetable & Next Class Context Module
const TimetableModule = {
  daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],

  async loadTimetable() {
    try {
      const [allEntries, todayEntries, nextClass] = await Promise.all([
        api("/timetable"),
        api("/timetable/today"),
        api("/timetable/next")
      ]);

      this.renderNextClassCard(nextClass);
      this.renderWeekly(allEntries);
    } catch (e) {
      console.error("Error loading timetable:", e);
    }
  },

  renderNextClassCard(next) {
    const container = document.getElementById("timetable-next-class-box");
    if (!container) return;

    if (!next || !next.has_class) {
      container.innerHTML = `
        <div style="padding: 16px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 13px; color: var(--text-secondary);">
          No upcoming classes scheduled for the current session.
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="padding: 14px 16px; background: rgba(37, 99, 235, 0.08); border: 1px solid rgba(37, 99, 235, 0.3); border-radius: var(--radius-sm);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span class="status-pill ${next.is_ongoing ? 'status-ready' : 'status-scheduled'}">
            ${next.is_ongoing ? 'IN SESSION NOW' : 'NEXT CLASS UPCOMING'}
          </span>
          <span style="font-family: monospace; font-size: 13px; font-weight: 700; color: #60a5fa;">
            ${next.start_time} - ${next.end_time}
          </span>
        </div>
        <h3 style="font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 4px;">${escapeHtml(next.subject)}</h3>
        <div style="font-size: 13px; color: #cbd5e1;">
          Scheduled Room: <b style="color: #fff; background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 3px;">${escapeHtml(next.classroom)}</b>
          ${next.faculty ? `<span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">• ${escapeHtml(next.faculty)}</span>` : ''}
        </div>
      </div>
    `;
  },

  renderWeekly(entries) {
    const container = document.getElementById("weekly-timetable-matrix");
    if (!container) return;

    const grouped = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    entries.forEach(e => {
      if (grouped[e.day_of_week]) grouped[e.day_of_week].push(e);
    });

    const currentDay = new Date().getDay();
    const adjustedToday = (currentDay === 0) ? 6 : currentDay - 1;

    container.innerHTML = this.daysOfWeek.slice(0, 5).map((dayName, idx) => {
      const dayEntries = grouped[idx] || [];
      const isToday = idx === adjustedToday;

      return `
        <div class="timetable-day-column ${isToday ? 'today-column' : ''}">
          <div class="day-header">
            <span>${dayName}</span>
            ${isToday ? '<span class="today-tag">TODAY</span>' : ''}
          </div>
          <div class="day-slots">
            ${dayEntries.length ? dayEntries.map(de => `
              <div class="slot-card">
                <div class="slot-subject">${escapeHtml(de.subject)}</div>
                <div class="slot-meta">
                  <span>${de.start_time} - ${de.end_time}</span>
                  <span class="slot-room" title="${escapeHtml(de.faculty || '')}">${escapeHtml(de.classroom)}</span>
                </div>
                ${de.faculty ? `<div style="font-size: 10px; color: var(--text-muted); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(de.faculty)}</div>` : ''}
              </div>
            `).join("") : '<div class="no-slots">No classes</div>'}
          </div>
        </div>
      `;
    }).join("");
  },

  async handleImportSubmission() {
    const textarea = document.getElementById("timetable-json-input");
    if (!textarea || !textarea.value.trim()) {
      Toast.warning("Please enter valid timetable JSON entries.");
      return;
    }

    try {
      const parsed = JSON.parse(textarea.value.trim());
      const res = await api("/timetable/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed)
      });
      Toast.success(res.message);
      closeModal("import-timetable-modal");
      this.loadTimetable();
      loadHomeSummary();
    } catch (e) {
      Toast.error(`Invalid JSON or Import Error: ${e.message}`);
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const openImportBtn = document.getElementById("open-import-timetable-btn");
  if (openImportBtn) {
    openImportBtn.addEventListener("click", () => {
      const ta = document.getElementById("timetable-json-input");
      if (ta && !ta.value.trim()) {
        ta.placeholder = `[\n  {\n    "subject": "Course Name",\n    "day_of_week": 0,\n    "start_time": "09:00",\n    "end_time": "09:50",\n    "classroom": "Room Number",\n    "faculty": "Faculty Name"\n  }\n]`;
      }
      openModal("import-timetable-modal");
    });
  }

  const submitImportBtn = document.getElementById("submit-import-timetable-btn");
  if (submitImportBtn) submitImportBtn.addEventListener("click", () => TimetableModule.handleImportSubmission());
});
