// Code & Document Validation Module
const ValidationModule = {
  resetReport() {
    const pill = document.getElementById("validation-status-pill");
    const checklist = document.getElementById("validation-checklist");
    const outBox = document.getElementById("compiler-output-box");

    if (pill) {
      pill.className = "status-pill status-not_started";
      pill.textContent = "PENDING";
    }

    if (checklist) {
      checklist.innerHTML = `
        <li class="checklist-item"><span class="check-icon check-fail">•</span> Instructions understood</li>
        <li class="checklist-item"><span class="check-icon check-fail">•</span> Required file generated</li>
        <li class="checklist-item"><span class="check-icon check-fail">•</span> File format correct</li>
        <li class="checklist-item"><span class="check-icon check-fail">•</span> Compilation successful</li>
        <li class="checklist-item"><span class="check-icon check-fail">•</span> Tests passed</li>
        <li class="checklist-item"><span class="check-icon check-fail">•</span> Submission package created</li>
      `;
    }

    if (outBox) outBox.style.display = "none";
  },

  renderValidation(val) {
    const pill = document.getElementById("validation-status-pill");
    const checklist = document.getElementById("validation-checklist");
    const outBox = document.getElementById("compiler-output-box");
    const outText = document.getElementById("compiler-output-text");

    if (val.passed) {
      pill.className = "status-pill status-ready";
      pill.textContent = "READY FOR SUBMISSION";
    } else {
      pill.className = "status-pill status-failed";
      pill.textContent = "SUBMISSION BLOCKED (FAILED)";
    }

    if (val.checklist && val.checklist.length > 0) {
      checklist.innerHTML = val.checklist.map(item => `
        <li class="checklist-item">
          <span class="check-icon ${item.passed ? 'check-pass' : 'check-fail'}">
            ${item.passed ? '✓' : '✗'}
          </span>
          <div style="flex: 1;">
            <b>${escapeHtml(item.title)}</b>
            ${item.details ? `<div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.details)}</div>` : ''}
          </div>
        </li>
      `).join("");
    }

    const combinedOutput = [val.compiler_output, val.test_output, val.error_details].filter(Boolean).join("\n\n");
    if (combinedOutput) {
      outBox.style.display = "block";
      outText.textContent = combinedOutput;
    } else {
      outBox.style.display = "none";
    }
  },

  async loadValidation(courseworkId) {
    try {
      const data = await api(`/assignment/${courseworkId}/validation`);
      if (data.has_validation) {
        this.renderValidation(data);
      } else {
        this.resetReport();
      }
    } catch {
      this.resetReport();
    }
  },

  async runValidation(courseworkId) {
    const btn = document.getElementById("btn-trigger-validate");
    if (btn) {
      btn.textContent = "Validating & Compiling...";
      btn.disabled = true;
    }

    try {
      const res = await api(`/assignment/${courseworkId}/validate`, { method: "POST" });
      this.renderValidation(res);
      loadHomeSummary();
      ClassroomModule.loadClassroom();
      if (res.passed) {
        alert("✓ Validation Passed! Deliverable compiled cleanly and is READY FOR SUBMISSION.");
      } else {
        alert(`⚠ Validation Blocked: ${res.error_details || 'Compilation or test failure.'}`);
      }
    } catch (e) {
      alert(`Validation Process Error: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "✓ Compile & Validate Code";
        btn.disabled = false;
      }
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const valBtn = document.getElementById("btn-trigger-validate");
  if (valBtn) {
    valBtn.addEventListener("click", () => {
      const cwId = GeneratorModule.selectedCourseworkId;
      if (!cwId) {
        alert("Please select an assignment first.");
        return;
      }
      ValidationModule.runValidation(cwId);
    });
  }
});
