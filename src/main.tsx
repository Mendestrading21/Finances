import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { UPDATE_READY_EVENT } from "./swUpdateEvent";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Cache only the built application shell. Financial data never enters the service-worker cache.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(new URL("./sw.js", document.baseURI))
      .then((registration) => {
        // An installed iPhone app resumed from the background never navigates, so the browser
        // never re-checks sw.js on its own: check whenever the app comes back to the foreground.
        let lastCheck = Date.now();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState !== "visible") return;
          if (Date.now() - lastCheck < 60_000) return;
          lastCheck = Date.now();
          registration.update().catch(() => {});
        });
      })
      .catch(() => {
        // Online use still works when the browser does not permit offline installation.
      });
  });
  // sw.js calls skipWaiting()/clients.claim() so a newly deployed shell activates without
  // waiting for every open tab to close first; App.tsx listens for this event and offers a
  // "Recharger" notice instead of reloading here directly — the vault only ever lives in memory
  // (vault.ts), so a reload always re-locks it and drops any unsaved edit, and doing that
  // silently the moment a new version happens to land would be a surprising way to lose either.
  //
  // clients.claim() fires "controllerchange" the very first time a tab gets a controller too
  // (not only on a genuine later update) — notifying on that first event would flag an update as
  // "ready" right after a normal fresh load, which already has current content. Only notify once
  // a controller was already present and then gets replaced by a newer one.
  let hadController = navigator.serviceWorker.controller !== null;
  let notifiedForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (notifiedForUpdate) return;
    notifiedForUpdate = true;
    window.dispatchEvent(new Event(UPDATE_READY_EVENT));
  });
}
