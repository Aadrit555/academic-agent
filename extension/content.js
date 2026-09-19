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
    // Matches /c/{courseId}/a/{courseworkId}, /c/{courseId}/sa/{courseworkId}, /u/{index}/c/{courseId}/a/{courseworkId}, etc.
    const match = path.match(/\/c\/([A-Za-z0-9_-]+)(?:\/(?:a|sa|submissions)\/([A-Za-z0-9_-]+))?/);
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
    let target = null;

    // Strategy 1: Look for "Add or create" / "Mark as done" / "Turn in" button
    const allButtons = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"]'));
    for (const b of allButtons) {
      const txt = (b.textContent || "").trim();
      if (/^(\+ )?Add or create$/i.test(txt) || /^Turn in$/i.test(txt) || /^Mark as done$/i.test(txt)) {
        target = { container: b.parentElement, insertBefore: b };
        break;
      }
    }

    // Strategy 2: Look for heading or element with text "Your work"
    if (!target) {
      const headings = Array.from(document.querySelectorAll('h2, h3, div, span'));
      for (const h of headings) {
        if (h.children.length === 0 && /^Your work$/i.test((h.textContent || "").trim())) {
          const parentCard = h.closest('[role="region"], aside, form, div') || h.parentElement;
          if (parentCard) {
            target = { container: parentCard, insertBefore: h.nextElementSibling };
            break;
          }
        }
      }
    }

    // Strategy 3: Standard Google Classroom container classes
    if (!target) {
      const fallback = document.querySelector('[aria-label*="Your work" i], [aria-label*="submission" i], .z3vRcc, .oBSRLe, .WkhuNc, aside');
      if (fallback) {
        target = { container: fallback, insertBefore: fallback.firstElementChild };
      }
    }

    if (!target || !target.container) return;

    const btn = document.createElement("button");
    btn.id = "aa-injected-submit-btn";
    btn.className = "aa-classroom-inline-btn";
    btn.innerHTML = `<span>⚡ Auto-Create &amp; Turn In (Zero Download)</span>`;

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      btn.disabled = true;
      btn.innerHTML = `<span>⏳ Reading Handout, Compiling &amp; Submitting...</span>`;
      showToast("Academic Agent: Reading handout, synthesizing deliverables, running compiler validation, and turning in to Google Classroom...", "info");

      try {
        // First sync/find the coursework ID in our local database
        const cwRes = await fetch(`${BACKEND_URL}/api/classroom/coursework`);
        if (!cwRes.ok) {
          throw new Error("Academic Agent backend is not responding on http://127.0.0.1:8000. Is the server running?");
        }
        const cwList = await cwRes.json();
        const matched = (cwList || []).find(c =>
          String(c.coursework_id) === String(ctx.courseworkId) ||
          String(c.classroom_course_id) === String(ctx.courseId)
        ) || (cwList && cwList[0]);

        if (!matched) {
          throw new Error("Coursework not yet indexed. Opening Companion for 1-click execution.");
        }

        // Trigger autonomous submit (creates code, report, runs validation, uploads to Drive, turns in)
        const submitRes = await fetch(`${BACKEND_URL}/api/assignment/${matched.id}/autonomous-submit`, {
          method: "POST"
        });

        const data = await submitRes.json();
        if (!submitRes.ok) {
          throw new Error(data.detail || "Submission failed");
        }

        btn.className = "aa-classroom-inline-btn is-success";
        btn.innerHTML = `<span>✓ Turned In Successfully!</span>`;
        showToast(data.message || "🎉 Successfully turned in to Google Classroom! Zero download needed.", "success");

        // Reload the Google Classroom iframe/drawer if open
        const iframe = document.getElementById("academic-agent-iframe");
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.location.reload();
        }
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = `<span>⚡ Auto-Create &amp; Turn In (Zero Download)</span>`;
        showToast(`Auto-Submit: ${err.message}`, "error");
        toggleDrawer(`courseId=${ctx.courseId}&itemId=${ctx.courseworkId}`);
      }
    });

    if (target.insertBefore) {
      target.container.insertBefore(btn, target.insertBefore);
    } else {
      target.container.prepend(btn);
    }
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

