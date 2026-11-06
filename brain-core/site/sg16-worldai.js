// SG16 — "World's AI" rail above the footer (owner request 2026-10-18).
//
// Fills the gap between the homepage's last panel and the footer with a
// continuously moving rail of the world's AI names. Names are written as
// text in the site's own style, not as company logos (owner's choice: no
// trademark artwork), with a not-affiliated line. Placed as the last child
// of the homepage content column once React has hydrated it; a
// MutationObserver puts it back when the homepage renders again.
(function () {
  "use strict";
  var ID = "world-ai";
  var AIS = [
    ["Claude", "Anthropic"],
    ["ChatGPT", "OpenAI"],
    ["Gemini", "Google"],
    ["Mistral", "Mistral AI"],
    ["DeepSeek", "DeepSeek"],
    ["Llama", "Meta"],
    ["Grok", "xAI"],
    ["Copilot", "Microsoft"],
    ["Qwen", "Alibaba"],
    ["Command", "Cohere"],
    ["Perplexity", "Perplexity AI"],
  ];

  var CSS =
    "#world-ai{position:relative;margin-top:22px;padding:30px 0 10px;text-align:center}" +
    "#world-ai::before{content:'';position:absolute;left:8%;right:8%;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,209,102,.55),transparent);box-shadow:0 0 12px rgba(255,190,80,.5)}" +
    "#world-ai .wa-title{margin:0;font-family:var(--font-display);text-transform:uppercase;letter-spacing:.2em;font-size:clamp(22px,3.4vw,32px);" +
    "background:linear-gradient(180deg,#fff6d8 0%,#ffd166 50%,#d98a1f 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 12px rgba(255,190,80,.4))}" +
    "#world-ai .wa-sub{margin-top:6px;font-family:var(--font-mono);font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#9aa6b8}" +
    "#world-ai .wa-rail{position:relative;overflow:hidden;margin-top:22px;padding:18px 0;border-top:1px solid rgba(255,52,64,.22);border-bottom:1px solid rgba(255,52,64,.22);" +
    "background:linear-gradient(90deg,rgba(255,40,55,.05),rgba(73,230,255,.04),rgba(255,40,55,.05));" +
    "-webkit-mask-image:linear-gradient(90deg,transparent,#000 9%,#000 91%,transparent);mask-image:linear-gradient(90deg,transparent,#000 9%,#000 91%,transparent)}" +
    "#world-ai .wa-track{display:flex;width:max-content;animation:wa-run 46s linear infinite}" +
    "#world-ai .wa-rail:hover .wa-track{animation-play-state:paused}" +
    "@keyframes wa-run{from{transform:translateX(0)}to{transform:translateX(-50%)}}" +
    "#world-ai .wa-item{display:flex;align-items:center;gap:0;padding:0 34px;position:relative}" +
    "#world-ai .wa-item::after{content:'\\25C6';position:absolute;right:-5px;top:50%;transform:translateY(-50%);font-size:10px;color:#ff3344;text-shadow:0 0 8px rgba(255,51,68,.8)}" +
    "#world-ai .wa-name{display:grid;justify-items:center;gap:2px}" +
    "#world-ai .wa-name b{font-family:var(--font-display);font-weight:400;font-size:clamp(20px,2.4vw,26px);letter-spacing:.06em;color:#f4f7fb;white-space:nowrap;text-shadow:0 0 14px rgba(160,220,255,.35)}" +
    "#world-ai .wa-name span{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.28em;text-transform:uppercase;color:#49e6ff;white-space:nowrap}" +
    "#world-ai .wa-note{margin:12px auto 0;font-family:var(--font-mono);font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:#6f7a8c}" +
    "@media (max-width:640px){#world-ai .wa-item{padding:0 22px}#world-ai .wa-sub,#world-ai .wa-note{letter-spacing:.14em}}" +
    "@media (prefers-reduced-motion:reduce){#world-ai .wa-track{animation:none;flex-wrap:wrap;justify-content:center;width:auto;row-gap:14px}" +
    "#world-ai .wa-track [aria-hidden]{display:none}#world-ai .wa-rail{-webkit-mask-image:none;mask-image:none}}";

  function items(hidden) {
    var out = "";
    for (var i = 0; i < AIS.length; i++) {
      out += '<div class="wa-item"' + (hidden ? ' aria-hidden="true"' : "") + '><div class="wa-name"><b>' + AIS[i][0] + "</b><span>" + AIS[i][1] + "</span></div></div>";
    }
    return out;
  }

  // the list twice, so the rail loops without a seam (-50% = one full list)
  var HTML =
    '<h2 class="wa-title">World’s AI</h2>' +
    '<div class="wa-sub">The minds of today’s AI</div>' +
    '<div class="wa-rail"><div class="wa-track">' + items(false) + items(true) + "</div></div>" +
    '<p class="wa-note">Independent. Not affiliated with these companies.</p>';

  function addStyle() {
    if (document.getElementById("world-ai-style")) return;
    var st = document.createElement("style");
    st.id = "world-ai-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function build() {
    var s = document.createElement("section");
    s.id = ID;
    s.setAttribute("aria-label", "World's AI");
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
    var p = document.getElementById("pioneers");
    var col = p && p.parentElement;
    if (!col) return;
    if (!hydrated(col) && Date.now() - started < 8000) return;
    var s = document.getElementById(ID);
    if (s && s.parentElement === col && !s.nextElementSibling) return;
    addStyle();
    col.appendChild(s || build());
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
