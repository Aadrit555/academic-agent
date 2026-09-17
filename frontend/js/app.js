// ==========================================================================
// ACADEMIC AGENT - Autonomous Academic Operating System for SRM AP
// Core Application Controller & State Manager
// ==========================================================================

const AppState = {
  activeView: "home", // home, erp, next-class, classroom, assignments, study, attendance
  courses: [],
  coursework: [],
  selectedCourseworkId: null,
  activeCourseId: null,
  currentUser: null,
  erpStatus: null,
  googleStatus: null
};

// Modern, Non-intrusive Toast Notification System
const Toast = {
  container: null,
  init() {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "toast-container";
      document.body.appendChild(this.container);
    }
  },
  show(message, type = "info", duration = 4000) {
    this.init();
    const item = document.createElement("div");
    item.className = `toast-item toast-${type}`;
    item.innerHTML = `
      <span class="toast-dot toast-dot-${type}"></span>
      <div class="toast-message">${escapeHtml(message)}</div>
      <button class="toast-close" title="Dismiss">&times;</button>
    `;
    item.querySelector(".toast-close").onclick = () => item.remove();
    this.container.appendChild(item);
    setTimeout(() => {
      item.classList.add("fade-out");
      setTimeout(() => item.remove(), 250);
    }, duration);
  },
  success(msg) { this.show(msg, "success"); },
  error(msg) { this.show(msg, "error", 5500); },
  info(msg) { this.show(msg, "info"); },
  warning(msg) { this.show(msg, "warning"); }
};

// API Fetch Helper with JWT Token Injection and Auto 401 Recovery
async function api(path, options = {}) {
  let token = localStorage.getItem("academic_agent_jwt");
  const headers = Object.assign({}, options.headers || {});
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  let response = await fetch(`/api${path}`, {
    ...options,
    headers: headers
  });

  // If 401 occurs because of an expired token, purge and retry once
  if (response.status === 401 && token) {
    localStorage.removeItem("academic_agent_jwt");
    delete headers["Authorization"];
    response = await fetch(`/api${path}`, {
      ...options,
      headers: headers
    });
  }

  if (!response.ok) {
    let errorDetail = "Network error occurred";
    try {
      const errJson = await response.json();
      errorDetail = errJson.detail || errJson.error || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text() || response.statusText;
    }
    throw new Error(errorDetail);
  }

  // Handle binary blob responses
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/octet-stream")) {
    return response.blob();
  }
  return response.json();
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Primary Navigation Router
function navigateToAddonTab(tabId) {
  AppState.activeView = tabId;

  // Update navigation items
  document.querySelectorAll(".addon-nav-tab").forEach(tab => {
    tab.classList.toggle("active", tab.getAttribute("data-tab") === tabId);
  });

  // Switch view containers
  document.querySelectorAll(".addon-view-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `addon-view-${tabId}`);
  });

  // Load view-specific dynamic data
  if (tabId === "home") {
    loadHomeSummary();
  } else if (tabId === "erp") {
    if (typeof IntegrationsModule !== "undefined") IntegrationsModule.loadStatus();
    if (typeof CameraScannerModule !== "undefined" && typeof CameraScannerModule.loadERPAttendance === "function") {
      CameraScannerModule.loadERPAttendance();
    }
  } else if (tabId === "next-class") {
    if (typeof TimetableModule !== "undefined") TimetableModule.loadTimetable();
  } else if (tabId === "classroom") {
    if (typeof ClassroomModule !== "undefined") ClassroomModule.loadClassroom();
  } else if (tabId === "assignments") {
    if (typeof GeneratorModule !== "undefined") GeneratorModule.loadGenerator();
  } else if (tabId === "study") {
    if (typeof StudyBrainModule !== "undefined") StudyBrainModule.loadStudyBrain();
  } else if (tabId === "attendance") {
    if (typeof CameraScannerModule !== "undefined") {
      CameraScannerModule.loadRecentAttendance();
      if (typeof CameraScannerModule.loadERPAttendance === "function") {
        CameraScannerModule.loadERPAttendance();
      }
    }
  }
}

// Load Home Overview Context
async function loadHomeSummary() {
  try {
    const data = await api("/home");

    // Live Next Class Card
    const nextSubject = document.getElementById("home-next-subject");
    const nextRoom = document.getElementById("home-next-room");
    const nextTime = document.getElementById("home-next-time");
    const nextFaculty = document.getElementById("home-next-faculty");
    const classBadge = document.getElementById("home-class-status-badge");

    if (data.next_class && data.next_class.has_class) {
      if (nextSubject) nextSubject.textContent = data.next_class.subject;
      if (nextRoom) nextRoom.textContent = data.next_class.classroom || "TBD";
      if (nextTime) nextTime.textContent = `${data.next_class.start_time} - ${data.next_class.end_time}`;
      if (nextFaculty) nextFaculty.textContent = data.next_class.faculty ? `Faculty: ${data.next_class.faculty}` : "";

      if (classBadge) {
        if (data.next_class.is_ongoing) {
          classBadge.textContent = "IN SESSION NOW";
          classBadge.className = "status-pill status-ready";
        } else if (data.next_class.is_approaching) {
          classBadge.textContent = `STARTS IN ${data.next_class.time_remaining_minutes || 15}M`;
          classBadge.className = "status-pill status-scheduled";
        } else {
          classBadge.textContent = data.next_class.day_name ? `${data.next_class.day_name.toUpperCase()} CLASS` : "NEXT CLASS";
          classBadge.className = "status-pill status-scheduled";
        }
      }
    } else {
      if (nextSubject) nextSubject.textContent = "No Upcoming Classes Scheduled";
      if (nextRoom) nextRoom.textContent = "--";
      if (nextTime) nextTime.textContent = "All classes completed";
      if (nextFaculty) nextFaculty.textContent = "";
      if (classBadge) {
        classBadge.textContent = "STANDBY";
        classBadge.className = "status-pill status-not_started";
      }
    }

    // Urgent assignment context
    const urgentBox = document.getElementById("home-urgent-assignment-card");
    if (urgentBox) {
      if (data.assignments && data.assignments.length > 0) {
        const first = data.assignments[0];
        urgentBox.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
            <b style="color: #fff; font-size: 14px;">${escapeHtml(first.title)}</b>
            <span class="status-pill status-${first.status.toLowerCase()}">${first.status}</span>
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">
            ${escapeHtml(first.course_name || "Academic Course")} · Due: <b>${first.due_date || "Upcoming"} ${first.due_time || ""}</b>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary btn-sm" onclick="openAssignmentInAddon(${first.id})">
              Open in Compiler Studio &rarr;
            </button>
            <button class="btn btn-secondary btn-sm" onclick="navigateToAddonTab('classroom')">
              View All Assignments
            </button>
          </div>
        `;
      } else {
        urgentBox.innerHTML = `
          <div class="empty-state-box" style="padding: 20px;">
            <div class="empty-state-title">NO ASSIGNMENTS FOUND</div>
            <div class="empty-state-desc">No Google Classroom coursework pending at this time. Connect or sync Classroom to refresh.</div>
            <button class="btn btn-secondary btn-sm" style="margin-top: 8px;" onclick="ClassroomModule.syncClassroom()">Sync Classroom</button>
          </div>
        `;
      }
    }

    // Metric counters
    const readyEl = document.getElementById("home-ready-count");
    const schedEl = document.getElementById("home-scheduled-count");
    const docsEl = document.getElementById("home-docs-count");
    if (readyEl) readyEl.textContent = data.stats.ready_assignments || "0";
    if (schedEl) schedEl.textContent = data.stats.scheduled_submissions || "0";
    if (docsEl) docsEl.textContent = data.stats.materials_count || "0";

    // Update ERP sub metric
    const erpMetric = document.getElementById("home-erp-metric");
    const erpSub = document.getElementById("home-erp-sub");
    if (AppState.erpStatus && AppState.erpStatus.is_connected) {
      if (erpMetric) erpMetric.textContent = AppState.erpStatus.student_id || "Connected";
      if (erpSub) erpSub.textContent = `${AppState.erpStatus.student_name || 'SRM AP'} · Live Synced`;
    }
  } catch (e) {
    console.error("Home summary error:", e);
  }
}

// Helper to switch to assignments tab with target assignment selected
function openAssignmentInAddon(courseworkId) {
  navigateToAddonTab("assignments");
  if (typeof GeneratorModule !== "undefined") {
    GeneratorModule.selectAssignment(courseworkId);
  }
}

// Authentication & Integration Status Verifier
async function checkAuthStatus() {
  const erpBadge = document.getElementById("classroom-auth-status");
  const erpText = document.getElementById("google-user-email");
  const googleBadge = document.getElementById("header-google-status");
  const googleText = document.getElementById("google-status-text");

  try {
    const [authStatus, erpStatus] = await Promise.all([
      api("/auth/status").catch(() => ({ connected: false })),
      api("/erp/status").catch(() => ({ is_connected: false }))
    ]);
    AppState.currentUser = authStatus;
    AppState.erpStatus = erpStatus;

    // 1. Update SRM AP ERP Status
    if (erpStatus && erpStatus.is_connected) {
      if (erpBadge) {
        erpBadge.className = "auth-chip connected";
        erpBadge.title = "SRM AP eVarsity Connected (Click to manage)";
      }
      if (erpText) {
        erpText.textContent = `● ERP: ${erpStatus.student_name || 'SRM Student'} (${erpStatus.student_id || ''})`;
      }
    } else {
      if (erpBadge) {
        erpBadge.className = "auth-chip disconnected";
        erpBadge.title = "SRM AP eVarsity Not Connected (Click to log in)";
      }
      if (erpText) {
        erpText.textContent = "Connect SRM AP ERP";
      }
    }

    // 2. Update Google Classroom Status
    if (authStatus && authStatus.connected && !authStatus.is_demo_mode) {
      if (googleBadge) {
        googleBadge.className = "auth-chip connected";
        googleBadge.title = "Google Classroom Connected";
      }
      if (googleText) {
        googleText.textContent = `● Google: ${authStatus.email || 'Connected'}`;
      }
    } else {
      if (googleBadge) {
        googleBadge.className = "auth-chip disconnected";
        googleBadge.title = "Google Classroom Not Connected (Click to configure OAuth)";
      }
      if (googleText) {
        googleText.textContent = "Connect Google";
      }
    }

  } catch (e) {
    console.warn("checkAuthStatus error:", e);
  }
}

// Command Palette Controller (Ctrl+K)
const CommandPalette = {
  isOpen: false,
  commands: [
    { name: "Overview / Dashboard", action: () => navigateToAddonTab("home") },
    { name: "SRM AP ERP (Attendance & Safe Bunks)", action: () => navigateToAddonTab("erp") },
    { name: "Weekly Timetable Schedule", action: () => navigateToAddonTab("next-class") },
    { name: "Google Classroom Coursework", action: () => navigateToAddonTab("classroom") },
    { name: "Compiler Studio & Code Generator", action: () => navigateToAddonTab("assignments") },
    { name: "Study Brain RAG (Course Documents)", action: () => navigateToAddonTab("study") },
    { name: "Lens Attendance Camera Scanner", action: () => navigateToAddonTab("attendance") },
    { name: "Sync Google Classroom API", action: () => ClassroomModule.syncClassroom() },
    { name: "Integrations Hub (ERP & Google)", action: () => openModal("integrations-modal") },
    { name: "Student Account Profile", action: () => openModal("auth-modal") }
  ],

  init() {
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        this.toggle();
      } else if (e.key === "Escape" && this.isOpen) {
        this.close();
      }
    });

    const input = document.getElementById("palette-search-input");
    if (input) {
      input.addEventListener("input", (e) => this.filter(e.target.value));
    }
  },

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  },

  open() {
    this.isOpen = true;
    const modal = document.getElementById("command-palette-modal");
    const input = document.getElementById("palette-search-input");
    if (modal) modal.style.display = "flex";
    if (input) {
      input.value = "";
      input.focus();
    }
    this.filter("");
  },

  close() {
    this.isOpen = false;
    const modal = document.getElementById("command-palette-modal");
    if (modal) modal.style.display = "none";
  },

  filter(query) {
    const list = document.getElementById("palette-results-list");
    if (!list) return;

    const q = query.toLowerCase().trim();
    const matched = this.commands.filter(c => c.name.toLowerCase().includes(q));

    list.innerHTML = matched.map((c, idx) => `
      <div class="palette-item ${idx === 0 ? 'selected' : ''}" onclick="CommandPalette.execute(${idx})">
        <span>${escapeHtml(c.name)}</span>
        <span class="palette-kbd">Jump</span>
      </div>
    `).join("");
  },

  execute(index) {
    const input = document.getElementById("palette-search-input");
    const q = input ? input.value.toLowerCase().trim() : "";
    const matched = this.commands.filter(c => c.name.toLowerCase().includes(q));
    if (matched[index]) {
      this.close();
      matched[index].action();
    }
  }
};

// Modal helpers
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "flex";
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

// App Initialization
document.addEventListener("DOMContentLoaded", async () => {
  // Check if viewing in iframe or at /addon path
  if (window.location.pathname === "/addon" || window.self !== window.top) {
    document.body.classList.add("is-addon-view");
  }

  CommandPalette.init();

  // Tab switching
  document.querySelectorAll(".addon-nav-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-tab");
      navigateToAddonTab(tabId);
    });
  });

  // Header buttons
  const palBtn = document.getElementById("open-command-palette-btn");
  if (palBtn) palBtn.addEventListener("click", () => CommandPalette.open());

  const integBtn = document.getElementById("open-integrations-btn");
  if (integBtn) integBtn.addEventListener("click", () => openModal("integrations-modal"));

  const accountBtn = document.getElementById("account-modal-btn");
  if (accountBtn) accountBtn.addEventListener("click", () => openModal("auth-modal"));

  // Account login & register handlers
  const loginBtn = document.getElementById("btn-login-submit");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      const email = document.getElementById("auth-email-input").value.trim();
      const password = document.getElementById("auth-password-input").value.trim();
      if (!email || !password) {
        Toast.warning("Please enter email and password.");
        return;
      }
      try {
        const res = await api("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        if (res.access_token) {
          localStorage.setItem("academic_agent_jwt", res.access_token);
        }
        Toast.success("Signed in successfully!");
        closeModal("auth-modal");
        await checkAuthStatus();
        await loadHomeSummary();
      } catch (e) {
        Toast.error(`Login Failed: ${e.message}`);
      }
    });
  }

  const regBtn = document.getElementById("btn-register-submit");
  if (regBtn) {
    regBtn.addEventListener("click", async () => {
      const email = document.getElementById("auth-email-input").value.trim();
      const password = document.getElementById("auth-password-input").value.trim();
      if (!email || !password) {
        Toast.warning("Please enter email and password.");
        return;
      }
      try {
        const res = await api("/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        if (res.access_token) {
          localStorage.setItem("academic_agent_jwt", res.access_token);
        }
        Toast.success("Registered and signed in successfully!");
        closeModal("auth-modal");
        await checkAuthStatus();
        await loadHomeSummary();
      } catch (e) {
        Toast.error(`Registration Failed: ${e.message}`);
      }
    });
  }

  // Load initial data
  await checkAuthStatus();
  await loadHomeSummary();
  if (typeof TimetableModule !== "undefined") TimetableModule.loadTimetable();
  if (typeof ClassroomModule !== "undefined") ClassroomModule.loadClassroom();
});
