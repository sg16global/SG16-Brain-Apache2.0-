// SG16 — "No account, no login" notice on the subscription page (owner request 2026-10-22).
// Updated 2026-11-06 (owner request): visitors can now have an account (email
// code, see sg16-account.js); paying still needs none, and a signed-in
// visitor's pass is kept with the account.
//
// Visitors pay and get a pass without signing in, and asked how that works.
// This box, placed right above the CURRENT ENTITLEMENT card, explains it: the
// pass is stored in the browser that paid, SAVE MY PASS / RESTORE PASS FROM
// FILE move it to another device, and the pass file must be kept private.
// The page itself is untouched; a MutationObserver puts the box back
// whenever React renders the page again.
(function () {
  "use strict";
  var ID = "sg16-passinfo";

  var CSS =
    "#sg16-passinfo{padding:16px 18px;border:1px solid rgba(250,204,21,.55);border-radius:14px;background:linear-gradient(135deg,rgba(250,204,21,.10),rgba(34,224,140,.06));box-shadow:0 0 24px rgba(250,204,21,.12)}" +
    "#sg16-passinfo .p-title{display:flex;align-items:center;gap:10px;color:#facc15;font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}" +
    "#sg16-passinfo .p-title svg{width:18px;height:18px;flex:none}" +
    "#sg16-passinfo ol{margin:12px 0 0;padding:0;list-style:none;display:grid;gap:8px}" +
    "#sg16-passinfo li{display:flex;gap:10px;color:#e2e8f0;font-size:12px;line-height:1.6}" +
    "#sg16-passinfo li b{color:#fff}" +
    "#sg16-passinfo .p-n{flex:none;width:20px;height:20px;border-radius:999px;border:1px solid rgba(34,224,140,.6);color:#22e08c;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px}" +
    "#sg16-passinfo .p-warn{margin-top:12px;padding:8px 12px;border-radius:10px;background:rgba(239,68,68,.10);border:1px solid rgba(239,68,68,.35);color:#fda4af;font-size:11px;line-height:1.6}";

  var KEY =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3"/><path d="M16 7l3 3"/><path d="M18 5l2 2"/></svg>';

  var STEPS = [
    "<b>No account needed to pay.</b> Choose a pass and pay — the pass turns on automatically in this browser (Dodo Payments only emails you a receipt).",
    "<b>Signed in? Your pass follows you.</b> When you are signed in (My Domain), your pass is kept with your account and works on every device you sign in on.",
    "<b>Not signed in, and using another phone or computer, or clearing your browser?</b> Press <b>SAVE MY PASS</b> first and keep the file. On the other device, press <b>RESTORE PASS FROM FILE</b>.",
  ];

  function onSubscription() {
    return /^\/subscription\/?$/.test(location.pathname);
  }

  function addStyle() {
    if (document.getElementById("sg16-passinfo-style")) return;
    var st = document.createElement("style");
    st.id = "sg16-passinfo-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // the CURRENT ENTITLEMENT card: the child of the page's content column
  // (the max-w-[1200px] container) that holds that heading
  function anchor() {
    var heads = document.querySelectorAll("h2");
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].textContent.trim() !== "CURRENT ENTITLEMENT") continue;
      var el = heads[i];
      while (el.parentElement && String(el.parentElement.className || "").indexOf("max-w-[1200px]") === -1) el = el.parentElement;
      return el.parentElement ? el : null;
    }
    return null;
  }

  function build() {
    var box = document.createElement("section");
    box.id = ID;
    box.className = "font-mono2";
    box.setAttribute("aria-label", "How your pass works");
    var html = '<div class="p-title font-display">' + KEY + "<span>How your pass works</span></div><ol>";
    for (var i = 0; i < STEPS.length; i++) {
      html += '<li><span class="p-n">' + (i + 1) + "</span><span>" + STEPS[i] + "</span></li>";
    }
    html += "</ol>";
    html += '<div class="p-warn">Keep your pass file private: anyone who has it can use your pass until it expires.</div>';
    box.innerHTML = html;
    return box;
  }

  // React marks a node with __reactFiber$… once it has hydrated it. Adding the
  // box before that is a hydration mismatch (React #418): React then throws
  // the server HTML away and re-renders the page. So wait for hydration
  // (8 s at most).
  function hydrated(el) {
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) if (keys[i].indexOf("__reactFiber") === 0) return true;
    return false;
  }
  var started = Date.now();

  function place() {
    var old = document.getElementById(ID);
    if (!onSubscription()) {
      if (old) old.remove();
      return;
    }
    var a = anchor();
    if (!a) return;
    if (!hydrated(a.parentElement) && Date.now() - started < 8000) return;
    if (old && old.nextElementSibling === a) return;
    if (old) old.remove();
    addStyle();
    a.parentElement.insertBefore(build(), a);
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
    // hydration adds no DOM nodes, so also re-check a few times until placed
    var tries = 0;
    var t = setInterval(function () {
      place();
      if (document.getElementById(ID) || !onSubscription() || ++tries > 40) clearInterval(t);
    }, 250);
    place();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
