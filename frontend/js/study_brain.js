// AI Study Brain Module
const StudyBrainModule = {
  activeCourseId: null,

  async loadStudyBrain() {
    try {
      const courses = await api("/classroom/courses");
      AppState.courses = courses;
      this.populateCourseSelect(courses);
    } catch (e) {
      console.error("Failed to load study brain:", e);
    }
  },

  populateCourseSelect(courses) {
    const select = document.getElementById("brain-course-select");
    if (!select) return;

    if (!courses || courses.length === 0) {
      select.innerHTML = `<option value="">No courses available</option>`;
      return;
    }

    select.innerHTML = courses.map(c => `
      <option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.code || "Course")})</option>
    `).join("");

    this.activeCourseId = parseInt(select.value);
    this.loadCourseMaterials(this.activeCourseId);

    select.onchange = () => {
      this.activeCourseId = parseInt(select.value);
      this.loadCourseMaterials(this.activeCourseId);
    };
  },

  async loadCourseMaterials(courseId) {
    const container = document.getElementById("course-materials-list");
    if (!container || !courseId) return;

    try {
      const docs = await api(`/documents/course/${courseId}`);
      if (!docs || docs.length === 0) {
        container.innerHTML = `<div style="color: var(--text-muted);">No documents uploaded for this course yet.</div>`;
        return;
      }

      container.innerHTML = docs.map(d => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(255, 255, 255, 0.03); border-radius: var(--radius-sm); border: 1px solid var(--border);">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">
            <b style="color: #60a5fa;">📄 ${escapeHtml(d.filename)}</b>
            <div style="font-size: 11px; color: var(--text-muted);">${d.page_count} pages · ${d.chunk_count} indexed chunks</div>
          </div>
          <span class="status-pill status-ready" style="font-size: 10px;">INDEXED</span>
        </div>
      `).join("");
    } catch (e) {
      container.innerHTML = `<div style="color: #fb7185;">Error loading materials: ${e.message}</div>`;
    }
  },

  async uploadMaterial() {
    const fileInput = document.getElementById("material-file-input");
    if (!fileInput.files || fileInput.files.length === 0) {
      alert("Please select a file to upload (PDF, DOCX, TXT, MD, PPTX).");
      return;
    }

    if (!this.activeCourseId) {
      alert("Please select a course first.");
      return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("course_id", this.activeCourseId);
    formData.append("file", file);

    const btn = document.getElementById("upload-material-btn");
    btn.textContent = "Uploading & Indexing...";
    btn.disabled = true;

    try {
      const res = await api("/documents/upload", {
        method: "POST",
        body: formData
      });
      alert(`✓ Document '${res.filename}' ingested! Generated ${res.chunk_count} indexed chunks.`);
      fileInput.value = "";
      await this.loadCourseMaterials(this.activeCourseId);
      loadHomeSummary();
    } catch (e) {
      alert(`Upload Failed: ${e.message}`);
    } finally {
      btn.textContent = "Upload & Index Document";
      btn.disabled = false;
    }
  },

  async runAction(action, customQuery = "") {
    if (!this.activeCourseId) {
      alert("Please select a course first.");
      return;
    }

    const titleEl = document.getElementById("study-brain-title");
    const contentEl = document.getElementById("study-brain-content");
    const citBox = document.getElementById("study-brain-citations");
    const citList = document.getElementById("citations-list");

    titleEl.textContent = `Study Brain is analyzing course materials...`;
    contentEl.textContent = "Synthesizing answer from indexed course documents and citations...";
    citBox.style.display = "none";

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

      titleEl.textContent = res.title;
      contentEl.textContent = res.content;

      if (res.citations && res.citations.length > 0) {
        citBox.style.display = "block";
        citList.innerHTML = res.citations.map(c => `
          <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px; font-size: 12px;">
            <b style="color: #60a5fa;">${escapeHtml(c.document_name)} [Page ${c.page_number}]</b>
            <div style="color: var(--text-secondary); font-style: italic; margin-top: 2px;">"${escapeHtml(c.snippet)}"</div>
          </div>
        `).join("");
      } else {
        citBox.style.display = "none";
      }
    } catch (e) {
      titleEl.textContent = "Query Failed";
      contentEl.textContent = `Error: ${e.message}`;
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const uploadBtn = document.getElementById("upload-material-btn");
  if (uploadBtn) uploadBtn.addEventListener("click", () => StudyBrainModule.uploadMaterial());

  document.querySelectorAll(".brain-action-btn").forEach(btn => {
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
        alert("Please enter a question or topic.");
        return;
      }
      StudyBrainModule.runAction("explanation", q);
    });
  }
});
