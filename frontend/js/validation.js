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
        <li class="checklist-item"><span class="check-icon check-fail">-</span> Instructions understood</li>
        <li class="checklist-item"><span class="check-icon check-fail">-</span> Required files generated</li>
        <li class="checklist-item"><span class="check-icon check-fail">-</span> Compilation verified (gcc / javac)</li>
        <li class="checklist-item"><span class="check-icon check-fail">-</span> Test cases passed</li>
        <li class="checklist-item"><span class="check-icon check-fail">-</span> Submission package ready</li>
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
      if (pill) {
        pill.className = "status-pill status-ready";
        pill.textContent = "READY FOR SUBMISSION";
      }
    } else {
      if (pill) {
        pill.className = "status-pill status-failed";
        pill.textContent = "SUBMISSION BLOCKED (FAILED)";
      }
    }

    if (checklist && val.checklist && val.checklist.length > 0) {
      checklist.innerHTML = val.checklist.map(item => `
        <li class="checklist-item">
          <span class="check-icon ${item.passed ? 'check-pass' : 'check-fail'}">
            ${item.passed ? '+' : '-'}
          </span>
          <div style="flex: 1;">
            <b>${escapeHtml(item.title)}</b>
            ${item.details ? `<div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.details)}</div>` : ''}
          </div>
        </li>
      `).join("");
    }

    const combinedOutput = [val.compiler_output, val.test_output, val.error_details].filter(Boolean).join("\n\n");
    if (outBox && outText) {
      if (combinedOutput) {
        outBox.style.display = "block";
        outText.textContent = combinedOutput;
      } else {
        outBox.style.display = "none";
      }
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
      btn.textContent = "Compiling & Validating...";
      btn.disabled = true;
    }

    try {
      const res = await api(`/assignment/${courseworkId}/validate`, { method: "POST" });
      this.renderValidation(res);
      loadHomeSummary();
      ClassroomModule.loadClassroom();
      if (res.passed) {
        Toast.success("Validation Passed: Deliverable compiled cleanly and is READY FOR SUBMISSION.");
      } else {
        Toast.warning(`Validation Blocked: ${res.error_details || 'Compilation or test failure.'}`);
      }
    } catch (e) {
      Toast.error(`Validation Process Error: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "Validate Code";
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
        Toast.warning("Please select an assignment first.");
        return;
      }
      ValidationModule.runValidation(cwId);
    });
  }
});
