// Academic Agent — Google Classroom Autonomous Extension Content Script

(function () {
  const BACKEND_URL = "http://127.0.0.1:8000";

  function showToast(message, type = "info") {
    const existing = document.querySelector(".aa-classroom-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = `aa-classroom-toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  // 1. Create Floating Action Button (FAB)
  function injectFAB() {
    if (document.getElementById("academic-agent-fab")) return;

    const fab = document.createElement("div");
    fab.id = "academic-agent-fab";
    fab.title = "Open Academic Agent Google Classroom Companion";
    fab.innerHTML = `
      <span class="aa-pulse"></span>
      <span class="aa-icon">⚡</span>
      <span>Academic Agent</span>
    `;

    fab.addEventListener("click", () => toggleDrawer());
    document.body.appendChild(fab);
  }

  // 2. Create Side Drawer Iframe
  function createDrawer() {
    if (document.getElementById("academic-agent-drawer")) return;

    const drawer = document.createElement("div");
    drawer.id = "academic-agent-drawer";
    drawer.innerHTML = `
      <div id="academic-agent-drawer-header">
        <span>⚡ Academic Agent — Google Classroom Companion</span>
        <button id="academic-agent-drawer-close">&times;</button>
      </div>
      <iframe id="academic-agent-iframe" src="${BACKEND_URL}/addon" allow="clipboard-read; clipboard-write"></iframe>
    `;

    document.body.appendChild(drawer);

    document.getElementById("academic-agent-drawer-close").addEventListener("click", () => {
      drawer.classList.remove("active");
    });
  }

  function toggleDrawer(params = "") {
    createDrawer();
    const drawer = document.getElementById("academic-agent-drawer");
    const iframe = document.getElementById("academic-agent-iframe");

    if (params) {
      iframe.src = `${BACKEND_URL}/addon?${params}`;
    }

    if (drawer) {
      drawer.classList.toggle("active");
    }
  }

  // 3. Extract Course & Coursework from URL
  function getCourseContext() {
    const path = window.location.pathname;
    // Format: /c/{courseId}/a/{courseworkId}/details or /u/{index}/c/{courseId}/a/{courseworkId}
    const match = path.match(/\/c\/([A-Za-z0-9_-]+)(?:\/a\/([A-Za-z0-9_-]+))?/);
    if (match) {
      return {
        courseId: match[1],
        courseworkId: match[2] || null
      };
    }
    return null;
  }

  // 4. Inject Direct Auto-Submit Button into Google Classroom's "Your work" section
  function injectAssignmentButton() {
    const ctx = getCourseContext();
    if (!ctx || !ctx.courseworkId) return;

    if (document.getElementById("aa-injected-submit-btn")) return;

    // Search for Google Classroom's "Your work" submission container
    const yourWorkContainers = document.querySelectorAll(
      '[aria-label*="Your work" i], [aria-label*="submission" i], .z3vRcc, .oBSRLe, .WkhuNc'
    );

    const targetContainer = yourWorkContainers.length > 0
      ? yourWorkContainers[0]
      : document.querySelector('aside') || document.querySelector('form');

    if (!targetContainer) return;

    const btn = document.createElement("button");
    btn.id = "aa-injected-submit-btn";
    btn.className = "aa-classroom-inline-btn";
    btn.innerHTML = `<span>⚡ Auto-Create &amp; Turn In (Zero Download)</span>`;

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      btn.disabled = true;
      btn.innerHTML = `<span>⏳ Ingesting &amp; Turning in to Classroom...</span>`;
      showToast("Academic Agent: Reading handout, compiling code, and submitting to Google Classroom...", "info");

      try {
        // First sync/find the coursework ID in our local database
        const cwRes = await fetch(`${BACKEND_URL}/api/classroom/coursework`);
        const cwList = await cwRes.json();
        const matched = (cwList || []).find(c =>
          String(c.coursework_id) === String(ctx.courseworkId) ||
          String(c.classroom_course_id) === String(ctx.courseId)
        ) || (cwList && cwList[0]);

        if (!matched) {
          throw new Error("Could not find matching coursework. Opening Companion for manual selection.");
        }

        // Trigger autonomous submit
        const submitRes = await fetch(`${BACKEND_URL}/api/assignment/${matched.id}/autonomous-submit`, {
          method: "POST"
        });

        if (!submitRes.ok) {
          const errData = await submitRes.json();
          throw new Error(errData.detail || "Submission failed");
        }

        const data = await submitRes.json();
        btn.className = "aa-classroom-inline-btn is-success";
        btn.innerHTML = `<span>✓ Turned In Successfully!</span>`;
        showToast("🎉 Successfully turned in to Google Classroom! Zero download needed.", "success");

        // Reload the Google Classroom iframe/drawer if open
        const iframe = document.getElementById("academic-agent-iframe");
        if (iframe) iframe.contentWindow.location.reload();
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = `<span>⚡ Auto-Create &amp; Turn In (Zero Download)</span>`;
        showToast(`Auto-Submit: ${err.message}`, "error");
        toggleDrawer(`courseId=${ctx.courseId}&itemId=${ctx.courseworkId}`);
      }
    });

    targetContainer.prepend(btn);
  }

  // 5. Initialize & Observe DOM mutations (Classroom is an SPA)
  function init() {
    injectFAB();
    createDrawer();
    injectAssignmentButton();

    const observer = new MutationObserver(() => {
      injectAssignmentButton();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
