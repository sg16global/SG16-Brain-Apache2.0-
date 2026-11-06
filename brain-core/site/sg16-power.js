// SG16 — BRAIN POWER switch on /admin (owner request 2026-11-06).
//
// Operator-only. One switch: ON = the SG16 Brain answers (website visitors,
// pass holders and API projects), OFF = it answers nobody until it is turned
// on again. The switch lives in the Worker's global queue (GET/POST
// /api/admin/brain-power), so it takes effect everywhere at once and survives
// deploys. Placed right under the admin console's top banner and put back by
// a MutationObserver whenever React renders the page again. Visitors never
// see it: the script does nothing outside /admin, and the endpoint answers
// only the signed-in operator.
(function () {
  "use strict";
  var ID = "sg16-power";
  var REFRESH_MS = 30000;

  var CSS =
    "#" + ID + "{display:grid;grid-template-columns:1fr auto;align-items:center;gap:18px}" +
    "#" + ID + " h3{margin:0}" +
    "#" + ID + " .pw-text{margin:6px 0 0;font-size:11px;line-height:1.6;letter-spacing:.08em;color:#cbd5e1}" +
    "#" + ID + " .pw-state{font-weight:900;letter-spacing:.16em}" +
    "#" + ID + " .pw-on{color:#22e08c}" +
    "#" + ID + " .pw-off{color:#ff3b4c}" +
    "#" + ID + " .pw-err{margin:6px 0 0;font-size:10px;letter-spacing:.12em;color:#ff8a3d}" +
    "#" + ID + " .pw-switch{position:relative;width:132px;height:52px;padding:0;border-radius:999px;cursor:pointer;" +
    "border:1px solid rgba(255,59,76,.6);background:rgba(255,59,76,.14);transition:background .25s,border-color .25s,box-shadow .25s}" +
    "#" + ID + " .pw-switch[aria-checked=true]{border-color:rgba(34,224,140,.7);background:rgba(34,224,140,.16);box-shadow:0 0 22px rgba(34,224,140,.35)}" +
    "#" + ID + " .pw-switch:focus-visible{outline:2px solid #fff;outline-offset:3px}" +
    "#" + ID + " .pw-switch:disabled{cursor:wait;opacity:.6}" +
    "#" + ID + " .pw-knob{position:absolute;top:5px;left:5px;width:40px;height:40px;border-radius:50%;background:#ff3b4c;box-shadow:0 0 14px rgba(255,59,76,.8);transition:left .25s,background .25s,box-shadow .25s}" +
    "#" + ID + " .pw-switch[aria-checked=true] .pw-knob{left:85px;background:#22e08c;box-shadow:0 0 14px rgba(34,224,140,.9)}" +
    "#" + ID + " .pw-label{position:absolute;top:50%;transform:translateY(-50%);font-size:13px;font-weight:900;letter-spacing:.18em}" +
    "#" + ID + " .pw-switch[aria-checked=true] .pw-label{left:20px;color:#22e08c}" +
    "#" + ID + " .pw-switch[aria-checked=false] .pw-label{right:22px;color:#ff6b78}" +
    "@media (max-width:640px){#" + ID + "{grid-template-columns:1fr}}" +
    "@media (prefers-reduced-motion:reduce){#" + ID + " .pw-knob,#" + ID + " .pw-switch{transition:none}}";

  var on = null;        // null = not loaded yet
  var busy = false;
  var errorText = "";
  var denied = false;
  var timer = null;

  function onAdmin() {
    return /^\/admin\/?$/.test(location.pathname);
  }

  function token() {
    try {
      var raw = localStorage.getItem("sg16/identity");
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed.token === "string" ? parsed.token : "";
    } catch (e) {
      return "";
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function addStyle() {
    if (document.getElementById(ID + "-style")) return;
    var st = document.createElement("style");
    st.id = ID + "-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function render(box) {
    var known = on !== null;
    var text = !known
      ? "Checking the switch…"
      : on
        ? '<span class="pw-state pw-on">THE BRAIN IS ON</span> — it answers website visitors, pass holders and API projects.'
        : '<span class="pw-state pw-off">THE BRAIN IS OFF</span> — nobody gets answers until you switch it on. Visitors see a short "switched off" note.';
    box.innerHTML =
      "<div>" +
      '<h3 class="flex items-center gap-2 font-display text-[13px] font-black tracking-widest text-white">' +
      '<svg class="h-4 w-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></svg>' +
      " BRAIN POWER</h3>" +
      '<p class="pw-text font-mono2">' + text + "</p>" +
      (errorText ? '<p class="pw-err font-mono2">' + esc(errorText) + "</p>" : "") +
      "</div>" +
      '<button type="button" class="pw-switch font-display" role="switch" aria-label="SG16 Brain power" aria-checked="' +
      (on ? "true" : "false") + '"' + (busy || !known ? " disabled" : "") + ">" +
      '<span class="pw-label">' + (on ? "ON" : "OFF") + '</span><span class="pw-knob" aria-hidden="true"></span></button>';
  }

  function rerender() {
    var box = document.getElementById(ID);
    if (box) render(box);
  }

  function request(method, body) {
    return fetch("/api/admin/brain-power", {
      method: method,
      headers: { authorization: "Bearer " + token(), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) {
        denied = true;
        var b = document.getElementById(ID);
        if (b) b.remove();
        return null;
      }
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
        return d;
      });
    });
  }

  function load() {
    if (!document.getElementById(ID) || !onAdmin() || document.hidden || busy || !token()) return;
    request("GET")
      .then(function (d) {
        if (!d) return;
        on = d.on === true;
        errorText = "";
        rerender();
      })
      .catch(function () {
        errorText = "COULD NOT READ THE SWITCH — TRY AGAIN.";
        rerender();
      });
  }

  function flip() {
    if (busy || on === null) return;
    var want = !on;
    if (!want && !window.confirm("Switch the SG16 Brain OFF? Nobody (visitors, pass holders, API projects) gets answers until you switch it on again.")) return;
    busy = true;
    rerender();
    request("POST", { on: want })
      .then(function (d) {
        if (!d) return;
        on = d.on === true;
        errorText = "";
      })
      .catch(function (e) {
        errorText = "SWITCH NOT CHANGED: " + String(e && e.message ? e.message : e).toUpperCase();
      })
      .then(function () {
        busy = false;
        rerender();
      });
  }

  // the admin console's top banner ("… OPERATOR MODE")
  function anchor() {
    var heads = document.querySelectorAll("section.panel h2");
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].textContent.indexOf("OPERATOR MODE") !== -1) return heads[i].closest("section.panel");
    }
    return null;
  }

  function place() {
    if (!onAdmin() || denied || !token()) return;
    var a = anchor();
    if (!a) return;
    var box = document.getElementById(ID);
    if (box && box.previousElementSibling === a) return;
    addStyle();
    if (!box) {
      box = document.createElement("section");
      box.id = ID;
      box.className = "panel corner p-5";
      box.setAttribute("aria-label", "Brain power");
      box.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest(".pw-switch") : null;
        if (b && !b.disabled) flip();
      });
      render(box);
    }
    a.after(box);
    if (on === null) load();
    if (!timer) timer = setInterval(load, REFRESH_MS);
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
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) load();
    });
    place();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
