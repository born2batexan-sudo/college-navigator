// Service worker. Keeps startup logic minimal: set a default API base URL
// on first install, and make the toolbar icon open the side panel (rather
// than a popup) so ASK / GUIDE / TRACK stay open while the student works.

const DEFAULT_APP_BASE_URL = "http://localhost:3000";

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get("appBaseUrl");
  if (!existing.appBaseUrl) {
    await chrome.storage.local.set({ appBaseUrl: DEFAULT_APP_BASE_URL });
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // setPanelBehavior can reject on browsers where sidePanel isn't available yet — non-fatal.
});
