// SG16 — "Work with Sovereign SG16 Brain" panel (owner request 2026-10-18).
//
// Replaces the homepage's "Friend Engine · This Device" panel, which the
// owner says no longer describes the product. The original React section
// (#friend-engine) is hidden by the design stylesheet; once React has
// hydrated it, this panel is placed right after it, and a MutationObserver
// puts it back whenever the homepage renders again (client-side navigation).
// Every claim matches what brain-core does today.
(function () {
  "use strict";
  var ID = "sg16-work";

  var CSS =
    "#sg16-work{--w-cyan:#49e6ff;--w-gold:#ffd166;--w-text:#dce6f2;--w-muted:#9aa6b8}" +
    "#sg16-work .w-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 16px;padding:22px 20px 16px;border-bottom:1px solid rgba(255,52,64,.28);position:relative}" +
    "#sg16-work .w-title{margin:0;font-family:var(--font-display);text-transform:uppercase;letter-spacing:.14em;font-size:clamp(20px,3.2vw,30px);line-height:1.2;text-align:center;text-wrap:balance;" +
    "color:var(--w-cyan);text-shadow:0 0 14px rgba(73,230,255,.55)}" +
    "#sg16-work .w-badge{display:inline-flex;align-items:center;gap:8px;font-family:var(--font-mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--w-cyan);" +
    "border:1px solid rgba(73,230,255,.4);background:rgba(73,230,255,.06);border-radius:7px;padding:6px 12px}" +
    "#sg16-work .w-body{padding:18px 20px 22px;display:grid;gap:18px}" +
    "#sg16-work .w-lede{margin:0;text-align:center;font-family:var(--font-mono);font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--w-muted);line-height:1.7}" +
    "#sg16-work .w-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}" +
    "#sg16-work .w-card{display:grid;align-content:start;gap:8px;padding:18px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(160deg,rgba(14,18,26,.9),rgba(7,9,14,.92))}" +
    "#sg16-work .w-card.api{border-color:rgba(73,230,255,.45);background:linear-gradient(160deg,rgba(9,40,52,.55),rgba(7,12,18,.92));box-shadow:0 0 22px rgba(73,230,255,.12)}" +
    "#sg16-work .w-kicker{font-family:var(--font-mono);font-size:11.5px;letter-spacing:.26em;text-transform:uppercase;color:var(--w-gold)}" +
    "#sg16-work .w-card.api .w-kicker{color:var(--w-cyan)}" +
    "#sg16-work .w-name{margin:0;font-family:var(--font-display);font-size:clamp(18px,2.2vw,21px);line-height:1.25;color:#fff}" +
    "#sg16-work .w-text{margin:0;font-family:var(--font-ui);font-size:15.5px;line-height:1.6;color:var(--w-text)}" +
    "#sg16-work .w-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px}" +
    "#sg16-work .w-flow{font-family:var(--font-mono);font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--w-muted)}" +
    "#sg16-work .w-actions{display:flex;flex-wrap:wrap;gap:10px}" +
    "#sg16-work .w-actions a{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;font-size:13px;text-decoration:none}" +
    "@media (max-width:640px){#sg16-work .w-grid{grid-template-columns:minmax(0,1fr)}#sg16-work .w-body{padding:16px 12px 18px}#sg16-work .w-lede,#sg16-work .w-flow{letter-spacing:.14em}" +
    "#sg16-work .w-foot{justify-content:center;text-align:center}}";

  var HTML =
    '<header class="w-head">' +
    '<h2 class="w-title">Work with Sovereign SG16 Brain</h2>' +
    '<span class="w-badge">Self-hosted · SG16 core</span>' +
    "</header>" +
    '<div class="w-body">' +
    '<p class="w-lede">One brain for your chat, your code and your projects</p>' +
    '<div class="w-grid">' +
    '<article class="w-card"><span class="w-kicker">Chat</span><h3 class="w-name">Talk in your own language</h3>' +
    '<p class="w-text">Write in any language and script — Bengali, Hindi, English, Arabic, Chinese, or a mix like Banglish. SG16 Brain answers you, and tells you honestly when it does not know.</p></article>' +
    '<article class="w-card"><span class="w-kicker">Coding</span><h3 class="w-name">Write, explain and fix code</h3>' +
    '<p class="w-text">Describe what you need or paste your code. SG16 Brain writes it, explains it line by line and helps you find the bug.</p></article>' +
    '<article class="w-card"><span class="w-kicker">Checked answers</span><h3 class="w-name">Verified before you see it</h3>' +
    '<p class="w-text">Every answer passes the SG16 core’s checks before it reaches you. Questions are answered one at a time in a fair queue, on SG16’s own model server.</p></article>' +
    '<article class="w-card api"><span class="w-kicker">API · Connect</span><h3 class="w-name">Connect your own projects</h3>' +
    '<p class="w-text">Your apps, websites and services can use the same brain through the SG16 API with a project key. Each project gets its own rate limit.</p></article>' +
    "</div>" +
    '<div class="w-foot">' +
    '<span class="w-flow">Ask → SG16 core checks → Answer</span>' +
    '<div class="w-actions"><a class="btn-red" href="/chat/">Start chat</a><a class="btn-ghost" href="/api-access/">API access</a></div>' +
    "</div>" +
    "</div>";

  function addStyle() {
    if (document.getElementById("sg16-work-style")) return;
    var st = document.createElement("style");
    st.id = "sg16-work-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function build() {
    var s = document.createElement("section");
    s.id = ID;
    s.className = "panel corner flex flex-col";
    s.setAttribute("aria-label", "Work with Sovereign SG16 Brain");
    s.innerHTML = HTML;
    return s;
  }

  // React marks a node with __reactFiber$… once it has hydrated it.
  function hydrated(el) {
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) if (keys[i].indexOf("__reactFiber") === 0) return true;
    return false;
  }

  var started = Date.now();
  function place() {
    var f = document.getElementById("friend-engine");
    if (!f) return;
    if (!hydrated(f) && Date.now() - started < 8000) return;
    var s = document.getElementById(ID);
    if (s && s.previousElementSibling === f) return;
    addStyle();
    f.after(s || build());
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
      if (document.getElementById(ID) || ++tries > 40) clearInterval(t);
    }, 250);
    place();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
