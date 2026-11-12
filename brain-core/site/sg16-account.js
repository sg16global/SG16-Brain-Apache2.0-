// SG16 — visitor sign-up / sign-in on the My Domain page (owner request 2026-11-06).
//
// The login page (/login) was operator-only. This adds the visitor's own
// sign-in above it: email -> 6-digit code by email -> signed in. The first
// code for an email creates the free account (free tokens only when the server
// gives any: FREE_TOKEN_ALLOWANCE, "0" since 2026-11-13). A signed-in
// visitor sees their account here: free tokens left, or their pass. A pass
// held on this device is kept with the account, and a pass the account holds
// is copied to this device, so it works everywhere they sign in.
//
// The operator form below stays exactly as it was (sg16global@gmail.com +
// the dashboard password). The page is a static mirror of the pointoni Next
// app, so like the other sg16-*.js add-ons this is placed beside it once
// React has hydrated it; a MutationObserver puts it back after re-renders.
//
// On every page it also adds a SIGN IN link to the chat panel's error line
// when the chat asks a visitor to sign in.
(function () {
  "use strict";
  var ID = "sg16-account";
  var OP = "sg16-account-op";
  var IDENTITY_KEY = "sg16/identity";
  var PASS_KEY = "sg16/pass";

  var CSS =
    "#" + ID + "{margin-bottom:22px}" +
    "#" + ID + " h2{margin:0 0 4px;font-family:var(--font-display);font-size:18px;font-weight:900;letter-spacing:.12em;color:#fff;text-shadow:0 0 16px rgba(255,31,46,.4)}" +
    "#" + ID + " .sa-sub{margin:0 0 16px;font-size:12px;line-height:1.6;color:#cbd5e1}" +
    "#" + ID + " .sa-sub b{color:#facc15}" +
    "#" + ID + " label{display:block;margin-bottom:14px}" +
    "#" + ID + " label span{display:block;margin-bottom:4px;font-size:10px;letter-spacing:.2em;color:#94a3b8}" +
    "#" + ID + " .sa-code{letter-spacing:.5em;font-size:20px;text-align:center}" +
    "#" + ID + " .sa-msg{margin:0 0 14px;padding:8px 12px;border-radius:8px;font-size:12px;line-height:1.5}" +
    "#" + ID + " .sa-err{border:1px solid rgba(248,113,113,.4);background:rgba(239,68,68,.1);color:#fca5a5}" +
    "#" + ID + " .sa-ok{border:1px solid rgba(34,224,140,.4);background:rgba(34,224,140,.08);color:#86efac}" +
    "#" + ID + " .sa-links{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-top:12px}" +
    "#" + ID + " .sa-link{padding:0;border:0;background:none;font-size:11px;letter-spacing:.08em;color:#94a3b8;text-decoration:underline;cursor:pointer}" +
    "#" + ID + " .sa-link:hover{color:#fff}" +
    "#" + ID + " .sa-row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid rgba(255,255,255,.08);font-size:12px;color:#cbd5e1}" +
    "#" + ID + " .sa-row b{color:#fff;text-align:right;word-break:break-all}" +
    "#" + ID + " .sa-row .sa-green{color:#22e08c}" +
    "#" + ID + " .sa-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}" +
    "#" + OP + "{display:flex;align-items:center;gap:10px;margin:0 0 12px;font-size:10px;letter-spacing:.22em;color:#64748b}" +
    "#" + OP + "::before,#" + OP + "::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.1)}" +
    ".sg16-signin-link{margin-left:8px;padding:2px 8px;border-radius:6px;border:1px solid rgba(34,224,140,.5);color:#86efac;font-weight:800;text-decoration:none;white-space:nowrap}" +
    ".sg16-signin-link:hover{background:rgba(34,224,140,.12);color:#fff}";

  function addStyle() {
    if (document.getElementById(ID + "-style")) return;
    var st = document.createElement("style");
    st.id = ID + "-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---- device storage ----------------------------------------------------
  function identity() {
    try {
      var raw = localStorage.getItem(IDENTITY_KEY);
      var v = raw ? JSON.parse(raw) : null;
      return v && typeof v.token === "string" ? v : null;
    } catch (e) {
      return null;
    }
  }
  function devicePass() {
    try {
      var r = JSON.parse(localStorage.getItem(PASS_KEY) || "null");
      return r && typeof r.expires_at === "number" && r.expires_at > Date.now() / 1000 ? r : null;
    } catch (e) {
      return null;
    }
  }
  // the X-SG16-Pass shape: the whole signed record as base64url JSON
  function passHeader(r) {
    try {
      return btoa(JSON.stringify(r)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } catch (e) {
      return null;
    }
  }
  // the account's pass comes to this device when it has none (or a shorter one)
  function keepPass(r) {
    if (!r || typeof r.expires_at !== "number") return;
    var mine = devicePass();
    if (mine && mine.expires_at >= r.expires_at) return;
    try { localStorage.setItem(PASS_KEY, JSON.stringify(r)); } catch (e) {}
  }
  function announce() {
    window.dispatchEvent(new Event("sg16-identity"));
  }

  function api(body, token) {
    var headers = { "Content-Type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    return fetch("/api/identity", { method: "POST", headers: headers, body: JSON.stringify(body), cache: "no-store" })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { d.__status = r.status; return d; });
      })
      .catch(function () {
        return { ok: false, error: "Could not reach the server. Try again.", __status: 0 };
      });
  }

  // ---- the panel ------------------------------------------------------------
  var state = { step: "email", email: "", msg: null, err: false, busy: false, me: null, loadingMe: false };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(sec) {
    try {
      return new Date(sec * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    } catch (e) {
      return "";
    }
  }
  var PASS_LABELS = { day: "24-Hour Entry", week: "1-Week Premium", half: "15-Day Premium", month: "1-Month Premium" };

  function render(box) {
    var id = identity();
    var msg = state.msg ? '<p class="sa-msg ' + (state.err ? "sa-err" : "sa-ok") + '" role="status">' + esc(state.msg) + "</p>" : "";
    var dis = state.busy ? " disabled" : "";
    var html;
    if (id) {
      var me = state.me;
      var rows = '<div class="sa-row"><span>SIGNED IN AS</span><b>' + esc(id.email || (me && me.email) || "") + "</b></div>";
      if (me && me.pass) {
        rows += '<div class="sa-row"><span>YOUR PASS</span><b class="sa-green">' + esc(PASS_LABELS[me.pass.pass] || me.pass.pass) +
          " · until " + esc(fmtDate(me.pass.expires_at)) + "</b></div>";
      } else if (me && typeof me.freeTokensRemaining === "number") {
        rows += '<div class="sa-row"><span>FREE TOKENS LEFT</span><b class="sa-green">' + me.freeTokensRemaining.toLocaleString() + "</b></div>";
      } else if (state.loadingMe) {
        rows += '<div class="sa-row"><span>YOUR ACCOUNT</span><b>checking…</b></div>';
      }
      html =
        "<h2>MY DOMAIN</h2>" +
        '<p class="sa-sub">You are signed in on this device. Your pass goes with your account to every device you sign in on.</p>' +
        msg + rows +
        '<div class="sa-actions"><a class="btn-red px-5 py-2.5 text-[11px]" href="/chat">START CHAT</a>' +
        (me && !me.pass ? '<a class="btn-ghost px-5 py-2.5 text-[11px]" href="/subscription">GET A PASS</a>' : "") + "</div>";
    } else if (state.step === "code") {
      html =
        "<h2>ENTER YOUR CODE</h2>" +
        '<p class="sa-sub">We sent a 6-digit code to <b>' + esc(state.email) + "</b>. It works for 10 minutes. Check your spam folder if it is not there.</p>" +
        msg +
        '<form data-sa="verify"><label><span>6-DIGIT CODE</span>' +
        '<input class="input-dark sa-code h-12 w-full px-3" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,8}" maxlength="8" required></label>' +
        '<button class="btn-red inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[11px] disabled:opacity-50"' + dis + ">" +
        (state.busy ? "CHECKING…" : "SIGN IN") + "</button></form>" +
        '<div class="sa-links"><button class="sa-link" type="button" data-sa="again">Send a new code</button>' +
        '<button class="sa-link" type="button" data-sa="other">Use another email</button></div>';
    } else {
      html =
        "<h2>SIGN IN OR SIGN UP</h2>" +
        '<p class="sa-sub">Enter your email and we send you a 6-digit code. No password. New here? The same code creates your free account.</p>' +
        msg +
        '<form data-sa="request"><label><span>YOUR EMAIL</span>' +
        '<input class="input-dark h-11 w-full px-3 text-[14px]" type="email" name="email" autocomplete="email" required value="' + esc(state.email) + '"></label>' +
        '<button class="btn-red inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[11px] disabled:opacity-50"' + dis + ">" +
        (state.busy ? "SENDING…" : "SEND MY CODE") + "</button></form>";
    }
    box.innerHTML = html;
    var input = box.querySelector("input");
    if (input && !state.busy && document.activeElement === document.body) input.focus();
  }

  function rerender() {
    var box = document.getElementById(ID);
    if (box) render(box);
    var op = document.getElementById(OP);
    if (op) op.hidden = Boolean(identity());
  }

  function sendCode(email) {
    state.busy = true; state.msg = null; rerender();
    api({ action: "request", email: email }).then(function (d) {
      state.busy = false;
      if (d.ok) {
        state.email = email; state.step = "code";
        state.msg = "Code sent. Check your inbox."; state.err = false;
      } else {
        state.msg = d.error || "Could not send the code."; state.err = true;
      }
      rerender();
    });
  }

  function verify(code) {
    state.busy = true; state.msg = null; rerender();
    var mine = devicePass();
    var body = { action: "verify", email: state.email, code: code };
    if (mine) body.pass = passHeader(mine);
    api(body).then(function (d) {
      state.busy = false;
      if (!d.ok || !d.token) {
        state.msg = d.error || "Sign-in failed."; state.err = true;
        rerender();
        return;
      }
      try {
        localStorage.setItem(IDENTITY_KEY, JSON.stringify({ token: d.token, email: d.email, account: true }));
      } catch (e) {
        state.msg = "This browser blocks storage, so it cannot keep you signed in."; state.err = true;
        rerender();
        return;
      }
      keepPass(d.pass);
      state.step = "email"; state.me = null;
      var gift = typeof d.freeTokensRemaining === "number" && d.freeTokensRemaining > 0 ? ", with " + d.freeTokensRemaining.toLocaleString() + " free tokens" : "";
      state.msg = d.created ? "Welcome! Your free account is ready" + gift + "." : "Welcome back! You are signed in.";
      state.err = false;
      announce();
      loadMe();
    });
  }

  function loadMe() {
    var id = identity();
    if (!id || state.loadingMe) return;
    state.loadingMe = true;
    rerender();
    var mine = devicePass();
    var body = { action: "me" };
    if (mine) body.pass = passHeader(mine);
    api(body, id.token).then(function (d) {
      state.loadingMe = false;
      if (d.ok) {
        state.me = d;
        keepPass(d.pass);
      }
      rerender();
    });
  }

  function onSubmit(e) {
    var form = e.target;
    if (!form || !form.getAttribute) return;
    var kind = form.getAttribute("data-sa");
    if (!kind) return;
    e.preventDefault();
    if (state.busy) return;
    if (kind === "request") sendCode(String(form.email.value || "").trim());
    if (kind === "verify") verify(String(form.code.value || "").replace(/\s+/g, ""));
  }

  function onClick(e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-sa]") : null;
    if (!b || b.tagName === "FORM") return;
    var kind = b.getAttribute("data-sa");
    if (kind === "again" && !state.busy) sendCode(state.email);
    if (kind === "other") { state.step = "email"; state.msg = null; rerender(); }
  }

  function build() {
    var box = document.createElement("section");
    box.id = ID;
    box.className = "panel corner p-7";
    box.setAttribute("aria-label", "Sign in or sign up");
    box.addEventListener("submit", onSubmit);
    box.addEventListener("click", onClick);
    render(box);
    return box;
  }

  // ---- placing it on /login --------------------------------------------------
  function hydrated(el) {
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) if (keys[i].indexOf("__reactFiber") === 0) return true;
    return false;
  }

  function onLogin() {
    return /^\/login\/?$/.test(location.pathname);
  }

  // the page's own text was written for an operator-only page
  function retext(col) {
    var main = col.closest("main");
    var h1 = main && main.querySelector("h1");
    if (h1 && h1.textContent === "OPERATOR SIGN-IN") {
      h1.textContent = "MY DOMAIN";
      var p = h1.nextElementSibling;
      if (p) p.textContent = "Sign in or create your free account with your email.";
    }
    var notes = col.querySelectorAll("form p");
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].textContent.indexOf("ONLY THE EMAIL REGISTERED") === 0) {
        notes[i].textContent = "ADMIN ONLY: THE PLATFORM OPERATOR'S EMAIL AND PASSWORD. VISITORS SIGN IN ABOVE.";
      }
    }
  }

  var started = Date.now();
  var lastIdentity = null;
  function place() {
    if (!onLogin()) return;
    var col = document.querySelector("main .max-w-\\[460px\\]");
    var panel = col && col.querySelector(":scope > section.panel:not(#" + ID + ")");
    if (!panel) return;
    if (!hydrated(col) && Date.now() - started < 8000) return;
    addStyle();
    var box = document.getElementById(ID);
    if (!box || box.parentElement !== col) {
      if (box) box.remove();
      box = build();
      col.insertBefore(box, col.firstChild);
    }
    var op = document.getElementById(OP);
    if (!op || op.parentElement !== col || op.nextElementSibling !== panel) {
      if (op) op.remove();
      op = document.createElement("p");
      op.id = OP;
      op.textContent = "OPERATOR SIGN-IN · ADMIN ONLY";
      col.insertBefore(op, panel);
    }
    op.hidden = Boolean(identity());
    retext(col);
    // signed in / out elsewhere (the React sign-out, another tab): refresh
    var now = identity() ? identity().token : null;
    if (now !== lastIdentity) {
      lastIdentity = now;
      state.me = null;
      rerender();
      if (now) loadMe();
    }
  }

  // ---- the chat panel's "sign in" error gets a link --------------------------
  function linkChatError() {
    var docks = document.querySelectorAll("div.bg-red-500\\/10");
    for (var i = 0; i < docks.length; i++) {
      var d = docks[i];
      if (d.querySelector(".sg16-signin-link")) continue;
      if ((d.textContent || "").indexOf("Sign in free to chat") === -1) continue;
      addStyle();
      var a = document.createElement("a");
      a.className = "sg16-signin-link";
      a.href = "/login";
      a.textContent = "SIGN IN";
      var dismiss = d.querySelector("button");
      d.insertBefore(a, dismiss || null);
    }
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      place();
      linkChatError();
    });
  }

  function start() {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("storage", schedule);
    window.addEventListener("sg16-identity", schedule);
    var tries = 0;
    var t = setInterval(function () {
      place();
      if (document.getElementById(ID) || !onLogin() || ++tries > 40) clearInterval(t);
    }, 250);
    place();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
