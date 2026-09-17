// Assignment Generator Module
const GeneratorModule = {
  selectedCourseworkId: null,

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
    const infoEl = document.getElementById("selected-assignment-details");
    const codeViewer = document.getElementById("code-viewer-panel");
    const headerEl = document.getElementById("deliverable-header");
    const downloadBtn = document.getElementById("download-deliverable-btn");

    const cw = AppState.coursework.find(c => c.id === this.selectedCourseworkId);
    if (!cw) return;

    infoEl.innerHTML = `
      <div style="margin-bottom: 6px;"><b>Course:</b> ${escapeHtml(cw.course_name)}</div>
      <div style="margin-bottom: 6px;"><b>Deadline:</b> ${cw.due_date || "N/A"} ${cw.due_time || ""}</div>
      <div style="margin-bottom: 8px;"><b>Status:</b> <span class="status-pill status-${cw.status.toLowerCase()}">${cw.status}</span></div>
      <div style="color: var(--text-secondary); font-size: 12px;">${escapeHtml(cw.description || "")}</div>
    `;

    // Try to load existing deliverable
    try {
      const deliv = await api(`/assignment/${cw.id}/deliverable`);
      headerEl.textContent = `Deliverable: ${deliv.file_name} (${deliv.language.toUpperCase()})`;
      codeViewer.textContent = deliv.code_or_content;
      downloadBtn.style.display = "inline-flex";
      downloadBtn.onclick = () => {
        window.location.href = `/api/assignment/${cw.id}/download`;
      };
      // Also load validation report if available
      ValidationModule.loadValidation(cw.id);
    } catch {
      headerEl.textContent = "Deliverable Preview";
      codeViewer.textContent = "// No deliverable generated yet. Click 'Generate Assignment Deliverable' to begin.";
      downloadBtn.style.display = "none";
      ValidationModule.resetReport();
    }
  },

  async triggerGeneration() {
    if (!this.selectedCourseworkId) {
      alert("Please select an assignment first.");
      return;
    }

    const btn = document.getElementById("btn-trigger-generate");
    btn.textContent = "Generating Deliverable...";
    btn.disabled = true;

    try {
      const res = await api("/assignment/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coursework_id: this.selectedCourseworkId })
      });

      alert(`✓ Deliverable '${res.file_name}' successfully generated from course context!`);
      await this.updateAssignmentInfo();
      loadHomeSummary();

      // Automatically run validation
      await ValidationModule.runValidation(this.selectedCourseworkId);
    } catch (e) {
      alert(`Generation Failed: ${e.message}`);
    } finally {
      btn.textContent = "⚡ Generate Assignment Deliverable";
      btn.disabled = false;
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const genBtn = document.getElementById("btn-trigger-generate");
  if (genBtn) genBtn.addEventListener("click", () => GeneratorModule.triggerGeneration());
});
