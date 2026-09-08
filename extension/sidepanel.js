let currentContext = null;
let selectedActionId = null;

function $(sel) {
  return document.querySelector(sel);
}

function switchTab(tab) {
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["track", "guide", "ask"].forEach((t) => ($(`#panel-${t}`).style.display = t === tab ? "block" : "none"));
}

document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

function priorityPillClass(p) {
  return { urgent: "pill-urgent", high: "pill-high", normal: "pill-normal", low: "pill-low" }[p] || "pill-normal";
}

function renderTrack() {
  const panel = $("#panel-track");
  if (!currentContext || !currentContext.matched) {
    panel.innerHTML = `<div class="empty">This page isn't on a school College Navigator currently tracks.<br/><br/>Try a page on ua.edu.</div>`;
    return;
  }
  if (currentContext.actions.length === 0) {
    panel.innerHTML = `<div class="empty">Nothing open for ${currentContext.institution.name} right now.</div>`;
    return;
  }
  panel.innerHTML = currentContext.actions
    .map(
      (a) => `
    <div class="action-item" data-action-id="${a.id}">
      <span class="pill ${priorityPillClass(a.priority)}">${a.priority}</span>
      <strong>${a.guidance ? a.guidance.what : a.title}</strong>
      <div class="muted" style="margin-top:4px;">${a.checkpointCode} &middot; ${a.state.replace("_", " ")}</div>
    </div>`
    )
    .join("");
  panel.querySelectorAll(".action-item").forEach((el) =>
    el.addEventListener("click", () => {
      selectedActionId = el.dataset.actionId;
      renderGuide();
      switchTab("guide");
    })
  );
}

function renderGuide() {
  const panel = $("#panel-guide");
  const action = currentContext?.actions.find((a) => a.id === selectedActionId);
  if (!action) {
    panel.innerHTML = `<div class="empty">Select an item in TRACK to see WHAT / WHEN / WHY / HOW / CONSEQUENCE.</div>`;
    return;
  }
  if (!action.guidance) {
    panel.innerHTML = `<div class="empty">No plain-language guidance yet for ${action.checkpointCode} — this checkpoint is still marked "not yet researched."</div>`;
    return;
  }
  const g = action.guidance;
  panel.innerHTML = ["what", "when", "why", "how", "consequence"]
    .map(
      (k) => `
    <div class="field">
      <div class="field-label">${k === "consequence" ? "If you miss it" : k}</div>
      <div>${g[k]}</div>
    </div>`
    )
    .join("");
}

async function loadContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;

  const { appBaseUrl } = await chrome.storage.local.get("appBaseUrl");
  const base = appBaseUrl || "http://localhost:3000";

  try {
    const res = await fetch(`${base}/api/companion/context?url=${encodeURIComponent(tab.url)}`);
    currentContext = await res.json();
  } catch (err) {
    currentContext = { matched: false };
    console.debug("[College Navigator] context fetch failed:", err);
  }

  if (currentContext.matched) {
    $("#inst-name").textContent = currentContext.institution.name;
    $("#inst-status").textContent = `${currentContext.institution.coverageStatus} · ${currentContext.institution.coveragePct}% of the 144-point checklist verified`;
  } else {
    $("#inst-name").textContent = "College Navigator";
    $("#inst-status").textContent = "Navigate to a page on a tracked school's site to begin.";
  }

  renderTrack();
  renderGuide();
}

$("#ask-submit").addEventListener("click", () => {
  $("#ask-note").textContent =
    "ASK mode isn't wired to a live assistant in this skeleton — see the README for how the full product grounds it in the same verified rules shown in TRACK/GUIDE.";
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "OBSERVED_UPDATE") {
    loadContext(); // an observation just advanced an action's state — refresh
  }
});

chrome.tabs.onActivated.addListener(loadContext);
chrome.tabs.onUpdated.addListener((_, changeInfo) => {
  if (changeInfo.status === "complete") loadContext();
});

loadContext();
