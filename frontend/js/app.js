// Academic Agent: Classroom-First Core Application
const AppState = {
  activeView: "home", // home, assignments, study, next-class, attendance
  courses: [],
  coursework: [],
  selectedCourseworkId: null,
  activeCourseId: null,
  currentUser: null,
  isAddonExpanded: false
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

  // If 401 occurs because of an expired or invalid token in local storage, purge it and retry
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

// 5-Tab Navigation Router for Academic Agent Add-on
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
  } else if (tabId === "assignments") {
    GeneratorModule.loadGenerator();
  } else if (tabId === "study") {
    StudyBrainModule.loadStudyBrain();
  } else if (tabId === "next-class") {
    TimetableModule.loadTimetable();
  } else if (tabId === "attendance") {
    CameraScannerModule.loadRecentAttendance();
    if (typeof CameraScannerModule.loadERPAttendance === "function") {
      CameraScannerModule.loadERPAttendance();
    }
  }
}

// Classroom Mode Toggle (Sidebar Companion vs Studio Expansion)
function toggleAddonExpansion() {
  AppState.isAddonExpanded = !AppState.isAddonExpanded;
  const layout = document.getElementById("classroom-workspace-layout");
  const btn = document.getElementById("toggle-addon-expansion-btn");
  if (layout) {
    layout.classList.toggle("expanded-studio", AppState.isAddonExpanded);
  }
  if (btn) {
    btn.textContent = AppState.isAddonExpanded ? "Companion View" : "Expand Studio";
  }
}

// Load Home Context in Add-on Panel
async function loadHomeSummary() {
  try {
    const data = await api("/home");

    // Next class card
    const nextSubject = document.getElementById("home-next-subject");
    const nextRoom = document.getElementById("home-next-room");
    const nextTime = document.getElementById("home-next-time");
    const classBadge = document.getElementById("home-class-status-badge");

    if (data.next_class && data.next_class.has_class) {
      if (nextSubject) nextSubject.textContent = data.next_class.subject;
      if (nextRoom) nextRoom.textContent = `Room ${data.next_class.classroom}`;
      if (nextTime) nextTime.textContent = `${data.next_class.start_time} - ${data.next_class.end_time}`;
      if (classBadge) {
        if (data.next_class.is_ongoing) {
          classBadge.textContent = "IN SESSION NOW";
          classBadge.className = "status-pill status-ready";
        } else {
          classBadge.textContent = "UPCOMING TODAY";
          classBadge.className = "status-pill status-scheduled";
        }
      }
    } else {
      if (nextSubject) nextSubject.textContent = "No Upcoming Classes";
      if (nextRoom) nextRoom.textContent = "Campus Day Concluded";
      if (nextTime) nextTime.textContent = "Tomorrow 09:00 AM";
    }

    // Urgent assignment context
    const urgentBox = document.getElementById("home-urgent-assignment-card");
    if (urgentBox && data.assignments && data.assignments.length > 0) {
      const first = data.assignments[0];
      urgentBox.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <b style="color: #fff; font-size: 13px;">${escapeHtml(first.title)}</b>
          <span class="status-pill status-${first.status.toLowerCase()}">${first.status}</span>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">
          ${escapeHtml(first.course_name)} · Due ${first.due_date || "Tomorrow"}
        </div>
        <button class="btn btn-primary btn-sm" style="width: 100%;" onclick="openAssignmentInAddon(${first.id})">
          Open in Compiler Lab
        </button>
      `;
    }

    // Fast status summary
    const readyEl = document.getElementById("home-ready-count");
    const schedEl = document.getElementById("home-scheduled-count");
    const docsEl = document.getElementById("home-docs-count");
    if (readyEl) readyEl.textContent = data.stats.ready_assignments || "0";
    if (schedEl) schedEl.textContent = data.stats.scheduled_submissions || "0";
    if (docsEl) docsEl.textContent = data.stats.materials_count || "0";
  } catch (e) {
    console.error("Home summary error:", e);
  }
}

// Bridge between Classroom Stream and Add-on
function openAssignmentInAddon(courseworkId) {
  navigateToAddonTab("assignments");
  GeneratorModule.selectAssignment(courseworkId);
}

// Real Student & Classroom Connection Status
async function checkAuthStatus() {
  const badge = document.getElementById("classroom-auth-status");
  const userText = document.getElementById("google-user-email");
  try {
    const [authStatus, erpStatus] = await Promise.all([
      api("/auth/status").catch(() => ({ connected: false })),
      api("/erp/status").catch(() => ({ is_connected: false }))
    ]);
    AppState.currentUser = authStatus;
    AppState.erpStatus = erpStatus;

    if (erpStatus && erpStatus.is_connected) {
      if (badge) {
        badge.className = "auth-chip connected";
        badge.style.borderColor = "rgba(52, 211, 153, 0.4)";
        badge.style.background = "rgba(16, 185, 129, 0.12)";
        badge.innerHTML = `<span class="chip-dot" style="background:#10b981;"></span><span style="font-weight:600; color:#34d399;">${escapeHtml(erpStatus.student_name || 'AADRIT')} · ${escapeHtml(erpStatus.student_id || '')} (Live ERP)</span>`;
      }
      if (userText) userText.textContent = `${erpStatus.student_name || 'AADRIT'} (${erpStatus.student_id || authStatus.email})`;
    } else if (authStatus && authStatus.connected) {
      if (badge) {
        badge.className = "auth-chip connected";
        badge.innerHTML = `<span class="chip-dot"></span><span>${authStatus.is_demo_mode ? 'Google Connected' : 'Google Live'}</span>`;
      }
      if (userText) userText.textContent = authStatus.email || "student@srmap.edu.in";
    } else {
      if (badge) {
        badge.className = "auth-chip disconnected";
        badge.innerHTML = `<span class="chip-dot"></span><span>Offline</span>`;
      }
      if (userText) userText.textContent = "Connect Account";
    }

    // Refresh course banner with real student section & semester
    if (typeof ClassroomModule !== "undefined" && AppState.courses && AppState.courses.length > 0) {
      const active = AppState.courses.find(c => c.id === ClassroomModule.currentFilterCourseId) || AppState.courses[0];
      if (active && typeof ClassroomModule.updateCourseBanner === "function") {
        ClassroomModule.updateCourseBanner(active);
      }
    }
  } catch (e) {
    console.warn("checkAuthStatus error:", e);
    if (badge) {
      badge.className = "auth-chip disconnected";
      badge.innerHTML = `<span class="chip-dot"></span><span>Disconnected</span>`;
    }
  }
}

// Command Palette (Ctrl+K)
const CommandPalette = {
  isOpen: false,
  commands: [
    { name: "Go to Home Context", action: () => navigateToAddonTab("home") },
    { name: "Open Compiler & Validation Lab", action: () => navigateToAddonTab("assignments") },
    { name: "Ask Course Study Brain", action: () => navigateToAddonTab("study") },
    { name: "View Timetable & Next Class", action: () => navigateToAddonTab("next-class") },
    { name: "Scan Classroom Attendance (Camera)", action: () => navigateToAddonTab("attendance") },
    { name: "Sync Google Classroom Data", action: () => ClassroomModule.syncClassroom() },
    { name: "Run 12-Step Test Tour", action: () => ExpoDemoModule.startDemo() },
    { name: "Toggle Studio Expansion View", action: () => toggleAddonExpansion() },
    { name: "Connect Real Google Classroom & ERP", action: () => openModal("integrations-modal") },
    { name: "Account Profile & Token Settings", action: () => openModal("auth-modal") }
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
        <span class="palette-kbd">Select</span>
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
  CommandPalette.init();

  // Tab switching inside Add-on
  document.querySelectorAll(".addon-nav-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-tab");
      navigateToAddonTab(tabId);
    });
  });

  // Toggle Add-on expansion
  const expBtn = document.getElementById("toggle-addon-expansion-btn");
  if (expBtn) expBtn.addEventListener("click", () => toggleAddonExpansion());

  // Command palette trigger buttons
  const palBtn = document.getElementById("open-command-palette-btn");
  if (palBtn) palBtn.addEventListener("click", () => CommandPalette.open());

  // Demo profile connection
  const demoBtn = document.getElementById("connect-demo-btn");
  if (demoBtn) {
    demoBtn.addEventListener("click", async () => {
      try {
        await api("/auth/connect-demo", { method: "POST" });
        Toast.success("Google Classroom demo account connected.");
        await checkAuthStatus();
        await ClassroomModule.loadClassroom();
        await loadHomeSummary();
      } catch (e) {
        Toast.error(`Connection Error: ${e.message}`);
      }
    });
  }

  // Account modal buttons
  const authModalBtn = document.getElementById("account-modal-btn");
  if (authModalBtn) authModalBtn.addEventListener("click", () => openModal("auth-modal"));

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
        localStorage.setItem("academic_agent_jwt", res.token);
        Toast.success("Signed in successfully!");
        closeModal("auth-modal");
        await checkAuthStatus();
        await ClassroomModule.loadClassroom();
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
        localStorage.setItem("academic_agent_jwt", res.token);
        Toast.success("Registered and signed in successfully!");
        closeModal("auth-modal");
        await checkAuthStatus();
        await ClassroomModule.loadClassroom();
        await loadHomeSummary();
      } catch (e) {
        Toast.error(`Registration Failed: ${e.message}`);
      }
    });
  }

  // Initial loads
  await checkAuthStatus();
  await ClassroomModule.loadClassroom();
  await loadHomeSummary();
});
