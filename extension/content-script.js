// Runs on every matched university page (see manifest.json's
// content_scripts.matches). This is the "Observe" half of ASK / GUIDE /
// TRACK: it reads the page's own visible text — never form fields, never
// anything behind a login the extension itself performs — and reports it
// to the app, which checks it against known ObservationPatterns for that
// institution and advances the Action Ledger when a signal matches.
//
// It does not read or transmit input field values, so it cannot see
// anything the student types (including essay content, by construction —
// there's nothing here that reads a textarea).

(function () {
  async function reportPage() {
    const { appBaseUrl } = await chrome.storage.local.get("appBaseUrl");
    const base = appBaseUrl || "http://localhost:3000";

    const pageText = document.body ? document.body.innerText.slice(0, 20000) : "";
    if (!pageText) return;

    try {
      const res = await fetch(`${base}/api/companion/observe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: location.href, pageText }),
      });
      const data = await res.json();
      if (data.updates && data.updates.length > 0) {
        chrome.runtime.sendMessage({ type: "OBSERVED_UPDATE", updates: data.updates, url: location.href }).catch(() => {});
      }
    } catch (err) {
      // App unreachable (not running locally, or host_permissions not yet
      // updated for a deployed URL) — fail silently, this is best-effort.
      console.debug("[College Navigator] observe report failed:", err);
    }
  }

  // Run once on load, and again if the page mutates significantly (many of
  // these portals are SPA-like and update a status banner without a full
  // navigation).
  reportPage();
  let debounce;
  new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(reportPage, 1500);
  }).observe(document.body, { childList: true, subtree: true });
})();
