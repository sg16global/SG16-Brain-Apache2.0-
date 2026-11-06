// SG16 — "Registered company" badge + certificate popup (owner request 2026-10-19).
//
// Adds a small badge under the SAIF TECH GLOBAL LLC block in the footer of
// every page. Clicking it opens a popup with the company's real Certificate
// of Organization (State of New Mexico, filing #0008128993) as a view-only
// web copy: the watermark is baked into the image, there is no download
// button, and right-click / drag / long-press saving is blocked. No page can
// stop a screenshot — so the popup also links to the State's own public
// business search, where anyone can check the record for themselves.
(function () {
  "use strict";
  var ID = "sg16-cert-badge";
  var MODAL = "sg16-cert-modal";
  var FILING = "0008128993";
  var IMG = "/images/sg16-certificate.webp";
  // The State business search itself (enterprise.sos.nm.gov) answers 403 outside
  // the US; the Business Services page opens worldwide and links to it.
  var VERIFY_URL = "https://www.sos.nm.gov/business-services/";
  var ADDRESS = "8206 Louisiana Blvd NE, Ste A #10595, Albuquerque, NM 87113, USA";

  var CSS =
    "#sg16-cert-badge{margin-top:10px;display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid rgba(34,224,140,.45);border-radius:999px;background:rgba(34,224,140,.08);color:#22e08c;font-size:9px;letter-spacing:.14em;font-weight:700;cursor:pointer;text-transform:uppercase;transition:background .2s,border-color .2s}" +
    "#sg16-cert-badge:hover,#sg16-cert-badge:focus-visible{background:rgba(34,224,140,.16);border-color:#22e08c;outline:none}" +
    "#sg16-cert-badge svg{width:13px;height:13px;flex:none}" +
    "#sg16-cert-modal{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(2,4,8,.82);backdrop-filter:blur(4px)}" +
    "#sg16-cert-modal .c-box{width:min(760px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;border:1px solid rgba(239,68,68,.45);border-radius:16px;background:#070a10;box-shadow:0 0 40px rgba(239,68,68,.25);overflow:hidden}" +
    "#sg16-cert-modal .c-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.08)}" +
    "#sg16-cert-modal .c-title{color:#fff;font-size:15px;font-weight:800;letter-spacing:.04em}" +
    "#sg16-cert-modal .c-sub{margin-top:4px;color:#22e08c;font-size:10px;letter-spacing:.12em}" +
    "#sg16-cert-modal .c-close{flex:none;width:32px;height:32px;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:transparent;color:#cbd5e1;font-size:18px;line-height:1;cursor:pointer}" +
    "#sg16-cert-modal .c-close:hover,#sg16-cert-modal .c-close:focus-visible{border-color:#ef4444;color:#fff;outline:none}" +
    "#sg16-cert-modal .c-bar{padding:8px 18px;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(239,68,68,.07);color:#fda4af;font-size:9px;letter-spacing:.14em}" +
    "#sg16-cert-modal .c-view{position:relative;flex:1;overflow:auto;padding:16px;display:flex;justify-content:center;background:#0b0f17}" +
    "#sg16-cert-modal .c-frame{position:relative;width:100%;max-width:560px;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}" +
    "#sg16-cert-modal .c-frame img{display:block;width:100%;height:auto;border-radius:6px;pointer-events:none}" +
    "#sg16-cert-modal .c-shield{position:absolute;inset:0}" +
    "#sg16-cert-modal .c-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px;border-top:1px solid rgba(255,255,255,.08)}" +
    "#sg16-cert-modal .c-addr{color:#94a3b8;font-size:10px;letter-spacing:.06em;line-height:1.6}" +
    "#sg16-cert-modal .c-addr b{color:#e2e8f0}" +
    "#sg16-cert-modal .c-verify{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #22e08c;border-radius:999px;color:#22e08c;font-size:10px;font-weight:700;letter-spacing:.12em;text-decoration:none;white-space:nowrap}" +
    "#sg16-cert-modal .c-verify:hover,#sg16-cert-modal .c-verify:focus-visible{background:rgba(34,224,140,.12);outline:none}" +
    "#sg16-cert-modal .c-hint{width:100%;color:#64748b;font-size:9px;letter-spacing:.1em}";

  var CHECK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 2l7 3v6c0 5-3.5 9-7 11-3.5-2-7-6-7-11V5z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>';

  function addStyle() {
    if (document.getElementById("sg16-cert-style")) return;
    var st = document.createElement("style");
    st.id = "sg16-cert-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  var lastFocus = null;

  function close() {
    var m = document.getElementById(MODAL);
    if (m) m.remove();
    document.removeEventListener("keydown", onKey, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function block(e) {
    e.preventDefault();
  }

  function open() {
    if (document.getElementById(MODAL)) return;
    lastFocus = document.activeElement;
    var m = document.createElement("div");
    m.id = MODAL;
    m.setAttribute("role", "dialog");
    m.setAttribute("aria-modal", "true");
    m.setAttribute("aria-labelledby", "sg16-cert-title");
    m.innerHTML =
      '<div class="c-box font-mono2">' +
      '<div class="c-head"><div>' +
      '<div class="c-title font-display" id="sg16-cert-title">Official Certificate — Saif Tech Global LLC</div>' +
      '<div class="c-sub">STATE OF NEW MEXICO · FILING #' + FILING + " · DOMESTIC LIMITED LIABILITY COMPANY</div>" +
      '</div><button type="button" class="c-close" aria-label="Close">×</button></div>' +
      '<div class="c-bar">PROTECTED RECORD · WATERMARKED · VIEW ONLY — NO DOWNLOAD</div>' +
      '<div class="c-view"><div class="c-frame">' +
      '<img src="' + IMG + '" alt="Certificate of Organization, State of New Mexico: Saif Tech Global LLC, filing 0008128993, effective September 10, 2026" draggable="false">' +
      '<div class="c-shield" aria-hidden="true"></div></div></div>' +
      '<div class="c-foot">' +
      '<div class="c-addr"><b>Registered address:</b> ' + ADDRESS + "</div>" +
      '<a class="c-verify" href="' + VERIFY_URL + '" target="_blank" rel="noopener noreferrer">' +
      "✓ VERIFY WITH THE STATE ↗</a>" +
      '<div class="c-hint">Check it yourself: New Mexico Secretary of State → Business Search (enterprise.sos.nm.gov) → Business ID ' + FILING + ". The State’s search may only open from the United States.</div>" +
      "</div></div>";
    m.addEventListener("click", function (e) {
      if (e.target === m) close();
    });
    m.querySelector(".c-close").addEventListener("click", close);
    var frame = m.querySelector(".c-frame");
    frame.addEventListener("contextmenu", block);
    frame.addEventListener("dragstart", block);
    document.body.appendChild(m);
    document.addEventListener("keydown", onKey, true);
    m.querySelector(".c-close").focus();
  }

  // the footer's company block (the line "SAIF TECH GLOBAL LLC")
  function anchor() {
    var foot = document.querySelector("footer");
    if (!foot) return null;
    var nodes = foot.querySelectorAll("div");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].children.length === 0 && nodes[i].textContent.trim() === "SAIF TECH GLOBAL LLC") return nodes[i].parentElement;
    }
    return null;
  }

  function place() {
    var a = anchor();
    if (!a) return;
    if (a.querySelector("#" + ID)) return;
    addStyle();
    var old = document.getElementById(ID);
    if (old) old.remove();
    var b = document.createElement("button");
    b.type = "button";
    b.id = ID;
    b.className = "font-mono2";
    b.setAttribute("aria-haspopup", "dialog");
    b.innerHTML = CHECK + "<span>Registered company · NM #" + FILING + " · View certificate</span>";
    b.addEventListener("click", open);
    a.appendChild(b);
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
    place();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
