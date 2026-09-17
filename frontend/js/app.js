// Academic Agent — Core App State and Router
const AppState = {
  currentView: "home",
  auth: { connected: false, email: null, is_demo_mode: false },
  courses: [],
  coursework: [],
  activeCourseId: null,
  activeCourseworkId: null,
};

// Global API helper
async function api(path, options = {}) {
  const url = path.startsWith("http") ? path : `/api${path}`;
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(errorData.detail || `Request failed with HTTP ${resp.status}`);
  }
  return resp.json();
}

// Modal helper functions
function openModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.add("active");
}

function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.remove("active");
}

// Router & View Switching
function navigateTo(viewName) {
  AppState.currentView = viewName;

  // Update Nav links
  document.querySelectorAll(".nav-item").forEach(item => {
    if (item.getAttribute("data-view") === viewName) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // Switch containers
  document.querySelectorAll(".page-container").forEach(c => {
    c.classList.remove("active");
  });

  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.add("active");
  }

  // Update Title
  const titles = {
    home: "Agent Hub",
    timetable: "Timetable & Next Class Context",
    classroom: "Google Classroom Integration",
    "study-brain": "AI Study Brain & Course Materials",
    generator: "Validation & Assignment Generator",
    schedules: "Auto-Submission Schedules Monitor"
  };
  const titleEl = document.getElementById("current-view-title");
  if (titleEl) titleEl.textContent = titles[viewName] || "Academic Agent";

  // Trigger view-specific data refresh
  if (viewName === "home") loadHomeSummary();
  if (viewName === "timetable") TimetableModule.loadTimetable();
  if (viewName === "classroom") ClassroomModule.loadClassroom();
  if (viewName === "study-brain") StudyBrainModule.loadStudyBrain();
  if (viewName === "generator") GeneratorModule.loadGenerator();
  if (viewName === "schedules") SchedulerModule.loadSchedules();
}

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  // Setup navigation
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
      const view = item.getAttribute("data-view");
      if (view) navigateTo(view);
    });
  });

  // Connect Google button
  document.getElementById("connect-classroom-btn").addEventListener("click", async () => {
    try {
      const res = await api("/auth/google/url");
      window.location.href = res.url;
    } catch (e) {
      alert(`OAuth Error: ${e.message}`);
    }
  });

  // Instant Demo button
  document.getElementById("demo-mode-toggle-btn").addEventListener("click", async () => {
    try {
      await api("/auth/connect-demo", { method: "POST" });
      await checkAuthStatus();
      await loadHomeSummary();
      alert("✓ Demo Google Classroom connected! Sample courses and coursework have been synced.");
    } catch (e) {
      alert(`Error connecting demo: ${e.message}`);
    }
  });

  // Fast Attendance button on Home
  document.getElementById("mark-attendance-btn").addEventListener("click", async () => {
    const code = document.getElementById("quick-attendance-code").value.trim();
    if (!code) {
      alert("Please enter an attendance code (e.g. A235646).");
      return;
    }
    try {
      const res = await api("/attendance/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendance_code: code })
      });
      alert(`✓ ${res.message}`);
      document.getElementById("quick-attendance-code").value = "";
    } catch (e) {
      alert(`Attendance Error: ${e.message}`);
    }
  });

  // Refresh assignments button on Home
  document.getElementById("refresh-assignments-btn").addEventListener("click", async () => {
    try {
      await api("/classroom/sync", { method: "POST" });
      await loadHomeSummary();
    } catch (e) {
      alert(`Sync Error: ${e.message}`);
    }
  });

  // Start 12-Step Expo Demo button
  document.getElementById("start-expo-demo-btn").addEventListener("click", () => {
    ExpoDemoModule.startDemo();
  });

  // Initial loads
  checkAuthStatus();
  loadHomeSummary();
});

// Check Auth Status
async function checkAuthStatus() {
  try {
    const status = await api("/auth/status");
    AppState.auth = status;
    const badge = document.getElementById("auth-status-badge");
    const text = document.getElementById("auth-status-text");

    if (status.connected) {
      badge.className = "auth-badge";
      text.textContent = status.is_demo_mode 
        ? "Classroom: Connected (Demo Mode)" 
        : `Classroom: Connected (${status.email})`;
      document.getElementById("connect-classroom-btn").textContent = "Disconnect";
      document.getElementById("connect-classroom-btn").onclick = async () => {
        await api("/auth/disconnect", { method: "POST" });
        await checkAuthStatus();
        await loadHomeSummary();
      };
    } else {
      badge.className = "auth-badge disconnected";
      text.textContent = "Google Classroom: Disconnected";
      document.getElementById("connect-classroom-btn").textContent = "Connect Google";
    }
  } catch (e) {
    console.warn("Auth check failed:", e);
  }
}

// Load Home Dashboard Summary
async function loadHomeSummary() {
  try {
    const data = await api("/home");

    // 1. Next Class Widget
    const nc = data.next_class;
    const heroCard = document.getElementById("hero-next-class");
    if (nc.has_class) {
      document.getElementById("hero-subject-name").textContent = nc.subject;
      document.getElementById("hero-class-time").textContent = `${nc.start_time} – ${nc.end_time}`;
      document.getElementById("hero-class-room").textContent = `${nc.classroom} (Academic Block)`;
      document.getElementById("hero-room-badge").textContent = `ROOM ${nc.classroom}`;

      const tagBadge = document.getElementById("hero-class-status-badge");
      const ctxText = document.getElementById("hero-time-context");

      if (nc.is_ongoing) {
        tagBadge.textContent = "CURRENT CLASS (IN SESSION)";
        tagBadge.className = "hero-tag-badge";
        tagBadge.style.background = "rgba(16, 185, 129, 0.3)";
        tagBadge.style.color = "#34d399";
        ctxText.textContent = `${nc.time_remaining_minutes} min remaining`;
      } else if (nc.is_approaching) {
        tagBadge.textContent = "APPROACHING CLASS";
        tagBadge.className = "hero-tag-badge";
        tagBadge.style.background = "rgba(245, 158, 11, 0.3)";
        tagBadge.style.color = "#fbbf24";
        ctxText.textContent = `Starts in ${nc.time_remaining_minutes} min!`;
      } else {
        tagBadge.textContent = "NEXT CLASS";
        ctxText.textContent = "Upcoming today";
      }
    } else {
      document.getElementById("hero-subject-name").textContent = "No Scheduled Classes Today";
      document.getElementById("hero-class-time").textContent = "Free Period / Study Time";
      document.getElementById("hero-class-room").textContent = "Campus";
      document.getElementById("hero-room-badge").textContent = "REST DAY";
    }

    // 2. Stats
    document.getElementById("stat-materials").textContent = data.stats.materials_count || 0;
    document.getElementById("stat-ready").textContent = data.stats.ready_assignments || 0;
    document.getElementById("stat-scheduled").textContent = data.stats.scheduled_submissions || 0;
    document.getElementById("stat-courses").textContent = data.stats.total_courses || 0;

    // 3. Assignments Pipeline
    renderHomeAssignments(data.assignments);
  } catch (e) {
    console.error("Failed to load home summary:", e);
  }
}

function renderHomeAssignments(assignments) {
  const container = document.getElementById("home-assignments-container");
  if (!container) return;

  if (!assignments || assignments.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 32px; text-align: center; background: var(--bg-card); border-radius: var(--radius-md); border: 1px dashed var(--border);">
        <p style="color: var(--text-secondary); margin-bottom: 12px;">No Google Classroom assignments found.</p>
        <button class="btn btn-primary" onclick="ClassroomModule.syncClassroom()">Sync Classroom</button>
      </div>
    `;
    return;
  }

  container.innerHTML = assignments.map(a => {
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
    const sClass = statusClasses[a.status] || "status-not_started";

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
        </div>

        <div class="assignment-actions">
          <button class="btn btn-secondary" style="font-size: 12px;" onclick="openGeneratorForAssignment(${a.id})">
            ⚡ Generate
          </button>
          <button class="btn btn-primary" style="font-size: 12px;" onclick="openScheduleModal(${a.id}, '${escapeHtml(a.title)}')">
            ⏰ Auto Submit
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
