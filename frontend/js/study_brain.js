// Course Material RAG & Study Brain Module
const StudyBrainModule = {
  activeCourseId: null,

  async loadStudyBrain() {
    const courseSelect = document.getElementById("study-brain-course-select");
    if (!courseSelect) return;

    try {
      const courses = await api("/classroom/courses");
      if (!courses || courses.length === 0) {
        courseSelect.innerHTML = `<option value="">No courses available</option>`;
        return;
      }

      courseSelect.innerHTML = courses.map(c => `
        <option value="${c.id}">${escapeHtml(c.name)}</option>
      `).join("");

      if (!this.activeCourseId || !courses.find(c => c.id === this.activeCourseId)) {
        this.activeCourseId = courses[0].id;
      }
      courseSelect.value = this.activeCourseId;

      await this.loadCourseMaterials(this.activeCourseId);

      courseSelect.onchange = () => {
        this.activeCourseId = parseInt(courseSelect.value);
        this.loadCourseMaterials(this.activeCourseId);
      };
    } catch (e) {
      console.error("Study Brain load error:", e);
    }
  },

  async loadCourseMaterials(courseId) {
    const container = document.getElementById("study-brain-materials-list");
    if (!container) return;

    try {
      const docs = await api(`/documents/course/${courseId}`);
      if (!docs || docs.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted); font-size: 12px;">No documents uploaded for this course yet.</div>`;
        return;
      }

      container.innerHTML = docs.map(d => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(255, 255, 255, 0.02); border-radius: var(--radius-sm); border: 1px solid var(--border);">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;">
            <b style="color: #60a5fa; font-size: 12px;">${escapeHtml(d.filename)}</b>
            <div style="font-size: 11px; color: var(--text-muted);">${d.page_count} pages · ${d.chunk_count} indexed chunks</div>
          </div>
          <span class="status-pill status-ready" style="font-size: 10px;">INDEXED</span>
        </div>
      `).join("");
    } catch (e) {
      container.innerHTML = `<div style="color: #f87171; font-size: 12px;">Error loading materials: ${e.message}</div>`;
    }
  },

  async uploadMaterial() {
    const fileInput = document.getElementById("material-file-input");
    if (!fileInput.files || fileInput.files.length === 0) {
      Toast.warning("Please select a file to upload (PDF, DOCX, TXT, MD).");
      return;
    }

    if (!this.activeCourseId) {
      Toast.warning("Please select a course first.");
      return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("course_id", this.activeCourseId);
    formData.append("file", file);

    const btn = document.getElementById("upload-material-btn");
    if (btn) {
      btn.textContent = "Indexing Material...";
      btn.disabled = true;
    }

    try {
      const res = await api("/documents/upload", {
        method: "POST",
        body: formData
      });
      Toast.success(`Document '${res.filename}' ingested! Generated ${res.chunk_count} indexed chunks.`);
      fileInput.value = "";
      await this.loadCourseMaterials(this.activeCourseId);
      loadHomeSummary();
    } catch (e) {
      Toast.error(`Upload Failed: ${e.message}`);
    } finally {
      if (btn) {
        btn.textContent = "Upload Course Document";
        btn.disabled = false;
      }
    }
  },

  async runAction(action, customQuery = "") {
    if (!this.activeCourseId) {
      Toast.warning("Please select a course first.");
      return;
    }

    const titleEl = document.getElementById("study-brain-title");
    const contentEl = document.getElementById("study-brain-content");
    const citBox = document.getElementById("study-brain-citations");
    const citList = document.getElementById("citations-list");

    if (titleEl) titleEl.textContent = `Study Brain is analyzing course materials...`;
    if (contentEl) contentEl.textContent = "Synthesizing answer from indexed course documents and citations...";
    if (citBox) citBox.style.display = "none";

    try {
      const res = await api("/study-brain/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: this.activeCourseId,
          action: action,
          query: customQuery
        })
      });

      if (titleEl) titleEl.textContent = res.title;
      if (contentEl) contentEl.textContent = res.content;

      if (res.citations && res.citations.length > 0 && citBox && citList) {
        citBox.style.display = "block";
        citList.innerHTML = res.citations.map(c => `
          <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px; font-size: 11px;">
            <b style="color: #60a5fa;">${escapeHtml(c.document_name)} [Page ${c.page_number}]</b>
            <div style="color: var(--text-secondary); font-style: italic; margin-top: 2px;">"${escapeHtml(c.snippet)}"</div>
          </div>
        `).join("");
      } else if (citBox) {
        citBox.style.display = "none";
      }
    } catch (e) {
      if (titleEl) titleEl.textContent = "Query Failed";
      if (contentEl) contentEl.textContent = `Error: ${e.message}`;
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const uploadBtn = document.getElementById("upload-material-btn");
  if (uploadBtn) uploadBtn.addEventListener("click", () => StudyBrainModule.uploadMaterial());

  document.querySelectorAll(".brain-action-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      const act = btn.getAttribute("data-action");
      StudyBrainModule.runAction(act);
    });
  });

  const queryBtn = document.getElementById("run-brain-query-btn");
  if (queryBtn) {
    queryBtn.addEventListener("click", () => {
      const q = document.getElementById("brain-query-input").value.trim();
      if (!q) {
        Toast.warning("Please enter a question or topic.");
        return;
      }
      StudyBrainModule.runAction("explanation", q);
    });
  }
});
