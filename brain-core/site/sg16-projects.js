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
//
// 2026-11-08 (owner request): every project is independent of the website.
// RULES opens the project's own rules (instructions for the brain, requests
// per minute, queue wait, JSON-only answers, blocked patterns), saved with
// /api/admin/project-rules. NEW KEY gives the project a fresh key and retires
// the old one at the same moment (POST /api/admin/project-keys {rotate}).
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
    "#sg16-projects tr.p-dead td.p-keep{opacity:1}" +
    "#sg16-projects .p-cell{display:flex;align-items:center;gap:6px;margin-top:6px}" +
    "#sg16-projects .p-btn{padding:3px 8px;border-radius:8px;border:1px solid rgba(120,190,255,.35);background:rgba(20,30,46,.5);color:#cfe3ff;font-size:10px;font-weight:800;letter-spacing:.12em;cursor:pointer}" +
    "#sg16-projects .p-btn:hover:not(:disabled){border-color:rgba(57,215,255,.8);color:#fff}" +
    "#sg16-projects .p-btn:disabled{opacity:.45;cursor:default}" +
    "#sg16-projects .p-btn[aria-expanded=true]{background:rgba(57,215,255,.14);color:#39d7ff;border-color:rgba(57,215,255,.6)}" +
    "#sg16-projects .p-own{display:block;margin-top:3px;font-size:9px;letter-spacing:.12em;color:#39d7ff}" +
    "#sg16-projects .p-rules{margin-top:14px;padding:16px;border-radius:10px;border:1px solid rgba(57,215,255,.25);background:rgba(8,12,19,.6)}" +
    "#sg16-projects .r-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:12px}" +
    "#sg16-projects .r-l{display:block;margin-bottom:6px;font-size:10px;font-weight:700;letter-spacing:.16em;color:#8aa0bd}" +
    "#sg16-projects .r-in{width:100%;height:38px;padding:0 10px;font-size:12px}" +
    "#sg16-projects textarea.r-in{height:auto;min-height:120px;padding:10px;line-height:1.5;resize:vertical}" +
    "#sg16-projects .r-check{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.08em;color:#e2e8f0}" +
    "#sg16-projects .r-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}" +
    "#sg16-projects .r-actions button{height:36px;padding:0 14px;font-size:10px}" +
    "#sg16-projects .r-actions button:disabled{opacity:.5;cursor:wait}" +
    "#sg16-projects .r-title{font-size:11px;font-weight:800;letter-spacing:.16em;color:#fff}" +
    "#sg16-projects .r-msg{margin-top:10px;font-size:10px;letter-spacing:.12em}" +
    "#sg16-projects .r-ok{color:#22e08c}" +
    "#sg16-projects .r-bad{color:#ff8a3d}" +
    "#sg16-projects .p-fresh{margin-top:14px;padding:12px;border-radius:10px;border:1px solid rgba(34,224,140,.35);background:rgba(34,224,140,.08)}" +
    "#sg16-projects .p-fresh code{display:block;margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(8,12,19,.8);color:#fff;font-size:12px;word-break:break-all;user-select:all}" +
    "#sg16-projects .p-fresh p{margin:0;font-size:10px;letter-spacing:.14em;color:#22e08c}";

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

  // PROJECT RULES (one editor open at a time) and NEW KEY
  var rulesOpen = "";     // the project whose rules are open
  var rules = null;       // {project, custom, rules, defaults, limits} from GET /api/admin/project-rules
  var draft = null;       // what the operator is typing: {system, rpm, waitS, require_json, patterns}
  var rulesBusy = false;
  var rulesMsg = null;    // {ok: bool, text}
  var ownRules = {};      // project -> true when it has its own rules
  var fresh = null;       // {project, key}: a key just made, shown once
  var rotating = {};      // key id -> true while a new key is being made

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
      var seen = {};
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
        var firstOfProject = seen[p.project] !== true;
        seen[p.project] = true;
        var manage =
          '<span class="p-cell">' +
          '<button type="button" class="p-btn font-mono2" data-rules="' + esc(p.project) + '" aria-expanded="' + (rulesOpen === p.project && firstOfProject) + '">RULES</button>' +
          '<button type="button" class="p-btn font-mono2" data-rotate="' + esc(p.id || "") + '" data-project="' + esc(p.project) + '"' +
          (control === "broken" || !p.id || rotating[p.id] ? " disabled" : "") + ">" + (rotating[p.id] ? "…" : "NEW KEY") + "</button>" +
          "</span>";
        rows +=
          '<tr class="' + (control === "broken" ? "p-dead" : "") + '">' +
          '<td class="p-name font-display">' + esc(p.project.toUpperCase()) +
          (ownRules[p.project] ? '<span class="p-own font-mono2">OWN RULES</span>' : "") + manage + "</td>" +
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
        (rulesOpen ? '<div class="p-rules" role="region" aria-label="Rules for ' + esc(rulesOpen) + '">' + rulesEditor() + "</div>" : "") +
        '<p class="p-note font-mono2">GREEN = WORKING AND CALLED IN THE LAST 24 H (LIVE = LAST 5 MIN) · SPEED = AVERAGE ANSWER TIME, 24 H</p>' +
        '<p class="p-note font-mono2">ON = THE KEY WORKS · OFF = PAUSED, TURN IT ON AGAIN ANY TIME · BROKEN = RETIRED FOR GOOD (FOR KEYS NOBODY USES; CANNOT BE UNDONE) · A SWITCH REACHES EVERY SERVER WITHIN ABOUT A MINUTE</p>' +
        '<p class="p-note font-mono2">EVERY PROJECT IS INDEPENDENT OF THE WEBSITE: NONE OF ITS RULES OR FREE-TOKEN LIMITS APPLY · RULES = THE PROJECT\'S OWN INSTRUCTIONS AND LIMITS · NEW KEY = A FRESH KEY, THE OLD ONE STOPS AT ONCE</p>';
    }
    if (fresh) {
      body =
        '<div class="p-fresh" role="status"><p class="font-mono2">NEW KEY FOR ' + esc(fresh.project.toUpperCase()) +
        " — SHOWN ONCE: COPY IT NOW AND PUT IT IN THAT PROJECT. THE OLD KEY NO LONGER WORKS.</p>" +
        '<code class="font-mono2">' + esc(fresh.key) + "</code>" +
        '<div class="r-actions"><button type="button" class="btn-green" data-fresh="copy">COPY</button>' +
        '<button type="button" class="btn-ghost" data-fresh="done">DONE</button></div></div>' + body;
    }
    if (errorText) body += '<p class="p-note font-mono2 p-err">' + esc(errorText) + "</p>";
    keepTyping(box, function () {
      box.innerHTML = head + body;
    });
  }

  // re-rendering replaces the editor: keep what is typed, the focus and the caret
  function keepTyping(box, paint) {
    readDraft();
    var el = document.activeElement;
    var id = el && box.contains(el) && el.id ? el.id : "";
    var start = null;
    var end = null;
    try {
      if (id && typeof el.selectionStart === "number") { start = el.selectionStart; end = el.selectionEnd; }
    } catch (e) { /* number fields have no caret */ }
    paint();
    if (!id) return;
    var again = document.getElementById(id);
    if (!again) return;
    again.focus();
    if (start !== null) {
      try { again.setSelectionRange(start, end); } catch (e) { /* not a text field */ }
    }
  }

  function rulesEditor() {
    var head = '<span class="r-title font-display">RULES FOR ' + esc(rulesOpen.toUpperCase()) + "</span>";
    if (!rules || rules.project !== rulesOpen || !draft) {
      return head + '<p class="r-msg font-mono2' + (rulesMsg ? " r-bad" : "") + '">' + (rulesMsg ? esc(rulesMsg.text) : "LOADING…") + "</p>";
    }
    var lim = rules.limits || {};
    var maxWait = Math.round((lim.maxQueueMs || 45000) / 1000);
    var dis = rulesBusy ? " disabled" : "";
    return head +
      '<p class="p-note font-mono2">' + (rules.custom ? "THIS PROJECT HAS ITS OWN RULES." : "THIS PROJECT USES THE DEFAULT RULES — NOTHING SAVED YET.") +
      " THE INSTRUCTIONS GO TO THE BRAIN FIRST, THEN ANY SYSTEM MESSAGE THE PROJECT SENDS WITH A CALL. ALL KEYS OF THIS PROJECT SHARE THESE RULES.</p>" +
      '<div class="r-grid" style="grid-template-columns:1fr">' +
      '<div><label class="r-l font-mono2" for="r-system">INSTRUCTIONS FOR THE BRAIN (OPTIONAL)</label>' +
      '<textarea id="r-system" class="input-dark r-in font-mono2" maxlength="' + (lim.maxRulesChars || 16384) +
      '" placeholder="e.g. You are the assistant of My Shop. Answer only about orders, delivery and returns. Reply in the customer\'s language.">' +
      esc(draft.system) + "</textarea></div></div>" +
      '<div class="r-grid">' +
      '<div><label class="r-l font-mono2" for="r-rpm">REQUESTS PER MINUTE, PER KEY</label>' +
      '<input id="r-rpm" class="input-dark r-in font-mono2" type="number" min="1" max="' + (lim.maxRpm || 10000) + '" step="1" value="' + esc(draft.rpm) + '"></div>' +
      '<div><label class="r-l font-mono2" for="r-wait">MAX WAIT FOR THE BRAIN (SECONDS, 0-' + maxWait + ")</label>" +
      '<input id="r-wait" class="input-dark r-in font-mono2" type="number" min="0" max="' + maxWait + '" step="1" value="' + esc(draft.waitS) + '"></div>' +
      '<div><span class="r-l font-mono2">ANSWER FORMAT</span>' +
      '<label class="r-check font-mono2"><input id="r-json" type="checkbox"' + (draft.require_json ? " checked" : "") +
      '> JSON ONLY: {"answer": "..."}</label></div>' +
      "</div>" +
      '<div class="r-grid" style="grid-template-columns:1fr">' +
      '<div><label class="r-l font-mono2" for="r-patterns">BLOCKED PATTERNS — ONE PER LINE (QUESTIONS AND ANSWERS THAT MATCH ARE REFUSED)</label>' +
      '<textarea id="r-patterns" class="input-dark r-in font-mono2" style="min-height:70px" placeholder="e.g. password|credit card">' + esc(draft.patterns) + "</textarea></div>" +
      "</div>" +
      '<div class="r-actions">' +
      '<button type="button" class="btn-green" data-rules-act="save"' + dis + ">" + (rulesBusy ? "SAVING…" : "SAVE RULES") + "</button>" +
      (rules.custom ? '<button type="button" class="btn-ghost" data-rules-act="reset"' + dis + ">BACK TO DEFAULTS</button>" : "") +
      '<button type="button" class="btn-ghost" data-rules-act="close"' + dis + ">CLOSE</button>" +
      "</div>" +
      (rulesMsg ? '<p class="r-msg font-mono2 ' + (rulesMsg.ok ? "r-ok" : "r-bad") + '" role="status">' + esc(rulesMsg.text) + "</p>" : "");
  }

  function readDraft() {
    if (!draft) return;
    var el = function (id) { return document.getElementById(id); };
    if (el("r-system")) draft.system = el("r-system").value;
    if (el("r-rpm")) draft.rpm = el("r-rpm").value;
    if (el("r-wait")) draft.waitS = el("r-wait").value;
    if (el("r-json")) draft.require_json = el("r-json").checked;
    if (el("r-patterns")) draft.patterns = el("r-patterns").value;
  }

  function draftFrom(r) {
    return {
      system: r.system || "",
      rpm: String(r.rpm),
      waitS: String(Math.round(r.max_queue_ms / 1000)),
      require_json: r.require_json === true,
      patterns: (r.blocked_patterns || []).join("\n"),
    };
  }

  function adminJson(method, path, body) {
    return fetch(path, {
      method: method,
      headers: { authorization: "Bearer " + token(), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
        return d;
      });
    });
  }

  function rerender() {
    var box = document.getElementById(ID);
    if (box) render(box);
  }

  function loadOwnRules() {
    adminJson("GET", "/api/admin/project-rules")
      .then(function (d) {
        ownRules = {};
        for (var i = 0; i < (d.projects || []).length; i++) ownRules[d.projects[i].project] = true;
        rerender();
      })
      .catch(function () { /* the table still works without the badges */ });
  }

  function toggleRules(project) {
    readDraft();
    if (rulesOpen === project) {
      rulesOpen = "";
      rerender();
      return;
    }
    rulesOpen = project;
    rules = null;
    draft = null;
    rulesMsg = null;
    rerender();
    adminJson("GET", "/api/admin/project-rules?project=" + encodeURIComponent(project))
      .then(function (d) {
        if (rulesOpen !== project) return;
        rules = d;
        draft = draftFrom(d.rules);
        rerender();
      })
      .catch(function (e) {
        rulesMsg = { ok: false, text: "COULD NOT LOAD THE RULES: " + String(e && e.message ? e.message : e) };
        rerender();
      });
  }

  function rulesAction(kind) {
    if (rulesBusy || !rulesOpen) return;
    readDraft();
    var project = rulesOpen;
    if (kind === "close") {
      rulesOpen = "";
      rerender();
      return;
    }
    var call;
    if (kind === "reset") {
      if (!window.confirm("Remove the own rules of " + project + "? It goes back to the default rules.")) return;
      call = adminJson("DELETE", "/api/admin/project-rules?project=" + encodeURIComponent(project));
    } else {
      var patterns = draft.patterns.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      call = adminJson("POST", "/api/admin/project-rules", {
        project: project,
        system: draft.system,
        rpm: Number(draft.rpm),
        max_queue_ms: Math.round(Number(draft.waitS) * 1000),
        require_json: draft.require_json,
        blocked_patterns: patterns,
      });
    }
    rulesBusy = true;
    rulesMsg = null;
    rerender();
    call
      .then(function (d) {
        rules = { project: project, custom: d.custom, rules: d.rules, defaults: rules && rules.defaults, limits: rules && rules.limits };
        draft = draftFrom(d.rules);
        if (d.custom) ownRules[project] = true;
        else delete ownRules[project];
        rulesMsg = { ok: true, text: kind === "reset" ? "BACK TO THE DEFAULT RULES." : "SAVED — " + project.toUpperCase() + " USES THESE RULES FROM ITS NEXT CALL (EVERYWHERE WITHIN ABOUT A MINUTE)." };
      })
      .catch(function (e) {
        rulesMsg = { ok: false, text: "NOT SAVED: " + String(e && e.message ? e.message : e) };
      })
      .then(function () {
        rulesBusy = false;
        rerender();
      });
  }

  function rotate(id, project) {
    if (!id || rotating[id]) return;
    if (!window.confirm("Make a NEW KEY for " + project + "? The current key stops working at once, so put the new key in that project straight away.")) return;
    rotating[id] = true;
    rerender();
    adminJson("POST", "/api/admin/project-keys", { rotate: id })
      .then(function (d) {
        fresh = { project: d.project, key: d.key };
        errorText = "";
      })
      .catch(function (e) {
        errorText = "NO NEW KEY: " + String(e && e.message ? e.message : e).toUpperCase();
      })
      .then(function () {
        delete rotating[id];
        load();
        rerender();
      });
  }

  function freshAction(kind) {
    if (!fresh) return;
    if (kind === "done") {
      fresh = null;
      rerender();
      return;
    }
    var copied = function () {
      var b = document.querySelector("#" + ID + " [data-fresh=copy]");
      if (b) b.textContent = "COPIED";
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(fresh.key).then(copied, function () {});
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
        var t = e.target && e.target.closest ? e.target : null;
        if (!t) return;
        var btn = t.closest("button[data-state]");
        if (btn) {
          if (!btn.disabled) setControl(btn.getAttribute("data-id"), btn.getAttribute("data-state"));
          return;
        }
        var r = t.closest("button[data-rules]");
        if (r) return toggleRules(r.getAttribute("data-rules"));
        var ra = t.closest("button[data-rules-act]");
        if (ra) {
          if (!ra.disabled) rulesAction(ra.getAttribute("data-rules-act"));
          return;
        }
        var ro = t.closest("button[data-rotate]");
        if (ro) {
          if (!ro.disabled) rotate(ro.getAttribute("data-rotate"), ro.getAttribute("data-project"));
          return;
        }
        var f = t.closest("button[data-fresh]");
        if (f) freshAction(f.getAttribute("data-fresh"));
      });
      render(box);
    }
    a.after(box);
    if (!data) {
      load();
      loadOwnRules();
    }
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
