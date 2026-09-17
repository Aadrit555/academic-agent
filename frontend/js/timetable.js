// Timetable Module
const TimetableModule = {
  daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],

  async loadTimetable() {
    try {
      const [allEntries, todayEntries] = await Promise.all([
        api("/timetable"),
        api("/timetable/today")
      ]);

      this.renderToday(todayEntries);
      this.renderWeekly(allEntries);
    } catch (e) {
      console.error("Error loading timetable:", e);
    }
  },

  renderToday(entries) {
    const container = document.getElementById("today-timetable-list");
    if (!container) return;

    if (!entries || entries.length === 0) {
      container.innerHTML = `<div style="color: var(--text-secondary); font-size: 13px;">No classes scheduled for today.</div>`;
      return;
    }

    const now = new Date();
    const currentHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    container.innerHTML = entries.map(e => {
      const isOngoing = e.start_time <= currentHM && currentHM <= e.end_time;
      const isUpcoming = e.start_time > currentHM;
      const bg = isOngoing ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.03)";
      const border = isOngoing ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid var(--border)";

      return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: ${bg}; border: ${border}; border-radius: var(--radius-sm);">
          <div style="display: flex; align-items: center; gap: 14px;">
            <b style="font-family: monospace; color: #60a5fa; font-size: 14px;">${e.start_time} – ${e.end_time}</b>
            <span style="color: #fff; font-weight: 600;">${escapeHtml(e.subject)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="status-pill status-ready">Room ${escapeHtml(e.classroom)}</span>
            ${isOngoing ? '<span class="status-pill status-ready" style="animation: pulse 1.5s infinite;">IN SESSION</span>' : ''}
          </div>
        </div>
      `;
    }).join("");
  },

  renderWeekly(entries) {
    const container = document.getElementById("weekly-timetable-container");
    if (!container) return;

    // Group by day of week (0..6)
    const grouped = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    entries.forEach(e => {
      if (grouped[e.day_of_week]) grouped[e.day_of_week].push(e);
    });

    container.innerHTML = this.daysOfWeek.map((dayName, idx) => {
      const dayEntries = grouped[idx] || [];
      const currentDay = new Date().getDay();
      // adjust JS getDay (0=Sun) to match 0=Mon
      const adjustedToday = (currentDay === 0) ? 6 : currentDay - 1;
      const isToday = idx === adjustedToday;

      return `
        <div class="validation-box" style="margin-top: 0; border-color: ${isToday ? '#3b82f6' : 'var(--border)'};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h4 style="color: ${isToday ? '#60a5fa' : '#fff'}; font-size: 14px;">${dayName}</h4>
            ${isToday ? '<span class="brand-badge">TODAY</span>' : ''}
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${dayEntries.length ? dayEntries.map(de => `
              <div style="padding: 6px 8px; background: rgba(255, 255, 255, 0.02); border-radius: 4px; font-size: 12px;">
                <div style="font-weight: 600; color: #e2e8f0;">${escapeHtml(de.subject)}</div>
                <div style="color: var(--text-secondary); display: flex; justify-content: space-between;">
                  <span>${de.start_time} - ${de.end_time}</span>
                  <span>${escapeHtml(de.classroom)}</span>
                </div>
              </div>
            `).join("") : '<div style="font-size: 12px; color: var(--text-muted);">No classes</div>'}
          </div>
        </div>
      `;
    }).join("");
  },

  async promptImport() {
    const raw = prompt(
      "Import Timetable:\nPaste JSON array of entries (subject, day_of_week [0-6], start_time, end_time, classroom) or leave empty for sample template:",
      JSON.stringify([
        { "subject": "Data Structures", "day_of_week": 0, "start_time": "10:00", "end_time": "11:00", "classroom": "AB-204" },
        { "subject": "Discrete Mathematics", "day_of_week": 0, "start_time": "12:00", "end_time": "13:00", "classroom": "AB-302" },
        { "subject": "Algorithms Lab", "day_of_week": 0, "start_time": "14:00", "end_time": "16:00", "classroom": "LAB-7" }
      ], null, 2)
    );

    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const res = await api("/timetable/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed)
      });
      alert(`✓ ${res.message}`);
      this.loadTimetable();
      loadHomeSummary();
    } catch (e) {
      alert(`Invalid JSON format: ${e.message}`);
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("import-timetable-btn");
  if (btn) btn.addEventListener("click", () => TimetableModule.promptImport());
});
