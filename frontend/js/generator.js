// Assignment Specification, Generator & Code Studio Module
const GeneratorModule = {
  selectedCourseworkId: null,
  activeSpec: null,

  async loadGenerator() {
    try {
      const coursework = await api("/classroom/coursework");
      AppState.coursework = coursework;
      this.populateAssignmentSelect(coursework);
    } catch (e) {
      console.error("Failed to load assignments for generator:", e);
    }
  },

  populateAssignmentSelect(coursework) {
    const select = document.getElementById("generator-assignment-select");
    if (!select) return;

    if (!coursework || coursework.length === 0) {
      select.innerHTML = `<option value="">No coursework available</option>`;
      return;
    }

    select.innerHTML = coursework.map(cw => `
      <option value="${cw.id}">${escapeHtml(cw.title)} (${escapeHtml(cw.course_name)})</option>
    `).join("");

    if (!this.selectedCourseworkId || !coursework.find(c => c.id === this.selectedCourseworkId)) {
      this.selectedCourseworkId = parseInt(select.value);
    } else {
      select.value = this.selectedCourseworkId;
    }

    this.updateAssignmentInfo();
    select.onchange = () => {
      this.selectedCourseworkId = parseInt(select.value);
      this.updateAssignmentInfo();
    };
  },

  selectAssignment(courseworkId) {
    this.selectedCourseworkId = courseworkId;
    const select = document.getElementById("generator-assignment-select");
    if (select) {
      select.value = courseworkId;
      this.updateAssignmentInfo();
    }
  },

  async updateAssignmentInfo() {
    const specBox = document.getElementById("assignment-spec-container");
    const codeViewer = document.getElementById("code-viewer-panel");
    const headerEl = document.getElementById("deliverable-header");
    const downloadBtn = document.getElementById("download-deliverable-btn");

    const cw = AppState.coursework.find(c => c.id === this.selectedCourseworkId);
    if (!cw) return;

    // 1. Fetch and render dynamic Assignment Specification
    try {
      const spec = await api(`/assignment/${cw.id}/spec`);
      this.activeSpec = spec;
      if (specBox) {
        specBox.innerHTML = `
          <div class="spec-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span class="spec-badge">SPECIFICATION DETECTED</span>
              <span class="status-pill status-${cw.status.toLowerCase()}">${cw.status}</span>
            </div>
            <h3 style="font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 4px;">${escapeHtml(spec.title)}</h3>
            <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">
              ${escapeHtml(spec.course)} · Due: ${spec.deadline}
            </div>

            <div class="spec-section">
              <div class="spec-label">REQUIRED DELIVERABLES:</div>
              <div class="spec-tags">
                ${spec.required_files.map(f => `<span class="spec-tag">${escapeHtml(f)}</span>`).join("")}
              </div>
            </div>

            ${spec.compiler_flags ? `
              <div class="spec-section">
                <div class="spec-label">COMPILER CONSTRAINTS:</div>
                <div style="font-family: monospace; font-size: 11px; color: #60a5fa;">${escapeHtml(spec.compiler_flags)}</div>
              </div>
            ` : ''}

            ${spec.required_tests.length ? `
              <div class="spec-section">
                <div class="spec-label">VERIFICATION CHECKS:</div>
                <ul style="padding-left: 16px; font-size: 11px; color: var(--text-secondary);">
                  ${spec.required_tests.map(t => `<li>${escapeHtml(t)}</li>`).join("")}
                </ul>
              </div>
            ` : ''}
          </div>
        `;
      }
    } catch (err) {
      console.warn("Spec fetch error:", err);
    }

    // 2. Try to load existing deliverable
    try {
      const deliv = await api(`/assignment/${cw.id}/deliverable`);
      if (headerEl) headerEl.textContent = `${deliv.file_name} (${deliv.language.toUpperCase()})`;
      if (codeViewer) codeViewer.textContent = deliv.code_or_content;
      if (downloadBtn) {
        downloadBtn.style.display = "inline-flex";
        downloadBtn.onclick = () => {
          window.location.href = `/api/assignment/${cw.id}/download`;
        };
      }
      ValidationModule.loadValidation(cw.id);
    } catch {
      if (headerEl) headerEl.textContent = "Deliverable Studio";
      if (codeViewer) codeViewer.textContent = "// Click 'Generate Assignment Deliverable' to synthesize required files from course context.";
      if (downloadBtn) downloadBtn.style.display = "none";
      ValidationModule.resetReport();
    }
  },

  async triggerGeneration() {
    if (!this.selectedCourseworkId) {
      Toast.warning("Please select an assignment first.");
      return;
    }

    const btn = document.getElementById("btn-trigger-generate");
    if (btn) {
      btn.textContent = "Synthesizing Deliverable...";
      btn.disabled = true;
    }

    try {
      const res = await api("/assignment/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coursework_id: this.selectedCourseworkId })
      });

      Toast.success(`Deliverable '${res.file_name}' generated from course context!`);
      await this.updateAssignmentInfo();
      loadHomeSummary();

      // Automatically trigger validation pipeline
      await ValidationModule.runValidation(this.selectedCourseworkId);
    } catch (e) {
      Toast.error(`Generation Failed: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "Generate Deliverable";
        btn.disabled = false;
      }
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const genBtn = document.getElementById("btn-trigger-generate");
  if (genBtn) genBtn.addEventListener("click", () => GeneratorModule.triggerGeneration());

  const autoBtn = document.getElementById("btn-trigger-automate");
  if (autoBtn) {
    autoBtn.addEventListener("click", () => {
      const cwId = GeneratorModule.selectedCourseworkId;
      if (!cwId) {
        Toast.warning("Please select an assignment first.");
        return;
      }
      const cw = AppState.coursework.find(c => c.id === cwId);
      openScheduleModal(cwId, cw ? cw.title : "Assignment");
    });
  }
});
