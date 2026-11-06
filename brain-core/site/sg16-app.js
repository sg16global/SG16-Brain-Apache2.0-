// SG16 — registers the service worker that makes mistralbrain.com an
// installable app (owner request 2026-10-18). The manifest is linked from
// every page's head; sw.js only supplies the offline screen.
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () {});
  });
})();
