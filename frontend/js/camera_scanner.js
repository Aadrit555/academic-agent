// Google Lens-Style Camera Attendance Scanner Module
const CameraScannerModule = {
  stream: null,
  isScanning: false,
  detectedCode: null,
  scanTimer: null,
  matchedClass: null,

  async startCamera() {
    const video = document.getElementById("scanner-video");
    const container = document.getElementById("scanner-viewport");
    const statusText = document.getElementById("scanner-status-text");
    const detectedBox = document.getElementById("scanner-detected-card");

    if (!video || !container) return;

    if (detectedBox) detectedBox.style.display = "none";
    this.detectedCode = null;
    this.isScanning = true;

    statusText.textContent = "Searching for classroom attendance code (e.g. A235646)...";
    container.classList.remove("detected");
    container.classList.add("scanning");

    try {
      // Initialize real WebRTC video stream
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }
      });
      video.srcObject = this.stream;
      await video.play();
      this.startFrameSampling();
    } catch (err) {
      console.warn("Camera device access unavailable or permission denied:", err);
      statusText.innerHTML = `<span>Camera access unavailable in this environment. Use <b>Test Lens Scan</b> below.</span>`;
      container.classList.remove("scanning");
    }
  },

  stopCamera() {
    this.isScanning = false;
    clearInterval(this.scanTimer);
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    const video = document.getElementById("scanner-video");
    if (video) video.srcObject = null;
    const container = document.getElementById("scanner-viewport");
    if (container) container.classList.remove("scanning", "detected");
  },

  startFrameSampling() {
    clearInterval(this.scanTimer);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const video = document.getElementById("scanner-video");

    // Throttled frame sampling loop (every 1000ms) to scan camera frames via backend optical engine
    this.scanTimer = setInterval(async () => {
      if (!this.isScanning || !video || video.readyState !== 4) return;

      canvas.width = 480;
      canvas.height = 360;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frameData = canvas.toDataURL("image/jpeg", 0.65);

      try {
        const res = await api("/attendance/scan-frame", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frame_data: frameData })
        });
        if (res && res.detected && res.code) {
          this.triggerCodeDetection(res.code, res);
        }
      } catch (err) {
        // Silent frame skip
      }
    }, 1000);
  },

  // Triggers verification and UI state when code is scanned or manually entered
  async triggerCodeDetection(code, preloadedRes = null) {
    if (!code) return;
    const cleanCode = code.trim().toUpperCase();
    if (this.detectedCode === cleanCode) return;
    this.detectedCode = cleanCode;
    this.isScanning = false;
    clearInterval(this.scanTimer);

    const container = document.getElementById("scanner-viewport");
    const statusText = document.getElementById("scanner-status-text");
    const detectedBox = document.getElementById("scanner-detected-card");
    const codeEl = document.getElementById("detected-code-value");
    const classEl = document.getElementById("detected-class-context");

    if (container) {
      container.classList.remove("scanning");
      container.classList.add("detected");
    }

    try {
      const res = preloadedRes || await api("/attendance/scan-frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleanCode })
      });

      if (!res.detected) {
        if (statusText) statusText.textContent = res.message || "Code not recognized.";
        Toast.warning(res.message || "Invalid or unverified attendance code.");
        return;
      }

      this.matchedClass = res;
      if (statusText) statusText.textContent = "Attendance code recognized!";
      if (detectedBox && codeEl && classEl) {
        codeEl.textContent = res.code;
        classEl.textContent = `${res.subject} · Room ${res.classroom}`;
        detectedBox.style.display = "block";
      }

      Toast.info(`Attendance code verified: ${res.code}`);
    } catch (e) {
      Toast.error(`Scan verification error: ${e.message}`);
    }
  },

  async confirmAttendance() {
    if (!this.detectedCode) {
      Toast.warning("No attendance code detected yet.");
      return;
    }

    const btn = document.getElementById("confirm-attendance-btn");
    if (btn) {
      btn.textContent = "Recording Attendance...";
      btn.disabled = true;
    }

    try {
      const res = await api("/attendance/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attendance_code: this.detectedCode,
          subject: this.matchedClass ? this.matchedClass.subject : "Data Structures"
        })
      });

      Toast.success(`Attendance code '${res.attendance_code}' recorded for ${res.subject}!`);
      this.loadRecentAttendance();
      loadHomeSummary();

      // Reset card after successful mark
      const detectedBox = document.getElementById("scanner-detected-card");
      if (detectedBox) detectedBox.style.display = "none";
      const statusText = document.getElementById("scanner-status-text");
      if (statusText) statusText.textContent = "Attendance marked successfully. Ready for next session.";
    } catch (e) {
      Toast.error(`Attendance Failed: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "Confirm & Mark Attendance";
        btn.disabled = false;
      }
    }
  },

  async loadERPAttendance() {
    const list = document.getElementById("erp-attendance-cards-list");
    if (!list) return;

    try {
      const records = await api("/erp/attendance");
      if (!records || records.length === 0) {
        list.innerHTML = `
          <div style="padding: 12px; background: rgba(255, 255, 255, 0.02); border: 1px dashed var(--border); border-radius: var(--radius-sm); font-size: 11px; color: var(--text-muted); text-align: center;">
            No live ERP attendance loaded.<br>
            <a href="javascript:void(0)" onclick="openModal('integrations-modal')" style="color: #60a5fa; text-decoration: none; font-weight: 600; display: inline-block; margin-top: 4px;">Connect SRM AP ERP &rarr;</a>
          </div>
        `;
        return;
      }

      list.innerHTML = records.map(r => {
        const isSafe = r.percentage >= 75;
        const pct = r.percentage || 0;
        const barColor = isSafe ? '#10b981' : '#ef4444';
        const marginBadge = r.margin >= 0
          ? `<span style="color: #34d399; font-weight: 700;">+${r.margin} can bunk</span>`
          : `<span style="color: #f87171; font-weight: 700;">${r.margin} need to attend</span>`;

        return `
          <div style="padding: 10px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: var(--radius-sm);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
              <div>
                <b style="color: #fff; font-size: 12px;">${escapeHtml(r.subject || r.course_code)}</b>
                <div style="color: var(--text-muted); font-size: 10px;">${escapeHtml(r.course_code || '')} · Attended: ${r.attended}/${r.conducted}</div>
              </div>
              <div style="text-align: right;">
                <span style="font-family: var(--font-mono); font-weight: 800; font-size: 13px; color: ${barColor};">${pct}%</span>
                <div style="font-size: 10px; margin-top: 1px;">${marginBadge}</div>
              </div>
            </div>
            <div style="height: 4px; background: rgba(255, 255, 255, 0.08); border-radius: 2px; overflow: hidden;">
              <div style="height: 100%; width: ${Math.min(100, Math.max(0, pct))}%; background: ${barColor}; transition: width 0.3s ease;"></div>
            </div>
          </div>
        `;
      }).join("");
    } catch (e) {
      list.innerHTML = `<div style="color: #f87171; font-size: 11px;">Failed to load ERP attendance.</div>`;
    }
  },

  async loadRecentAttendance() {
    const list = document.getElementById("recent-attendance-list");
    if (!list) return;

    try {
      const records = await api("/attendance/recent");
      if (!records || records.length === 0) {
        list.innerHTML = `<div style="font-size: 12px; color: var(--text-muted);">No attendance recorded yet.</div>`;
        return;
      }

      list.innerHTML = records.map(r => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 12px;">
          <div>
            <b style="color: #fff;">${escapeHtml(r.subject)}</b>
            <div style="color: var(--text-muted); font-size: 11px;">Code: <span style="font-family: monospace; color: #60a5fa;">${r.attendance_code}</span> · ${new Date(r.marked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <span class="status-pill status-ready">RECORDED</span>
        </div>
      `).join("");
    } catch (e) {
      list.innerHTML = `<div style="color: #f87171; font-size: 12px;">Error loading recent records.</div>`;
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById("btn-start-camera-scan");
  if (startBtn) startBtn.addEventListener("click", () => CameraScannerModule.startCamera());

  const stopBtn = document.getElementById("btn-stop-camera-scan");
  if (stopBtn) stopBtn.addEventListener("click", () => CameraScannerModule.stopCamera());

  const submitManualBtn = document.getElementById("btn-submit-manual-code");
  const manualInput = document.getElementById("manual-attendance-code-input");
  if (submitManualBtn && manualInput) {
    submitManualBtn.addEventListener("click", () => {
      const val = manualInput.value.trim().toUpperCase();
      if (!val) {
        Toast.warning("Please enter an attendance code.");
        return;
      }
      CameraScannerModule.triggerCodeDetection(val);
    });
    manualInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        submitManualBtn.click();
      }
    });
  }

  const confirmBtn = document.getElementById("confirm-attendance-btn");
  if (confirmBtn) confirmBtn.addEventListener("click", () => CameraScannerModule.confirmAttendance());

  const refAttBtn = document.getElementById("btn-refresh-attendance-tab");
  if (refAttBtn) refAttBtn.addEventListener("click", async () => {
    refAttBtn.textContent = "Syncing...";
    if (typeof IntegrationsModule !== "undefined") await IntegrationsModule.refreshERP();
    await CameraScannerModule.loadERPAttendance();
    refAttBtn.textContent = "Sync ERP";
  });
});

