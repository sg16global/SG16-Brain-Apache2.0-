// SG16 — BRAIN SERVER panel on /admin (owner request 2026-11-08).
//
// Operator-only. The core is server-agnostic: the owner points it at any
// server that runs Ollama with saiftechglobal/sg16-brain:Q4_K_M, tests the
// connection and saves it — no redeploy. GET/POST/DELETE
// /api/admin/brain-server (+ /test). Saved door secrets are never sent back
// to the browser: the panel only learns whether each one is set. Placed under
// the BRAIN POWER switch (or the top banner) and put back by a
// MutationObserver whenever React renders the page again. Visitors never see
// it: the script does nothing outside /admin, and the endpoints answer only
// the signed-in operator.
(function () {
  "use strict";
  var ID = "sg16-gateway";
  var REFRESH_MS = 60000;
  var S = "#" + ID;

  var CSS =
    S + " h3{margin:0}" +
    S + " .gw-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
    S + " .gw-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.14em;border:1px solid currentColor}" +
    S + " .gw-text{margin:8px 0 0;font-size:11px;line-height:1.6;letter-spacing:.06em;color:#cbd5e1}" +
    S + " .gw-text b{color:#fff}" +
    S + " .gw-grid{display:grid;grid-template-columns:1fr;gap:12px;margin-top:14px}" +
    S + " .gw-l{display:block;margin-bottom:6px;font-size:10px;font-weight:700;letter-spacing:.16em;color:#8aa0bd}" +
    S + " .gw-in{width:100%;height:40px;padding:0 12px;font-size:13px}" +
    S + " .gw-modes{display:inline-flex;flex-wrap:wrap;border:1px solid rgba(255,255,255,.14);border-radius:9px;overflow:hidden}" +
    S + " .gw-modes button{padding:8px 12px;border:0;border-left:1px solid rgba(255,255,255,.1);background:transparent;color:#94a3b8;font-size:10px;font-weight:800;letter-spacing:.12em;cursor:pointer}" +
    S + " .gw-modes button:first-child{border-left:0}" +
    S + " .gw-modes button[aria-pressed=true]{background:rgba(57,215,255,.14);color:#39d7ff}" +
    S + " .gw-creds{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}" +
    S + " .gw-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}" +
    S + " .gw-actions button{height:38px;padding:0 16px;font-size:10px}" +
    S + " .gw-actions button:disabled{opacity:.5;cursor:wait}" +
    S + " .gw-result{margin:0;padding:10px 12px;border-radius:9px;font-size:11px;line-height:1.6;letter-spacing:.06em;border:1px solid}" +
    S + " .gw-ok{color:#22e08c;border-color:rgba(34,224,140,.35);background:rgba(34,224,140,.08)}" +
    S + " .gw-warn{color:#ffb547;border-color:rgba(255,181,71,.35);background:rgba(255,181,71,.08)}" +
    S + " .gw-bad{color:#ff6b78;border-color:rgba(255,59,76,.35);background:rgba(255,59,76,.08)}" +
    S + " .gw-note{margin:0;font-size:10px;line-height:1.7;letter-spacing:.12em;color:#64748b}" +
    S + " .gw-note code{color:#94a3b8}";

  var state = null;      // last GET (or POST) answer
  var form = null;       // what the operator is editing: {url, credentials, accessClientId, accessClientSecret, sharedSecret}
  var result = null;     // {kind: "ok"|"warn"|"bad", text}
  var busy = "";         // "", "test", "save", "reset"
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

  function describe(probe, model) {
    if (!probe) return null;
    var secs = (probe.latencyMs / 1000).toFixed(1) + " s";
    if (probe.reachable && probe.modelInstalled) {
      return { kind: "ok", text: "CONNECTED · " + secs + " · " + model + " is installed and ready." };
    }
    if (probe.reachable) {
      var found = probe.installed && probe.installed.length ? probe.installed.join(", ") : "no models";
      return { kind: "warn", text: "THE SERVER ANSWERS, BUT THE SG16 BRAIN IS NOT INSTALLED (found: " + found + "). Run scripts/vps-setup-model.sh on it, or: ollama pull " + model };
    }
    var why = {
      E_NO_URL: "No server address is set yet.",
      E_TIMEOUT: "No answer within the time limit. Is the server on, and does the address route to it?",
      E_NETWORK: "Could not reach this address. Check the host name and the tunnel.",
      E_BODY: "Something answered, but it is not an Ollama server.",
    }[probe.error];
    if (probe.error === "E_STATUS") {
      why = probe.http === 401 || probe.http === 403
        ? "HTTP " + probe.http + " — the door refused. Check the Access client ID and secret."
        : "HTTP " + probe.http + " — the server did not answer as Ollama does.";
    }
    return { kind: "bad", text: "NOT CONNECTED · " + (why || "Unknown error.") };
  }

  function chip() {
    if (!state) return '<span class="gw-chip font-mono2" style="color:#8aa0bd">CHECKING…</span>';
    var p = state.probe || {};
    if (p.reachable && p.modelInstalled) return '<span class="gw-chip font-mono2" style="color:#22e08c"><span class="status-dot" style="background:#22e08c;color:#22e08c"></span>CONNECTED</span>';
    if (p.reachable) return '<span class="gw-chip font-mono2" style="color:#ffb547">BRAIN NOT INSTALLED</span>';
    return '<span class="gw-chip font-mono2" style="color:#ff6b78">NOT CONNECTED</span>';
  }

  function secretPlaceholder(isSet) {
    return isSet ? "saved — leave blank to keep it" : "not set";
  }

  function render(box) {
    var model = state ? state.model : "saiftechglobal/sg16-brain:Q4_K_M";
    var f = form || { url: "", credentials: "deploy", accessClientId: "", accessClientSecret: "", sharedSecret: "" };
    var custom = state && state.custom ? state.custom : { accessClientId: "", accessClientSecret: false, sharedSecret: false };
    var deploy = state ? state.deploy : null;
    var source = !state ? "" : state.source === "admin"
      ? "SET HERE" + (state.updated ? " · " + new Date(state.updated).toLocaleString() : "")
      : "DEPLOY SETTING (MODEL_URL)";
    var deployNote = deploy
      ? "CLOUDFLARE SECRETS ON THIS DEPLOYMENT: ACCESS ID " + (deploy.accessClientId ? "SET" : "NOT SET") +
        " · ACCESS SECRET " + (deploy.accessClientSecret ? "SET" : "NOT SET") +
        " · SHARED SECRET " + (deploy.sharedSecret ? "SET" : "NOT SET")
      : "";
    var dis = busy ? " disabled" : "";
    var html =
      '<div class="gw-head">' +
      '<h3 class="flex items-center gap-2 font-display text-[13px] font-black tracking-widest text-white">' +
      '<svg class="h-4 w-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>' +
      " BRAIN SERVER</h3>" + chip() + "</div>" +
      '<p class="gw-text font-mono2">The core works with <b>any server</b>: point it at the server that runs <b>' + esc(model) +
      "</b>, test it and save. No redeploy — the change reaches every Cloudflare location within about a minute. " +
      (source ? "Now using: <b>" + esc(source) + "</b>." : "") + "</p>" +
      '<div class="gw-grid">' +
      "<div>" +
      '<label class="gw-l font-mono2" for="gw-url">SERVER ADDRESS</label>' +
      '<input id="gw-url" class="input-dark gw-in font-mono2" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://internal.your-domain.com" value="' + esc(f.url) + '">' +
      "</div>" +
      "<div>" +
      '<span class="gw-l font-mono2" id="gw-modes-l">DOOR CREDENTIALS</span>' +
      '<span class="gw-modes" role="group" aria-labelledby="gw-modes-l">' +
      '<button type="button" data-mode="deploy" aria-pressed="' + (f.credentials === "deploy") + '">CLOUDFLARE SECRETS</button>' +
      '<button type="button" data-mode="custom" aria-pressed="' + (f.credentials === "custom") + '">ENTER HERE</button>' +
      '<button type="button" data-mode="none" aria-pressed="' + (f.credentials === "none") + '">NONE</button>' +
      "</span>" +
      "</div>";
    if (f.credentials === "custom") {
      html +=
        '<div class="gw-creds">' +
        '<div><label class="gw-l font-mono2" for="gw-cid">ACCESS CLIENT ID</label>' +
        '<input id="gw-cid" class="input-dark gw-in font-mono2" autocomplete="off" spellcheck="false" placeholder="xxxx.access" value="' + esc(f.accessClientId) + '"></div>' +
        '<div><label class="gw-l font-mono2" for="gw-csec">ACCESS CLIENT SECRET</label>' +
        '<input id="gw-csec" class="input-dark gw-in font-mono2" type="password" autocomplete="new-password" placeholder="' + secretPlaceholder(custom.accessClientSecret) + '" value="' + esc(f.accessClientSecret) + '"></div>' +
        '<div><label class="gw-l font-mono2" for="gw-shared">SHARED SECRET (OPTIONAL)</label>' +
        '<input id="gw-shared" class="input-dark gw-in font-mono2" type="password" autocomplete="new-password" placeholder="' + secretPlaceholder(custom.sharedSecret) + '" value="' + esc(f.sharedSecret) + '"></div>' +
        "</div>" +
        '<p class="gw-note font-mono2">STORED ENCRYPTED ON CLOUDFLARE · NEVER SHOWN AGAIN · NOTHING IS STORED ON THE BRAIN SERVER</p>';
    } else if (f.credentials === "deploy") {
      html += '<p class="gw-note font-mono2">' + esc(deployNote) + " (CF_ACCESS_CLIENT_ID · CF_ACCESS_CLIENT_SECRET · MODEL_SHARED_SECRET)</p>";
    } else {
      html += '<p class="gw-note font-mono2">NO DOOR CREDENTIALS — ONLY FOR A SERVER THAT IS ALREADY PRIVATE (E.G. THIS MACHINE DURING A LOCAL TEST).</p>';
    }
    html +=
      '<div class="gw-actions">' +
      '<button type="button" class="btn-ghost" data-act="test"' + dis + ">" + (busy === "test" ? "TESTING…" : "TEST CONNECTION") + "</button>" +
      '<button type="button" class="btn-green" data-act="save"' + dis + ">" + (busy === "save" ? "SAVING…" : "SAVE & CONNECT") + "</button>" +
      (state && state.source === "admin"
        ? '<button type="button" class="btn-ghost" data-act="reset"' + dis + ">" + (busy === "reset" ? "…" : "USE DEPLOY SETTING") + "</button>"
        : "") +
      "</div>";
    var shown = result || (state ? describe(state.probe, model) : null);
    if (shown) html += '<p class="gw-result font-mono2 gw-' + shown.kind + '" role="status">' + esc(shown.text) + "</p>";
    if (state && state.customUnreadable) {
      html += '<p class="gw-result font-mono2 gw-warn">THE SAVED CREDENTIALS CANNOT BE READ (THE IDENTITY SECRET CHANGED). ENTER THEM AGAIN AND SAVE.</p>';
    }
    html +=
      '<p class="gw-note font-mono2">NEW SERVER (UBUNTU/DEBIAN, 16 GB RAM): <code>DOMAIN_INTERNAL=internal.your-domain.com bash scripts/vps-setup-model.sh</code> — IT INSTALLS OLLAMA + ' +
      esc(model.toUpperCase()) + " BEHIND A CLOUDFLARE TUNNEL AND PRINTS THE ADDRESS TO ENTER HERE.</p>" +
      "</div>";
    box.innerHTML = html;
  }

  function rerender() {
    var box = document.getElementById(ID);
    if (!box) return;
    var focused = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : "";
    render(box);
    if (focused) {
      var el = document.getElementById(focused);
      if (el) el.focus();
    }
  }

  function readForm() {
    var get = function (id) {
      var el = document.getElementById(id);
      return el ? el.value : "";
    };
    if (!form) return;
    form.url = get("gw-url");
    if (form.credentials === "custom") {
      form.accessClientId = get("gw-cid");
      form.accessClientSecret = get("gw-csec");
      form.sharedSecret = get("gw-shared");
    }
  }

  function formFromState() {
    form = {
      url: state.url || "",
      credentials: state.credentials || "deploy",
      accessClientId: state.custom ? state.custom.accessClientId || "" : "",
      accessClientSecret: "",
      sharedSecret: "",
    };
  }

  function request(method, path, body) {
    return fetch(path, {
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
    request("GET", "/api/admin/brain-server")
      .then(function (d) {
        if (!d) return;
        var first = !state;
        state = d;
        if (first || !form) formFromState();
        rerender();
      })
      .catch(function (e) {
        result = { kind: "bad", text: "COULD NOT READ THE SETTING: " + String(e && e.message ? e.message : e) };
        rerender();
      });
  }

  function payload() {
    var body = { url: form.url, credentials: form.credentials };
    if (form.credentials === "custom") {
      body.accessClientId = form.accessClientId;
      body.accessClientSecret = form.accessClientSecret;
      body.sharedSecret = form.sharedSecret;
    }
    return body;
  }

  function act(kind) {
    if (busy) return;
    readForm();
    if (kind === "reset" && !window.confirm("Go back to the MODEL_URL deploy setting? The address saved here is removed.")) return;
    if (kind === "save" && !window.confirm("Connect the SG16 Brain to " + form.url + "? Website visitors and API projects are answered by this server from now on.")) return;
    busy = kind;
    result = null;
    rerender();
    var call = kind === "test"
      ? request("POST", "/api/admin/brain-server/test", payload())
      : kind === "save"
        ? request("POST", "/api/admin/brain-server", payload())
        : request("DELETE", "/api/admin/brain-server");
    call
      .then(function (d) {
        if (!d) return;
        var model = d.model || (state && state.model) || "";
        if (kind === "test") {
          var r = describe(d.probe, model);
          result = { kind: r.kind, text: "TEST (NOT SAVED) · " + r.text };
        } else {
          state = d;
          formFromState();
          var s = describe(d.probe, model);
          result = { kind: s.kind, text: (kind === "save" ? "SAVED · " : "BACK TO THE DEPLOY SETTING · ") + s.text };
        }
      })
      .catch(function (e) {
        result = { kind: "bad", text: (kind === "test" ? "NOT TESTED: " : "NOT SAVED: ") + String(e && e.message ? e.message : e) };
      })
      .then(function () {
        busy = "";
        rerender();
      });
  }

  // under the BRAIN POWER switch when it is there, else under the top banner
  function anchor() {
    var power = document.getElementById("sg16-power");
    if (power && power.isConnected) return power;
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
      box.setAttribute("aria-label", "Brain server");
      box.addEventListener("click", function (e) {
        var t = e.target && e.target.closest ? e.target : null;
        if (!t) return;
        var mode = t.closest("button[data-mode]");
        if (mode) {
          readForm();
          if (form) form.credentials = mode.getAttribute("data-mode");
          result = null;
          rerender();
          return;
        }
        var b = t.closest("button[data-act]");
        if (b && !b.disabled) act(b.getAttribute("data-act"));
      });
      box.addEventListener("input", function () {
        readForm();
      });
      render(box);
    }
    a.after(box);
    if (!state) load();
    if (!timer) timer = setInterval(function () {
      // keep the status fresh, but never overwrite what the operator is typing
      var box = document.getElementById(ID);
      if (box && document.activeElement && box.contains(document.activeElement)) return;
      if (!busy) {
        request("GET", "/api/admin/brain-server").then(function (d) {
          if (!d) return;
          state = d;
          rerender();
        }).catch(function () {});
      }
    }, REFRESH_MS);
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
