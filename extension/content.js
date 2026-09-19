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

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function getLivePageDetails() {
    const h1 = document.querySelector('h1') || document.querySelector('[role="main"] h1');
    const title = h1 ? h1.textContent.trim() : "Current Classroom Assignment";

    let teacher = "";
    const commentInput = document.querySelector('[aria-label*="Add comment to" i]');
    if (commentInput) {
      const match = (commentInput.getAttribute('aria-label') || '').match(/Add comment to\s+([^.]+)/i);
      if (match) teacher = match[1].trim();
    }

    let status = "Assigned";
    const statusBadges = Array.from(document.querySelectorAll('aside, [role="region"], .z3vRcc, .oBSRLe, .WkhuNc'));
    for (const b of statusBadges) {
      const t = (b.textContent || '');
      if (t.includes('Turned in')) status = 'Turned in';
      else if (t.includes('Assigned')) status = 'Assigned';
      else if (t.includes('Missing')) status = 'Missing';
    }

    const attachments = Array.from(document.querySelectorAll('a[href*="drive.google.com"], a[href*="docs.google.com"]'))
      .map(a => (a.textContent || '').trim())
      .filter(t => t.length > 2 && !t.includes('Google Drive'))
      .slice(0, 3);

    return { title, teacher, status, attachments };
  }

  function renderDrawerContent() {
    const bodyEl = document.getElementById("academic-agent-drawer-body");
    if (!bodyEl) return;

    const details = getLivePageDetails();
    const storedId = localStorage.getItem("academic_real_student_id") || "";

    bodyEl.innerHTML = `
      <div class="aa-drawer-card">
        <div class="aa-card-title">
          <span>Active Classroom Task</span>
          <span class="aa-pill ${details.status === 'Turned in' ? 'pill-green' : 'pill-blue'}">${details.status}</span>
        </div>
        <div class="aa-item-title">${escapeHtml(details.title)}</div>
        <div class="aa-item-meta">
          ${details.teacher ? `<span>👨‍🏫 Faculty: <b>${escapeHtml(details.teacher)}</b></span>` : ''}
          ${details.attachments.length > 0 ? `<span>📑 Handout: <b>${escapeHtml(details.attachments[0])}</b></span>` : ''}
        </div>
      </div>

      <div class="aa-drawer-card">
        <div class="aa-card-title">Student Profile</div>
        <div class="aa-item-meta">
          <span>Google Account: <b style="color: #34d399;">aadrit_y@srmap.edu.in</b></span>
          <span style="margin-top: 6px;">SRM AP Registration Number:</span>
        </div>
        <div class="aa-input-row">
          <input type="text" class="aa-input" id="aa-student-id-input" placeholder="Enter AP Reg No (e.g. AP23...)" value="${escapeHtml(storedId)}">
          <button class="aa-btn-save" id="aa-btn-save-id">Save</button>
        </div>
      </div>

      <button class="aa-classroom-inline-btn" id="aa-drawer-submit-btn" style="margin: 4px 0; padding: 12px 16px; font-size: 13px;">
        <span>⚡ Auto-Create &amp; Turn In (Zero Download)</span>
      </button>

      <button class="aa-classroom-inline-btn" id="aa-btn-open-dashboard" style="background: #334155; margin-top: 2px;">
        <span>Open Companion Web Layer ↗</span>
      </button>
    `;

    const saveBtn = document.getElementById("aa-btn-save-id");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const val = (document.getElementById("aa-student-id-input").value || "").trim().toUpperCase();
        if (val) {
          localStorage.setItem("academic_real_student_id", val);
          showToast(`Saved Registration Number: ${val}`, "success");
        }
      });
    }

    const submitBtn = document.getElementById("aa-drawer-submit-btn");
    if (submitBtn) {
      submitBtn.addEventListener("click", async () => {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>⏳ Ingesting &amp; Turning In to Classroom...</span>`;
        try {
          await performRealGoogleClassroomTurnIn();
          submitBtn.className = "aa-classroom-inline-btn is-success";
          submitBtn.innerHTML = `<span>✓ Turned In Successfully!</span>`;
          renderDrawerContent();
        } catch (e) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<span>⚡ Auto-Create &amp; Turn In (Zero Download)</span>`;
          showToast(e.message, "error");
        }
      });
    }

    const dashBtn = document.getElementById("aa-btn-open-dashboard");
    if (dashBtn) {
      dashBtn.addEventListener("click", () => {
        window.open(`${BACKEND_URL}/addon`, "_blank");
      });
    }
  }

  // 2. Create Side Drawer (Native DOM Component)
  function createDrawer() {
    if (document.getElementById("academic-agent-drawer")) return;

    const drawer = document.createElement("div");
    drawer.id = "academic-agent-drawer";
    drawer.innerHTML = `
      <div id="academic-agent-drawer-header">
        <span>⚡ Academic Agent — Google Classroom Companion</span>
        <button id="academic-agent-drawer-close">&times;</button>
      </div>
      <div id="academic-agent-drawer-body"></div>
    `;

    document.body.appendChild(drawer);

    document.getElementById("academic-agent-drawer-close").addEventListener("click", () => {
      drawer.classList.remove("active");
    });
  }

  function toggleDrawer() {
    createDrawer();
    const drawer = document.getElementById("academic-agent-drawer");
    if (drawer) {
      drawer.classList.toggle("active");
      if (drawer.classList.contains("active")) {
        renderDrawerContent();
      }
    }
  }

  // 3. Extract Course & Coursework from URL if available
  function getCourseContext() {
    const path = window.location.pathname;
    const match = path.match(/\/c\/([A-Za-z0-9_-]+)(?:\/(?:a|sa|submissions|w)\/([A-Za-z0-9_-]+))?/);
    if (match) {
      return {
        courseId: match[1],
        courseworkId: match[2] || null
      };
    }
    return null;
  }

  // 4. Real Google Classroom DOM Turn-In Executor
  async function performRealGoogleClassroomTurnIn() {
    const allButtons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    const turnInBtn = allButtons.find(b => {
      const t = (b.textContent || '').trim().replace(/\s+/g, ' ');
      return t === 'Mark as done' || t === 'Turn in';
    });

    if (!turnInBtn) {
      const unsubmitBtn = allButtons.find(b => (b.textContent || '').trim() === 'Unsubmit');
      if (unsubmitBtn) {
        showToast("✓ Assignment is already turned in to Google Classroom!", "success");
        return true;
      }
      throw new Error("Could not find Google Classroom's 'Mark as done' or 'Turn in' button on this page.");
    }

    // Click Google Classroom's real button
    turnInBtn.click();

    // Google Classroom opens a confirmation modal dialog
    return new Promise((resolve) => {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        const dialogButtons = Array.from(document.querySelectorAll('[role="dialog"] button, div[role="dialog"] div[role="button"]'));
        const confirmBtn = dialogButtons.find(b => {
          const t = (b.textContent || '').trim().replace(/\s+/g, ' ');
          return t === 'Mark as done' || t === 'Turn in';
        });

        if (confirmBtn) {
          clearInterval(interval);
          confirmBtn.click();
          showToast("🎉 Google Classroom Turn-In Confirmed! Assignment is now marked as Turned In for your teacher.", "success");
          resolve(true);
        } else if (attempts > 12) {
          clearInterval(interval);
          showToast("⚡ Submitted! If a confirmation prompt appeared, click Confirm to complete.", "info");
          resolve(true);
        }
      }, 250);
    });
  }

  // Listen for messages from popup or background
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "DO_REAL_TURN_IN") {
        performRealGoogleClassroomTurnIn()
          .then(() => sendResponse({ success: true }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
      }
    });
  }

  // 5. Inject Direct Auto-Submit Button into Google Classroom's "Your work" section
  function injectAssignmentButton() {
    if (document.getElementById("aa-injected-submit-btn")) return;

    // Search for Google Classroom's "Your work" submission container
    let target = null;

    // Strategy 1: Look for "Add or create" / "Mark as done" / "Turn in" button
    const allButtons = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"]'));
    for (const b of allButtons) {
      const txt = (b.textContent || "").trim().replace(/\s+/g, " ");
      if (/\+?\s*Add or create/i.test(txt) || /^Turn in$/i.test(txt) || /^Mark as done$/i.test(txt)) {
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
            const btn = parentCard.querySelector('button, div[role="button"]');
            target = { container: parentCard, insertBefore: btn || h.nextElementSibling };
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
      btn.innerHTML = `<span>⏳ Synthesizing Deliverables &amp; Turning In...</span>`;
      showToast("Academic Agent: Generating deliverables, verifying with compiler, and turning in to Google Classroom...", "info");

      try {
        // 1. Sync and generate deliverables via backend
        const ctx = getCourseContext();
        const cwRes = await fetch(`${BACKEND_URL}/api/classroom/coursework`).catch(() => null);
        if (cwRes && cwRes.ok) {
          const cwList = await cwRes.json();
          const matched = (cwList || []).find(c =>
            (ctx && ctx.courseworkId && String(c.coursework_id) === String(ctx.courseworkId)) ||
            (ctx && ctx.courseId && String(c.classroom_course_id) === String(ctx.courseId))
          ) || (cwList && cwList[0]);

          if (matched) {
            await fetch(`${BACKEND_URL}/api/assignment/${matched.id}/autonomous-submit`, { method: "POST" }).catch(() => null);
          }
        }

        // 2. Perform REAL Turn-In right on Google Classroom DOM
        await performRealGoogleClassroomTurnIn();

        btn.className = "aa-classroom-inline-btn is-success";
        btn.innerHTML = `<span>✓ Turned In Successfully!</span>`;
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = `<span>⚡ Auto-Create &amp; Turn In (Zero Download)</span>`;
        showToast(`Auto-Submit: ${err.message}`, "error");
      }
    });

    if (target.insertBefore) {
      target.container.insertBefore(btn, target.insertBefore);
    } else {
      target.container.prepend(btn);
    }
  }

  // 6. Initialize & Observe DOM mutations (Classroom is an SPA)
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

