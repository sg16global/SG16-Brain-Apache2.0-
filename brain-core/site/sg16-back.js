// SG16 — "Back" button on inner pages (owner request 2026-10-18).
//
// Every inner page (My Files, History, Chat, Services, ...) opens with the
// shared PageHeader block. This adds a small "← Back" button above its
// title that steps back one page at a time, like the browser's back
// button. When the visitor arrived on this page from outside the site
// (no earlier page of ours in this tab), it goes to the homepage instead,
// so Back never leaves mistralbrain.com. The homepage has no PageHeader,
// so it gets no button.
(function () {
  "use strict";
  var KEY = "sg16-pages-seen";
  var lastPath = null;

  function seen() {
    try { return parseInt(sessionStorage.getItem(KEY) || "0", 10) || 0; } catch (e) { return 0; }
  }
  // count the pages of ours this tab has shown; client-side navigation
  // changes the path without a reload, so count path changes too
  // (a reload of the same page is not a new page)
  function track() {
    var p = location.pathname;
    if (p === lastPath) return;
    lastPath = p;
    try {
      if (sessionStorage.getItem(KEY + "-last") === p) return;
      sessionStorage.setItem(KEY + "-last", p);
      sessionStorage.setItem(KEY, String(seen() + 1));
    } catch (e) {}
  }

  var CSS =
    ".sg16-back{display:inline-flex;align-items:center;gap:8px;margin-bottom:14px;padding:7px 14px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer}" +
    ".sg16-back svg{width:15px;height:15px;flex:none}";

  function addStyle() {
    if (document.getElementById("sg16-back-style")) return;
    var st = document.createElement("style");
    st.id = "sg16-back-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function goBack() {
    // more than this page seen in this tab: the previous page is ours
    if (seen() > 1 && history.length > 1) history.back();
    else location.href = "/";
  }

  function build() {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "sg16-back btn-ghost";
    b.setAttribute("aria-label", "Back to the previous page");
    b.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>Back';
    b.addEventListener("click", goBack);
    return b;
  }

  // React marks a node with __reactFiber$… once it has hydrated it.
  function hydrated(el) {
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) if (keys[i].indexOf("__reactFiber") === 0) return true;
    return false;
  }

  var started = Date.now();
  function place() {
    track();
    var heads = document.querySelectorAll("main .border-red-500\\/25.from-red-950\\/40 > .z-10");
    for (var i = 0; i < heads.length; i++) {
      var h1 = heads[i].querySelector("h1");
      var box = h1 && h1.parentElement;
      if (!box || box.querySelector(":scope > .sg16-back")) continue;
      if (!hydrated(box) && Date.now() - started < 8000) continue;
      addStyle();
      box.insertBefore(build(), box.firstChild);
    }
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      place();
    });
  }

  function start() {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    var tries = 0;
    var t = setInterval(function () {
      place();
      if (++tries > 40) clearInterval(t);
    }, 250);
    place();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
