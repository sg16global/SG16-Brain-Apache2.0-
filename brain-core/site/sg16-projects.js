// SG16 — "Connected projects" box on /admin (owner request 2026-10-19).
//
// Operator-only: lists every project key with its live API status, last
// call, 24h calls, errors and average answer time, from
// GET /api/admin/project-activity (read-only; nothing new is stored). The box
// is placed right after the admin console's "Connected models" panel and put
// back by a MutationObserver whenever React renders the page again. It
// refreshes every 30 s while the page is visible. Visitors never see it:
// the script does nothing outside /admin, and the endpoint answers only the
// signed-in operator.
//
// 2026-11-06 (owner request): every key also gets the operator's switch:
// ON (works), OFF (paused, can be turned on again) and BROKEN (retired for
// good: for keys nobody uses), via POST /api/admin/project-control. Every
// working key that was called in the last 24 h shows a green signal.
(function () {
  "use strict";
  var ID = "sg16-projects";
  var REFRESH_MS = 30000;

  var CSS =
    "#sg16-projects .p-wrap{margin-top:16px;overflow-x:auto}" +
    "#sg16-projects table{width:100%;border-collapse:collapse;min-width:860px}" +
    "#sg16-projects th{text-align:left;padding:8px 10px;font-size:10px;letter-spacing:.14em;color:#8aa0bd;font-weight:600;border-bottom:1px solid rgba(255,255,255,.1);white-space:nowrap}" +
    "#sg16-projects td{padding:10px;font-size:11px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,.06);white-space:nowrap}" +
    "#sg16-projects tr:last-child td{border-bottom:0}" +
    "#sg16-projects .p-name{font-weight:800;letter-spacing:.08em;color:#fff}" +
    "#sg16-projects .p-key{color:#94a3b8}" +
    "#sg16-projects .p-num{text-align:right}" +
    "#sg16-projects .p-err{color:#ff8a3d}" +
    "#sg16-projects .p-status{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:600;letter-spacing:.14em}" +
    "#sg16-projects .p-note{margin-top:12px;font-size:10px;letter-spacing:.12em;color:#64748b}" +
    "#sg16-projects .p-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
    "#sg16-projects .p-refresh{font-size:10px;letter-spacing:.14em;color:#64748b}" +
    "#sg16-projects .p-ctl{display:inline-flex;border:1px solid rgba(255,255,255,.14);border-radius:8px;overflow:hidden}" +
    "#sg16-projects .p-ctl button{padding:5px 10px;border:0;border-left:1px solid rgba(255,255,255,.1);background:transparent;color:#94a3b8;font-size:10px;font-weight:800;letter-spacing:.12em;cursor:pointer}" +
    "#sg16-projects .p-ctl button:first-child{border-left:0}" +
    "#sg16-projects .p-ctl button:hover:not(:disabled){background:rgba(255,255,255,.06);color:#fff}" +
    "#sg16-projects .p-ctl button:disabled{cursor:default;opacity:.45}" +
    "#sg16-projects .p-ctl .is-on{background:rgba(34,224,140,.16);color:#22e08c}" +
    "#sg16-projects .p-ctl .is-off{background:rgba(148,163,184,.18);color:#e2e8f0}" +
    "#sg16-projects .p-ctl .is-broken{background:rgba(255,59,76,.18);color:#ff6b78}" +
    "#sg16-projects .p-unused{display:block;margin-top:3px;font-size:9px;letter-spacing:.12em;color:#ff8a3d}" +
    "#sg16-projects tr.p-dead td{opacity:.55}" +
    "#sg16-projects tr.p-dead td.p-keep{opacity:1}";

  // every working key called in the last 24 h is green (owner request)
  var STATUS = {
    live: { color: "#22e08c", text: "LIVE" },
    active: { color: "#22e08c", text: "ACTIVE" },
    idle: { color: "#8aa0bd", text: "IDLE" },
    never: { color: "#8aa0bd", text: "NEVER USED" },
    off: { color: "#64748b", text: "OFF" },
    broken: { color: "#ff3b4c", text: "BROKEN" },
    blocked: { color: "#ff3b4c", text: "BLOCKED" },
  };
  var busy = {}; // key id -> true while its switch is being changed

  var data = null;      // last good response
  var errorText = "";   // shown when a refresh fails
  var denied = false;   // not an operator: show nothing
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

  function ago(ts, now) {
    if (!ts) return "—";
    var s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 60) return s + " sec ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + " h ago";
    return Math.round(h / 24) + " days ago";
  }

  function speed(ms) {
    return ms === null || ms === undefined ? "—" : (ms / 1000).toFixed(1) + " s";
  }

  function addStyle() {
    if (document.getElementById("sg16-projects-style")) return;
    var st = document.createElement("style");
    st.id = "sg16-projects-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function render(box) {
    var list = data ? data.projects : [];
    var now = data ? data.now : Date.now();
    var head =
      '<div class="p-head">' +
      '<h3 class="flex items-center gap-2 font-display text-[13px] font-black tracking-widest text-white">' +
      '<svg class="h-4 w-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
      " CONNECTED PROJECTS · " + list.length + "</h3>" +
      '<span class="p-refresh font-mono2">AUTO-REFRESH 30S</span></div>';
    var body;
    if (!data && !errorText) {
      body = '<p class="p-note font-mono2">LOADING…</p>';
    } else if (list.length === 0) {
      body = '<p class="p-note font-mono2">NO PROJECT KEYS YET — CREATE ONE IN PROJECT KEYS ABOVE.</p>';
    } else {
      var rows = "";
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var st = STATUS[p.status] || STATUS.idle;
        var control = p.control || "on";
        var unused = control === "on" && (p.status === "never" || p.status === "idle");
        var lock = busy[p.id] || control === "broken" || !p.id ? " disabled" : "";
        var ctl =
          '<span class="p-ctl" role="group" aria-label="Switch for ' + esc(p.project) + '">' +
          '<button type="button" data-id="' + esc(p.id || "") + '" data-state="on"' + (control === "on" ? ' class="is-on" aria-pressed="true"' : ' aria-pressed="false"') + lock + ">ON</button>" +
          '<button type="button" data-id="' + esc(p.id || "") + '" data-state="off"' + (control === "off" ? ' class="is-off" aria-pressed="true"' : ' aria-pressed="false"') + lock + ">OFF</button>" +
          '<button type="button" data-id="' + esc(p.id || "") + '" data-state="broken"' + (control === "broken" ? ' class="is-broken" aria-pressed="true"' : ' aria-pressed="false"') + lock + ">BROKEN</button>" +
          "</span>";
        rows +=
          '<tr class="' + (control === "broken" ? "p-dead" : "") + '">' +
          '<td class="p-name font-display">' + esc(p.project.toUpperCase()) + "</td>" +
          '<td class="p-key font-mono2">…' + esc(p.last12) + "</td>" +
          '<td><span class="p-status font-mono2" style="color:' + st.color + '">' +
          '<span class="status-dot" style="background:' + st.color + ";color:" + st.color + '"></span>' + st.text + "</span>" +
          (unused ? '<span class="p-unused">UNUSED — BROKEN IT IF NOBODY NEEDS IT</span>' : "") + "</td>" +
          '<td class="font-mono2">' + ago(p.lastCall, now) + "</td>" +
          '<td class="p-num font-mono2">' + p.calls24h + "</td>" +
          '<td class="p-num font-mono2' + (p.errors24h > 0 ? " p-err" : "") + '">' + p.errors24h + "</td>" +
          '<td class="p-num font-mono2">' + speed(p.avgMs24h) + "</td>" +
          '<td class="p-keep">' + ctl + "</td>" +
          "</tr>";
      }
      body =
        '<div class="p-wrap"><table class="font-mono2"><thead><tr>' +
        "<th>PROJECT</th><th>KEY (LAST 12)</th><th>STATUS</th><th>LAST CALL</th>" +
        '<th class="p-num">24H CALLS</th><th class="p-num">ERRORS</th><th class="p-num">SPEED</th><th>SWITCH</th>' +
        "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
        '<p class="p-note font-mono2">GREEN = WORKING AND CALLED IN THE LAST 24 H (LIVE = LAST 5 MIN) · SPEED = AVERAGE ANSWER TIME, 24 H</p>' +
        '<p class="p-note font-mono2">ON = THE KEY WORKS · OFF = PAUSED, TURN IT ON AGAIN ANY TIME · BROKEN = RETIRED FOR GOOD (FOR KEYS NOBODY USES; CANNOT BE UNDONE) · A SWITCH REACHES EVERY SERVER WITHIN ABOUT A MINUTE</p>';
    }
    if (errorText) body += '<p class="p-note font-mono2 p-err">' + esc(errorText) + "</p>";
    box.innerHTML = head + body;
  }

  function load() {
    var box = document.getElementById(ID);
    if (!box || !onAdmin() || document.hidden) return;
    var t = token();
    if (!t) return;
    fetch("/api/admin/project-activity", { headers: { authorization: "Bearer " + t }, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) {
          denied = true;
          var b = document.getElementById(ID);
          if (b) b.remove();
          return null;
        }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (json) {
        if (!json) return;
        data = json;
        errorText = "";
        var b = document.getElementById(ID);
        if (b) render(b);
      })
      .catch(function () {
        errorText = "COULD NOT REFRESH — SHOWING THE LAST DATA.";
        var b = document.getElementById(ID);
        if (b) render(b);
      });
  }

  function setControl(id, state) {
    var t = token();
    if (!t || !id || busy[id]) return;
    if (state === "broken" &&
        !window.confirm("BROKEN retires this API key for good. Any project still using it stops working, and it cannot be turned on again. Continue?")) return;
    busy[id] = true;
    var b = document.getElementById(ID);
    if (b) render(b);
    fetch("/api/admin/project-control", {
      method: "POST",
      headers: { authorization: "Bearer " + t, "content-type": "application/json" },
      body: JSON.stringify({ id: id, state: state }),
      cache: "no-store",
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
          return d;
        });
      })
      .then(function (d) {
        errorText = "";
        if (data && data.projects) {
          for (var i = 0; i < data.projects.length; i++) {
            if (data.projects[i].id === id) {
              data.projects[i].control = d.control;
              if (d.control !== "on") data.projects[i].status = d.control;
            }
          }
        }
      })
      .catch(function (e) {
        errorText = "SWITCH NOT CHANGED: " + String(e && e.message ? e.message : e).toUpperCase();
      })
      .then(function () {
        delete busy[id];
        load();
        var box = document.getElementById(ID);
        if (box) render(box);
      });
  }

  // the admin console's "CONNECTED MODELS" panel
  function anchor() {
    var heads = document.querySelectorAll("section.panel h3");
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].textContent.indexOf("CONNECTED MODELS") !== -1) return heads[i].closest("section.panel");
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
      box.setAttribute("aria-label", "Connected projects");
      box.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest("button[data-state]") : null;
        if (btn && !btn.disabled) setControl(btn.getAttribute("data-id"), btn.getAttribute("data-state"));
      });
      render(box);
    }
    a.after(box);
    if (!data) load();
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
