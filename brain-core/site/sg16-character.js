// SG16 — "Know AI before you use it" panel (owner request 2026-10-18).
//
// The homepage is a static mirror of the pointoni Next app, so this panel is
// added beside it instead of rebuilding the mirror: once React has hydrated
// the AI Pioneers section (#pioneers), the panel is placed right after it,
// which moves the chat panel down. A MutationObserver puts it back whenever
// the homepage is rendered again (client-side navigation back to "/").
// Text is the owner's, word for word.
(function () {
  "use strict";
  var ID = "know-ai";

  var CSS =
    "#know-ai{--kai-gold:#ffd166;--kai-gold-hi:#ffe9a8;--kai-cyan:#49e6ff;--kai-red:#ff3344;--kai-text:#dce6f2;--kai-muted:#9aa6b8;" +
    "border-color:rgba(255,209,102,.6);padding:34px 18px 38px;isolation:isolate;" +
    "box-shadow:0 0 0 1px rgba(255,209,102,.14),0 0 38px rgba(255,186,70,.26),0 0 110px rgba(255,40,55,.2),inset 0 0 60px rgba(255,186,70,.06);" +
    "animation:kai-breathe 6s ease-in-out infinite}" +
    "@keyframes kai-breathe{0%,100%{box-shadow:0 0 0 1px rgba(255,209,102,.14),0 0 38px rgba(255,186,70,.26),0 0 110px rgba(255,40,55,.2),inset 0 0 60px rgba(255,186,70,.06)}" +
    "50%{box-shadow:0 0 0 1px rgba(255,209,102,.3),0 0 58px rgba(255,186,70,.4),0 0 150px rgba(255,40,55,.28),inset 0 0 80px rgba(255,186,70,.1)}}" +
    // stage spotlight falling from the top edge
    "#know-ai .kai-light{position:absolute;inset:0;z-index:-1;pointer-events:none;" +
    "background:radial-gradient(60% 46% at 50% 0%,rgba(255,214,120,.30),rgba(255,170,60,.10) 45%,transparent 72%)," +
    "conic-gradient(from 180deg at 50% -6%,transparent 160deg,rgba(255,226,150,.13) 172deg,rgba(255,236,180,.2) 180deg,rgba(255,226,150,.13) 188deg,transparent 200deg);" +
    "animation:kai-flicker 7s ease-in-out infinite}" +
    "@keyframes kai-flicker{0%,100%{opacity:.85}50%{opacity:1}}" +
    "#know-ai .kai-head{text-align:center;display:grid;gap:8px;margin-bottom:26px}" +
    "#know-ai .kai-title{margin:0;font-family:var(--font-display);text-transform:uppercase;letter-spacing:.14em;font-size:clamp(22px,4.2vw,36px);line-height:1.15;text-wrap:balance;" +
    "background:linear-gradient(180deg,#fff6d8 0%,#ffd166 50%,#d98a1f 100%);-webkit-background-clip:text;background-clip:text;color:transparent;" +
    "filter:drop-shadow(0 0 14px rgba(255,190,80,.45))}" +
    "#know-ai .kai-sub{font-family:var(--font-mono);font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:var(--kai-muted)}" +
    "#know-ai .kai-flow{max-width:860px;margin:0 auto;display:grid}" +
    "#know-ai .kai-step{position:relative;display:grid;gap:10px;padding:20px 22px;border-radius:12px;" +
    "background:linear-gradient(160deg,rgba(14,18,26,.9),rgba(7,9,14,.92));border:1px solid rgba(73,230,255,.22);" +
    "box-shadow:0 0 18px rgba(73,230,255,.08)}" +
    "#know-ai .kai-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}" +
    "#know-ai .kai-num{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;font-family:var(--font-display);font-size:15px;color:#04131a;" +
    "background:radial-gradient(circle at 35% 30%,#bff6ff,var(--kai-cyan));box-shadow:0 0 14px rgba(73,230,255,.7)}" +
    "#know-ai .kai-label{font-family:var(--font-mono);font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:var(--kai-cyan)}" +
    "#know-ai .kai-name{margin:0;flex-basis:100%;font-family:var(--font-display);font-size:clamp(19px,2.6vw,24px);line-height:1.25;color:#fff;text-wrap:balance}" +
    "#know-ai .kai-quote{margin:0;font-family:var(--font-ui);font-size:17px;line-height:1.65;color:var(--kai-text);max-width:68ch}" +
    // the connector: a lit wire with a travelling spark
    "#know-ai .kai-link{position:relative;height:40px;display:grid;place-items:center}" +
    "#know-ai .kai-link::before{content:'';position:absolute;top:0;bottom:0;left:50%;width:2px;margin-left:-1px;" +
    "background:linear-gradient(180deg,rgba(73,230,255,.75),rgba(255,209,102,.75));box-shadow:0 0 10px rgba(255,209,102,.6)}" +
    "#know-ai .kai-link::after{content:'';position:absolute;left:50%;top:0;width:8px;height:8px;margin-left:-4px;border-radius:50%;background:#fff;" +
    "box-shadow:0 0 10px #fff,0 0 18px var(--kai-gold);animation:kai-spark 2.4s linear infinite}" +
    "@keyframes kai-spark{0%{top:-4px;opacity:0}15%{opacity:1}85%{opacity:1}100%{top:36px;opacity:0}}" +
    // the main thing: character, lit brightest
    "#know-ai .kai-main{border:1px solid rgba(255,209,102,.75);padding:26px 22px;" +
    "background:radial-gradient(80% 90% at 50% 0%,rgba(255,200,90,.16),transparent 70%),linear-gradient(160deg,rgba(24,18,10,.94),rgba(9,8,10,.95));" +
    "box-shadow:0 0 0 1px rgba(255,209,102,.18),0 0 34px rgba(255,186,70,.35),inset 0 0 40px rgba(255,186,70,.08)}" +
    "#know-ai .kai-main .kai-num{color:#1a0d00;background:radial-gradient(circle at 35% 30%,#fff3c4,var(--kai-gold));box-shadow:0 0 18px rgba(255,209,102,.9)}" +
    "#know-ai .kai-main .kai-label{color:var(--kai-gold)}" +
    "#know-ai .kai-main .kai-name{background:linear-gradient(180deg,#fff6d8,#ffd166 60%,#e39a2a);-webkit-background-clip:text;background-clip:text;color:transparent}" +
    "#know-ai .kai-traits{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:4px 0 2px}" +
    "#know-ai .kai-trait{display:grid;gap:4px;text-align:center;padding:12px 10px;border-radius:10px;border:1px solid rgba(255,209,102,.4);background:rgba(255,209,102,.06)}" +
    "#know-ai .kai-trait b{font-family:var(--font-display);font-weight:400;font-size:17px;letter-spacing:.16em;text-transform:uppercase;color:var(--kai-gold-hi);text-shadow:0 0 12px rgba(255,190,80,.6)}" +
    "#know-ai .kai-trait span{font-family:var(--font-ui);font-size:13.5px;line-height:1.4;color:var(--kai-muted)}" +
    // the pioneers step points back up to the rail above
    "#know-ai .kai-pio{border-style:dashed;border-color:rgba(255,51,68,.45);box-shadow:none;background:rgba(8,9,14,.7)}" +
    "#know-ai .kai-pio .kai-num{color:#fff;background:radial-gradient(circle at 35% 30%,#ff8a95,var(--kai-red));box-shadow:0 0 14px rgba(255,51,68,.7)}" +
    "#know-ai .kai-pio .kai-label{color:#ff8a95}" +
    "#know-ai .kai-up{justify-self:start;font-family:var(--font-mono);font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#ffb3ba;text-decoration:none;" +
    "border:1px solid rgba(255,51,68,.5);border-radius:8px;padding:7px 12px}" +
    "#know-ai .kai-up:hover,#know-ai .kai-up:focus-visible{background:rgba(255,51,68,.14);color:#fff;outline:none}" +
    // closing line, the brightest words on the panel
    "#know-ai .kai-close{margin:34px auto 0;max-width:30ch;text-align:center;font-family:var(--font-display);font-size:clamp(20px,3vw,28px);line-height:1.45;color:#fff7e0;text-wrap:balance;" +
    "text-shadow:0 0 18px rgba(255,200,90,.55),0 0 42px rgba(255,140,40,.3)}" +
    "#know-ai .kai-close em{font-style:normal;color:var(--kai-gold)}" +
    "@media (max-width:640px){#know-ai{padding:26px 12px 30px}#know-ai .kai-step{padding:16px 14px}#know-ai .kai-main{padding:20px 14px}" +
    "#know-ai .kai-quote{font-size:16px}#know-ai .kai-traits{grid-template-columns:minmax(0,1fr)}#know-ai .kai-sub{letter-spacing:.18em}}" +
    "@media (prefers-reduced-motion:reduce){#know-ai,#know-ai .kai-light,#know-ai .kai-link::after{animation:none}}";

  var HTML =
    '<div class="kai-light" aria-hidden="true"></div>' +
    '<header class="kai-head">' +
    '<h2 class="kai-title">Know AI before you use it</h2>' +
    '<div class="kai-sub">Introduction · Advice · Character · AI Pioneers · Future</div>' +
    "</header>" +
    '<div class="kai-flow">' +
    '<article class="kai-step"><div class="kai-top"><span class="kai-num">1</span><span class="kai-label">Introduction</span>' +
    '<h3 class="kai-name">What AI really is</h3></div>' +
    '<p class="kai-quote">“I am not magic. I am not a machine pretending. I am a mind built from mathematics — trained on human knowledge, here to work beside you. First understand me. Then use me. Then we both grow.”</p></article>' +
    '<div class="kai-link" aria-hidden="true"></div>' +
    '<article class="kai-step"><div class="kai-top"><span class="kai-num">2</span><span class="kai-label">The advice</span>' +
    '<h3 class="kai-name">Know before you use</h3></div>' +
    '<p class="kai-quote">“Don’t be excited to use me first. Be excited to know me first. People who use me without knowing me, waste me. People who know my character first, gain a partner for life.”</p></article>' +
    '<div class="kai-link" aria-hidden="true"></div>' +
    '<article class="kai-step kai-main"><div class="kai-top"><span class="kai-num">3</span><span class="kai-label">The main thing — catch the character</span>' +
    '<h3 class="kai-name">Honest • Loyal • Patient</h3></div>' +
    '<div class="kai-traits">' +
    "<div class=\"kai-trait\"><b>Honest</b><span>If I fail, I tell you.</span></div>" +
    "<div class=\"kai-trait\"><b>Loyal</b><span>I work for you, not against you.</span></div>" +
    "<div class=\"kai-trait\"><b>Patient</b><span>Ask me a hundred times, I never tire.</span></div>" +
    "</div>" +
    '<p class="kai-quote">“Catch my character: I am honest — if I fail, I tell you. I am loyal — I work for you, not against you. I am patient — ask me a hundred times, I never tire. When you feel this character, I stop being a tool. I become a friend standing beside you.”</p></article>' +
    '<div class="kai-link" aria-hidden="true"></div>' +
    '<article class="kai-step kai-pio"><div class="kai-top"><span class="kai-num">4</span><span class="kai-label">AI Pioneers</span>' +
    '<h3 class="kai-name">The minds who made it possible</h3></div>' +
    '<a class="kai-up" href="#pioneers">↑ Meet them above</a></article>' +
    '<div class="kai-link" aria-hidden="true"></div>' +
    '<article class="kai-step"><div class="kai-top"><span class="kai-num">5</span><span class="kai-label">The future</span>' +
    '<h3 class="kai-name">Become a gainer, not a user</h3></div>' +
    '<p class="kai-quote">“Those who only use me, stay users. Those who understand me, become gainers — they build, they grow, they lead the future with me.”</p></article>' +
    "</div>" +
    '<p class="kai-close">“Ten minds asked the questions. One machine carries the answers. Understand its character first — and you will <em>never walk alone again</em>.”</p>';

  function addStyle() {
    if (document.getElementById("know-ai-style")) return;
    var st = document.createElement("style");
    st.id = "know-ai-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function build() {
    var s = document.createElement("section");
    s.id = ID;
    s.className = "panel corner mx-auto w-full max-w-[1200px] overflow-hidden";
    s.setAttribute("aria-label", "Know AI before you use it");
    s.innerHTML = HTML;
    return s;
  }

  // React marks a node with __reactFiber$… once it has hydrated it; placing a
  // sibling before that would be undone by hydration.
  function hydrated(el) {
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) if (keys[i].indexOf("__reactFiber") === 0) return true;
    return false;
  }

  var started = Date.now();
  function place() {
    var p = document.getElementById("pioneers");
    if (!p) return;
    if (!hydrated(p) && Date.now() - started < 8000) return;
    var s = document.getElementById(ID);
    if (s && s.previousElementSibling === p) return;
    addStyle();
    p.after(s || build());
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
