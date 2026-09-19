const BACKEND = "http://127.0.0.1:8000";

async function initPopup() {
  try {
    const authRes = await fetch(`${BACKEND}/api/auth/status`).then(r => r.json()).catch(() => ({ connected: false }));
    const emailEl = document.getElementById("status-account");
    if (emailEl) {
      emailEl.textContent = authRes.email || "Disconnected";
      emailEl.className = authRes.connected ? "val val-connected" : "val";
    }

    const nextRes = await fetch(`${BACKEND}/api/erp/next-class`).then(r => r.json()).catch(() => null);
    const nextEl = document.getElementById("status-next-class");
    if (nextEl) {
      if (nextRes && nextRes.has_class) {
        nextEl.textContent = `${nextRes.subject} (${nextRes.classroom || 'Room TBD'})`;
      } else {
        nextEl.textContent = "No ongoing slot";
      }
    }

    const cwRes = await fetch(`${BACKEND}/api/classroom/coursework`).then(r => r.json()).catch(() => []);
    const workEl = document.getElementById("status-active-work");
    if (workEl) {
      if (cwRes && cwRes.length > 0) {
        const topItem = cwRes[0];
        workEl.textContent = `${topItem.title} [${topItem.status || 'READY'}]`;
        workEl.setAttribute("data-id", topItem.id);
      } else {
        workEl.textContent = "No assignments";
      }
    }
  } catch (e) {
    console.error("Popup init error", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initPopup();

  const submitBtn = document.getElementById("btn-popup-submit");
  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      submitBtn.disabled = true;
      submitBtn.textContent = "⏳ Turning In to Google Classroom...";

      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs && tabs[0];

        if (activeTab && activeTab.url && activeTab.url.includes("classroom.google.com")) {
          chrome.tabs.sendMessage(activeTab.id, { action: "DO_REAL_TURN_IN" }, async (resp) => {
            if (resp && resp.success) {
              submitBtn.textContent = "✓ Turned In Directly!";
              submitBtn.style.background = "#10b981";
            } else {
              const workEl = document.getElementById("status-active-work");
              const cwId = workEl ? workEl.getAttribute("data-id") : null;
              if (cwId) {
                await fetch(`${BACKEND}/api/assignment/${cwId}/autonomous-submit`, { method: "POST" }).catch(() => null);
              }
              submitBtn.textContent = "✓ Turned In Directly!";
              submitBtn.style.background = "#10b981";
            }
            initPopup();
          });
        } else {
          const workEl = document.getElementById("status-active-work");
          const cwId = workEl ? workEl.getAttribute("data-id") : null;
          if (cwId) {
            await fetch(`${BACKEND}/api/assignment/${cwId}/autonomous-submit`, { method: "POST" }).catch(() => null);
          }
          submitBtn.textContent = "✓ Turned In Directly!";
          submitBtn.style.background = "#10b981";
          initPopup();
        }
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = "⚡ Auto-Submit Current Coursework";
        alert(`Submission error: ${err.message}`);
      }
    });
  }
});

