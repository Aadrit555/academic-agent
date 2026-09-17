// Real Google Classroom & University ERP Integrations Module
const IntegrationsModule = {
  currentTab: "google",

  init() {
    this.checkUrlParams();
    this.loadStatus();
  },

  checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth_success") === "true") {
      Toast.success("Real Google Classroom connected! Live courses and coursework synced.");
      window.history.replaceState({}, document.title, window.location.pathname);
      this.loadStatus();
      if (typeof ClassroomModule !== "undefined") ClassroomModule.loadClassroom();
      if (typeof loadHomeSummary === "function") loadHomeSummary();
    } else if (params.get("auth_error")) {
      Toast.error(`Google Authentication Error: ${params.get("auth_error")}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  },

  async loadStatus() {
    try {
      const [googleStatus, erpStatus] = await Promise.all([
        api("/auth/status"),
        api("/erp/status")
      ]);

      // Update Google status badge in modal and header
      const googleChip = document.getElementById("google-modal-status-badge");
      if (googleChip) {
        if (googleStatus.connected) {
          googleChip.className = "status-pill status-ready";
          googleChip.textContent = googleStatus.is_demo_mode ? "DEMO CONNECTED" : "LIVE CONNECTED";
        } else {
          googleChip.className = "status-pill status-not_started";
          googleChip.textContent = "OFFLINE";
        }
      }

      // Update ERP status card
      const erpStatusCard = document.getElementById("erp-modal-status-card");
      const erpFormContainer = document.getElementById("erp-login-form-container");

      if (erpStatusCard) {
        if (erpStatus.is_connected) {
          erpStatusCard.style.display = "block";
          if (erpFormContainer) erpFormContainer.style.display = "none";

          const syncTimeStr = erpStatus.last_synced_at
            ? new Date(erpStatus.last_synced_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : 'Just now';

          erpStatusCard.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
              <div>
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <span class="status-pill status-ready">● LIVE SYNCHRONIZED</span>
                  <span style="font-size: 11px; color: var(--text-muted);">SRM AP eVarsity</span>
                </div>
                <div style="font-size: 15px; font-weight: 700; color: #fff;">${escapeHtml(erpStatus.student_name || "SRM Student")}</div>
                <div style="font-size: 12px; color: #60a5fa; font-family: var(--font-mono); margin-top: 2px;">${escapeHtml(erpStatus.student_id || "")}</div>
              </div>
              <div style="display: flex; gap: 6px;">
                <button class="btn btn-secondary btn-sm" id="btn-refresh-erp-modal" style="padding: 4px 10px; font-size: 11px;">
                  🔄 Refresh Data
                </button>
                <button class="btn btn-secondary btn-sm" id="btn-disconnect-erp-modal" style="padding: 4px 10px; font-size: 11px; color: #f87171;">
                  Disconnect
                </button>
              </div>
            </div>

            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">
              Last synchronized: <b style="color: #cbd5e1;">${syncTimeStr}</b>
            </div>
            
            ${erpStatus.attendance_summary && erpStatus.attendance_summary.length > 0 ? `
              <div style="border-top: 1px solid var(--border); padding-top: 10px; margin-top: 6px;">
                <div style="font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">LIVE ATTENDANCE & MARGINS:</div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  ${erpStatus.attendance_summary.slice(0, 4).map(a => `
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 4px;">
                      <span style="color: #cbd5e1; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(a.subject || a.course_code)}</span>
                      <div style="text-align: right;">
                        <span style="font-weight: 700; color: ${a.percentage >= 75 ? '#34d399' : '#f87171'}; font-family: var(--font-mono);">${a.percentage}%</span>
                        <span style="font-size: 10px; color: var(--text-muted); margin-left: 4px;">(${a.margin >= 0 ? '+' + a.margin + ' safe' : a.margin + ' need'})</span>
                      </div>
                    </div>
                  `).join("")}
                </div>
              </div>
            ` : ''}
          `;

          // Re-bind modal refresh & disconnect buttons
          const refBtn = document.getElementById("btn-refresh-erp-modal");
          if (refBtn) refBtn.onclick = () => IntegrationsModule.refreshERP();

          const discBtn = document.getElementById("btn-disconnect-erp-modal");
          if (discBtn) discBtn.onclick = () => IntegrationsModule.disconnectERP();

        } else {
          erpStatusCard.style.display = "none";
          if (erpFormContainer) erpFormContainer.style.display = "block";
        }
      }
    } catch (e) {
      console.warn("Error loading integrations status:", e);
    }
  },

  async saveGoogleCredentialsAndAuth() {
    const cidInput = document.getElementById("google-client-id-input");
    const secInput = document.getElementById("google-client-secret-input");

    const clientId = cidInput ? cidInput.value.trim() : "";
    const clientSecret = secInput ? secInput.value.trim() : "";

    if (!clientId || !clientSecret) {
      Toast.warning("Please enter both Google Client ID and Client Secret.");
      return;
    }

    const btn = document.getElementById("btn-save-google-credentials");
    if (btn) {
      btn.textContent = "Connecting to Google Cloud...";
      btn.disabled = true;
    }

    try {
      const res = await api("/config/google-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret
        })
      });

      Toast.success(res.message);
      // Launch Google OAuth
      if (res.auth_url) {
        window.location.href = res.auth_url;
      }
    } catch (e) {
      Toast.error(`Google Setup Failed: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "Save Credentials & Connect Google";
        btn.disabled = false;
      }
    }
  },

  async launchGoogleAuth() {
    try {
      const res = await api("/auth/google/url");
      if (res && res.url) {
        window.location.href = res.url;
      }
    } catch (e) {
      Toast.error(`Could not launch Google authentication: ${e.message}`);
    }
  },

  async connectERPSession() {
    const urlInput = document.getElementById("erp-portal-url-input");
    const cookieInput = document.getElementById("erp-session-cookie-input");
    const idInput = document.getElementById("erp-student-id-input");

    const portalUrl = urlInput ? urlInput.value.trim() : "";
    const cookie = cookieInput ? cookieInput.value.trim() : "";
    const studentId = idInput ? idInput.value.trim() : "";

    if (!portalUrl) {
      Toast.warning("Please enter your university portal URL (e.g. https://academia.srmist.edu.in).");
      return;
    }
    if (!cookie) {
      Toast.warning("Please provide a session cookie or auth token from your portal.");
      return;
    }

    const btn = document.getElementById("btn-connect-erp-session");
    if (btn) {
      btn.textContent = "Connecting to ERP Portal...";
      btn.disabled = true;
    }

    try {
      const res = await api("/erp/connect-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portal_url: portalUrl,
          session_cookie: cookie,
          student_id: studentId
        })
      });

      Toast.success(res.message);
      await this.loadStatus();
      if (typeof TimetableModule !== "undefined") TimetableModule.loadTimetable();
      if (typeof loadHomeSummary === "function") loadHomeSummary();
      closeModal("integrations-modal");
    } catch (e) {
      Toast.error(`ERP Connection Failed: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "Connect & Sync ERP Session";
        btn.disabled = false;
      }
    }
  },

  async importScheduleText() {
    const textInput = document.getElementById("erp-schedule-text-input");
    const content = textInput ? textInput.value.trim() : "";
    if (!content) {
      Toast.warning("Please paste valid schedule data (JSON, CSV, or ICS).");
      return;
    }

    const btn = document.getElementById("btn-import-erp-schedule");
    if (btn) {
      btn.textContent = "Parsing & Syncing Schedule...";
      btn.disabled = true;
    }

    try {
      const res = await api("/erp/import-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });

      Toast.success(res.message);
      if (textInput) textInput.value = "";
      if (typeof TimetableModule !== "undefined") TimetableModule.loadTimetable();
      if (typeof loadHomeSummary === "function") loadHomeSummary();
      closeModal("integrations-modal");
    } catch (e) {
      Toast.error(`Schedule Import Failed: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "Import & Sync Timetable";
        btn.disabled = false;
      }
    }
  },

  async connectDirectERP() {
    const idInput = document.getElementById("erp-direct-id-input");
    const pwInput = document.getElementById("erp-direct-password-input");

    const erpId = idInput ? idInput.value.trim().toUpperCase() : "";
    const password = pwInput ? pwInput.value.trim() : "";

    if (!erpId) {
      Toast.warning("Please enter your SRM AP Registration Number (e.g. AP23110010042).");
      return;
    }
    if (!password) {
      Toast.warning("Please enter your SRM AP ERP portal password.");
      return;
    }

    const btn = document.getElementById("btn-connect-direct-erp");
    if (btn) {
      btn.innerHTML = `<span style="display:inline-block; margin-right:6px;">⏳</span> Authenticating & Solving Captcha...`;
      btn.disabled = true;
    }

    try {
      const res = await api("/erp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          erp_id: erpId,
          password: password
        })
      });

      if (res.access_token) {
        localStorage.setItem("academic_agent_jwt", res.access_token);
      }

      if (res.is_cached) {
        Toast.warning(res.message);
      } else {
        Toast.success(res.message || "Connected to SRM AP eVarsity! Live schedule and attendance synchronized.");
      }

      // Clear password field for security
      if (pwInput) pwInput.value = "";

      if (typeof checkAuthStatus === "function") await checkAuthStatus();
      await this.loadStatus();
      if (typeof TimetableModule !== "undefined") TimetableModule.loadTimetable();
      if (typeof loadHomeSummary === "function") loadHomeSummary();
      closeModal("integrations-modal");
    } catch (e) {
      Toast.error(`ERP Connection Failed: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "CONNECT SRM ERP";
        btn.disabled = false;
      }
    }
  },

  async refreshERP() {
    const refBtn = document.getElementById("btn-refresh-erp-modal");
    if (refBtn) {
      refBtn.textContent = "Syncing...";
      refBtn.disabled = true;
    }

    try {
      const res = await api("/erp/refresh", {
        method: "POST"
      });

      if (res.is_cached) {
        Toast.warning(res.notice || "Portal is temporarily unreachable. Using cached schedule.");
      } else {
        Toast.success("ERP data refreshed and synchronized!");
      }

      await this.loadStatus();
      if (typeof TimetableModule !== "undefined") TimetableModule.loadTimetable();
      if (typeof loadHomeSummary === "function") loadHomeSummary();
    } catch (e) {
      Toast.error(`Refresh Failed: ${e.message}`);
    } finally {
      if (refBtn) {
        refBtn.textContent = "🔄 Refresh Data";
        refBtn.disabled = false;
      }
    }
  },

  async disconnectERP() {
    if (!confirm("Are you sure you want to disconnect SRM ERP? This will clear saved credentials.")) return;

    try {
      const res = await api("/erp/disconnect", { method: "POST" });
      Toast.success(res.message || "Disconnected from ERP.");
      await this.loadStatus();
      if (typeof TimetableModule !== "undefined") TimetableModule.loadTimetable();
      if (typeof loadHomeSummary === "function") loadHomeSummary();
    } catch (e) {
      Toast.error(`Disconnect Failed: ${e.message}`);
    }
  },

  async uploadScheduleFile() {
    const fileInput = document.getElementById("erp-schedule-file-input");
    if (!fileInput.files || fileInput.files.length === 0) {
      Toast.warning("Please choose a file to upload (.ics, .csv, or .json).");
      return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("file", file);

    const btn = document.getElementById("btn-upload-erp-schedule-file");
    if (btn) {
      btn.textContent = "Uploading Schedule...";
      btn.disabled = true;
    }

    try {
      const res = await api("/erp/upload-schedule-file", {
        method: "POST",
        body: formData
      });

      Toast.success(res.message);
      fileInput.value = "";
      if (typeof TimetableModule !== "undefined") TimetableModule.loadTimetable();
      if (typeof loadHomeSummary === "function") loadHomeSummary();
      closeModal("integrations-modal");
    } catch (e) {
      Toast.error(`Upload Failed: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "Upload & Parse Schedule File";
        btn.disabled = false;
      }
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  IntegrationsModule.init();

  const openBtn = document.getElementById("open-integrations-btn");
  if (openBtn) openBtn.addEventListener("click", () => openModal("integrations-modal"));

  // Connect Google button in header
  const connectGoogleBtn = document.getElementById("connect-google-btn");
  if (connectGoogleBtn) {
    connectGoogleBtn.addEventListener("click", () => IntegrationsModule.launchGoogleAuth());
  }

  // Google save credentials button
  const saveGoogleBtn = document.getElementById("btn-save-google-credentials");
  if (saveGoogleBtn) {
    saveGoogleBtn.addEventListener("click", () => IntegrationsModule.saveGoogleCredentialsAndAuth());
  }

  // Direct launch Google button
  const directGoogleBtn = document.getElementById("btn-launch-google-oauth");
  if (directGoogleBtn) {
    directGoogleBtn.addEventListener("click", () => IntegrationsModule.launchGoogleAuth());
  }

  // Direct SRM AP ERP connect button
  const directErpBtn = document.getElementById("btn-connect-direct-erp");
  if (directErpBtn) {
    directErpBtn.addEventListener("click", () => IntegrationsModule.connectDirectERP());
  }

  // Toggle ERP password visibility
  const togglePwBtn = document.getElementById("erp-toggle-password-btn");
  const directPwInput = document.getElementById("erp-direct-password-input");
  if (togglePwBtn && directPwInput) {
    togglePwBtn.addEventListener("click", () => {
      const isPw = directPwInput.type === "password";
      directPwInput.type = isPw ? "text" : "password";
      togglePwBtn.textContent = isPw ? "Hide" : "Show";
    });
  }

  // ERP session connect button
  const connectErpBtn = document.getElementById("btn-connect-erp-session");
  if (connectErpBtn) {
    connectErpBtn.addEventListener("click", () => IntegrationsModule.connectERPSession());
  }

  // ERP import schedule text button
  const importTextBtn = document.getElementById("btn-import-erp-schedule");
  if (importTextBtn) {
    importTextBtn.addEventListener("click", () => IntegrationsModule.importScheduleText());
  }

  // ERP upload schedule file button
  const uploadFileBtn = document.getElementById("btn-upload-erp-schedule-file");
  if (uploadFileBtn) {
    uploadFileBtn.addEventListener("click", () => IntegrationsModule.uploadScheduleFile());
  }

  // Tab switching inside integrations modal
  document.querySelectorAll(".integration-sub-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-target");
      document.querySelectorAll(".integration-sub-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      document.querySelectorAll(".integration-tab-panel").forEach(p => {
        p.style.display = p.id === target ? "block" : "none";
      });
    });
  });
});

