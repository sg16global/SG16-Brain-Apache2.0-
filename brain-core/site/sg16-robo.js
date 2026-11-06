// SG16 — Brain Robo, the homepage guide (owner request 2026-11-06).
//
// Replaces the blue globe on the right of the hero with the SG16 Brain Robo.
// 2026-11-06 (owner's own robot, IMG_3188): glossy red SG16 Brain Robo in red
// smoke, colours as the owner made them. Two clips, cross-faded:
//   /images/sg16-robo-idle.mp4  standing, looking, blinking (a seamless
//                               forward-and-back loop) - quiet and talking
//   /images/sg16-robo-wave.mp4  the camera moves in and it waves (played once)
//                               - on "Welcome", when tapped, and at the end
// From the visitor's first touch on the homepage it waves at once, then
// again every 10 s while it is on screen (owner request).
// Body language follows the voice: it waves when it greets, and its lights
// pulse on every spoken word (speech "boundary" events; a steady rhythm when
// the device has no voice and the words are only shown), with
// /images/sg16-robo.jpg as its still (slow connections, reduced motion).
// On screens 1280 px and wider the robot stands in the open stage area RIGHT
// of the seal (never touching it), as large as that space allows; layout()
// measures the seal on the stage picture and the panels below the hero.
// When a visitor opens the homepage the robot greets them in its speech
// bubble; on their first tap or click it speaks (the browser's own built-in
// voice, on-device voices only — no outside service) and walks them through
// the page: the 10 AI pioneers, the world's AI, what AI is, then the details.
// Tapping the robot plays the tour again; "Stop", or scrolling yourself,
// ends it.
//
// The homepage is a static mirror of the pointoni Next app, so like the other
// sg16-*.js panels this is added beside it instead of rebuilding the mirror:
// the globe is hidden with CSS and the robot is placed in its column once
// React has hydrated it. A MutationObserver puts it back whenever the
// homepage is rendered again (client-side navigation back to "/").
(function () {
  "use strict";
  var ID = "sg16-robo";
  var DOCK = "sg16-robo-dock";
  var IDLE_VIDEO = "/images/sg16-robo-idle.mp4";
  var WAVE_VIDEO = "/images/sg16-robo-wave.mp4";
  var POSTER = "/images/sg16-robo.jpg";
  var SEEN = "sg16-robo-toured"; // the tour starts by itself once per visit
  var HELLO = "Welcome! Tap anywhere — let's go meet our 10 AI pioneers.";
  var AGAIN = "Tap me to take the tour again.";

  // target = the section shown while the lines are spoken (null = the hero)
  var STEPS = [
    { target: null, wave: true, say: [
      "Welcome to Sovereign SG16 Brain!",
      "Let's go. I will introduce our ten AI pioneers, then the world's AI, then what AI is.",
    ] },
    { target: "pioneers", say: [
      "First, our ten AI pioneers: Alan Turing, John McCarthy, Marvin Minsky, Geoffrey Hinton and Arthur Samuel.",
      "Claude Shannon, Norbert Wiener, Herbert Simon, Allen Newell and Frank Rosenblatt. These minds made AI possible.",
    ] },
    { target: "world-ai", say: [
      "Next, the world's AI: Claude, ChatGPT, Gemini, Mistral, DeepSeek, Llama, and more.",
      "People all around the world use them every day.",
    ] },
    { target: "know-ai", say: [
      "So, what is AI?",
      "AI is not magic. It is a mind built from mathematics, trained on human knowledge, here to work beside you.",
      "Know its character first: honest, loyal and patient.",
    ] },
    { target: "what-is-ai", say: [
      "Now the details. AI is technology that processes information, recognizes patterns, and helps people solve problems.",
      "With AI you learn faster, work smarter, and solve bigger problems.",
    ] },
    { target: "chat", wave: true, say: [
      "That is our tour. Ask me anything here in the chat. I am SG16 Brain.",
    ] },
  ];

  var COL = "#home .order-3.lg\\:justify-end";
  var CSS =
    // the globe this replaces (also hidden by an inline style in index.html, so it never flashes)
    COL + ">:not(#" + ID + "){display:none!important}" +
    "#" + ID + "{position:relative;width:250px;margin:0 auto;display:grid;justify-items:center;gap:8px;animation:sr-in .7s ease-out both}" +
    "@media (min-width:640px){#" + ID + "{width:300px}}" +
    "@media (min-width:1024px){#" + ID + "{width:320px}}" +
    // wide screens: placed by layout() in the open stage right of the seal
    "#" + ID + ".sr-free{position:absolute;z-index:5;margin:0}" +
    // ...with the speech bubble beside its head when there is room
    "#" + ID + ".sr-side .sr-bubble{position:absolute;right:calc(100% + 12px);top:10%;width:var(--sr-bw,240px);z-index:1}" +
    "#" + ID + ".sr-side .sr-bubble::after{left:auto;right:-7px;top:50%;bottom:auto;margin:-6px 0 0;transform:rotate(-45deg)}" +
    "@keyframes sr-in{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}" +
    // speech bubble, in the site's dark panel + red glow style
    "#" + ID + " .sr-bubble{position:relative;margin:0;max-width:100%;padding:10px 14px;border-radius:12px;" +
    "border:1px solid rgba(255,51,68,.6);background:linear-gradient(160deg,rgba(26,8,12,.94),rgba(8,8,12,.94));" +
    "box-shadow:0 0 22px rgba(255,40,55,.35),inset 0 0 18px rgba(255,60,70,.08);" +
    "font-family:var(--font-ui);font-size:14px;line-height:1.45;font-weight:600;color:#ffe9ec;text-align:center;text-wrap:balance}" +
    "#" + ID + " .sr-bubble::after{content:'';position:absolute;left:50%;bottom:-7px;width:12px;height:12px;margin-left:-6px;transform:rotate(45deg);" +
    "background:#0d080b;border-right:1px solid rgba(255,51,68,.6);border-bottom:1px solid rgba(255,51,68,.6)}" +
    // the robot, full body: its red scene fades into the red stage at the sides,
    // only lightly at the top and bottom, so the head and feet stay whole
    "#" + ID + " .sr-bot{position:relative;display:block;width:100%;padding:0;border:0;background:none;cursor:pointer;border-radius:18px;-webkit-tap-highlight-color:transparent}" +
    "#" + ID + " .sr-bot:focus-visible{outline:2px solid rgba(255,90,100,.9);outline-offset:4px}" +
    "#" + ID + " .sr-glow{position:absolute;left:8%;right:8%;bottom:-2%;height:16%;border-radius:50%;pointer-events:none;" +
    "background:radial-gradient(ellipse at center,rgba(255,40,55,.55),rgba(255,40,55,.15) 55%,transparent 72%);filter:blur(10px)}" +
    "#" + ID + " .sr-bot video{position:relative;display:block;width:100%;height:auto;aspect-ratio:600/1056;object-fit:cover;transition:transform .3s ease,opacity .35s ease,filter .12s ease;" +
    "-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 13%,#000 87%,transparent 100%),linear-gradient(180deg,transparent 0,#000 5%,#000 92%,transparent 100%);" +
    "-webkit-mask-composite:source-in;" +
    "mask-image:linear-gradient(90deg,transparent 0,#000 13%,#000 87%,transparent 100%),linear-gradient(180deg,transparent 0,#000 5%,#000 92%,transparent 100%);" +
    "mask-composite:intersect;filter:drop-shadow(0 0 18px rgba(255,40,55,.35))}" +
    "#" + ID + " .sr-bot:hover video{transform:scale(1.02)}" +
    // the wave clip lies over the idle loop and cross-fades in while it plays
    "#" + ID + " .sr-bot .sr-wave{position:absolute;left:0;top:0;opacity:0}" +
    "#" + ID + ".sr-waving .sr-bot .sr-wave{opacity:1}" +
    "#" + ID + ".sr-waving .sr-bot .sr-idle{opacity:0}" +
    // a light pulse on every spoken word
    "#" + ID + ".sr-word .sr-bot video{filter:drop-shadow(0 0 28px rgba(255,60,75,.85)) brightness(1.12)}" +
    "#" + ID + ".sr-talking .sr-glow{animation:sr-pulse 1.2s ease-in-out infinite}" +
    "@keyframes sr-pulse{0%,100%{opacity:.75}50%{opacity:1;transform:scale(1.05)}}" +
    // the section being introduced
    ".sr-focus{outline:2px solid rgba(255,70,80,.8);outline-offset:6px;transition:outline-color .4s}" +
    // small robot that follows the visitor down the page during the tour
    "#" + DOCK + "{position:fixed;right:14px;bottom:14px;z-index:55;display:flex;align-items:center;gap:10px;max-width:min(380px,calc(100vw - 28px));" +
    "padding:8px 10px 8px 8px;border-radius:14px;border:1px solid rgba(255,51,68,.6);" +
    "background:linear-gradient(160deg,rgba(26,8,12,.96),rgba(8,8,12,.96));box-shadow:0 0 26px rgba(255,40,55,.4),0 10px 30px rgba(0,0,0,.55);" +
    "animation:sr-in .4s ease-out both}" +
    "#" + DOCK + "[hidden]{display:none}" +
    // the robot's face, from its still
    "#" + DOCK + " .sd-face{flex:none;width:58px;height:58px;border-radius:50%;background:#2a0508 url(" + POSTER + ") 50% 13%/140% auto no-repeat;" +
    "border:1px solid rgba(255,90,100,.7);box-shadow:0 0 14px rgba(255,40,55,.6)}" +
    "#" + DOCK + " p{margin:0;font-family:var(--font-ui);font-size:13.5px;line-height:1.4;font-weight:600;color:#ffe9ec}" +
    "#" + DOCK + " button{flex:none;align-self:flex-start;padding:4px 9px;border-radius:8px;border:1px solid rgba(255,51,68,.55);background:rgba(255,51,68,.1);" +
    "font-family:var(--font-mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#ffb3ba;cursor:pointer}" +
    "#" + DOCK + " button:hover,#" + DOCK + " button:focus-visible{background:rgba(255,51,68,.25);color:#fff;outline:none}" +
    "@media (prefers-reduced-motion:reduce){#" + ID + ",#" + ID + ".sr-talking .sr-glow,#" + DOCK + "{animation:none}}";

  function addStyle() {
    if (document.getElementById(ID + "-style")) return;
    var st = document.createElement("style");
    st.id = ID + "-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function seen() {
    try { return sessionStorage.getItem(SEEN) === "1"; } catch (e) { return false; }
  }

  function build() {
    var s = document.createElement("div");
    s.id = ID;
    s.innerHTML =
      '<p class="sr-bubble" role="status" aria-live="polite"></p>' +
      '<button class="sr-bot" type="button" aria-label="SG16 Brain Robo — play the welcome tour">' +
      '<span class="sr-glow" aria-hidden="true"></span>' +
      '<video class="sr-idle" src="' + IDLE_VIDEO + '" poster="' + POSTER + '" width="600" height="1056" muted loop playsinline autoplay preload="auto" aria-hidden="true"></video>' +
      '<video class="sr-wave" src="' + WAVE_VIDEO + '" width="600" height="1056" muted playsinline preload="auto" aria-hidden="true"></video></button>';
    s.querySelector(".sr-bubble").textContent = running ? line : seen() ? AGAIN : HELLO;
    var v = s.querySelector(".sr-idle"), w = s.querySelector(".sr-wave");
    v.muted = true; w.muted = true; // set as properties too: some browsers only autoplay when they are
    // the wave shows only once its first frame is playing, and hands back when done
    w.addEventListener("playing", function () { s.classList.add("sr-waving"); });
    w.addEventListener("ended", function () { s.classList.remove("sr-waving"); });
    if (reduceMotion()) {
      v.removeAttribute("autoplay"); // the still only
    } else {
      var play = function () {
        var p = v.play(); if (p && p.catch) p.catch(function () {});
        // the first time the robot appears it waves hello (silently: a page
        // may not speak before the visitor touches it)
        if (!greeted) { greeted = true; setTimeout(wave, 1200); }
      };
      if (v.readyState >= 2) play(); else v.addEventListener("canplay", play, { once: true });
    }
    s.querySelector(".sr-bot").addEventListener("click", function () {
      if (running) stopTour();
      else startTour();
    });
    return s;
  }

  var greeted = false;
  function reduceMotion() {
    return Boolean(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // body language: the wave clip, played once over the idle loop
  function wave() {
    var r = document.getElementById(ID);
    var w = r && r.querySelector(".sr-wave");
    if (!w || reduceMotion()) return;
    try { w.currentTime = 0; } catch (e) {}
    var p = w.play();
    if (p && p.catch) p.catch(function () {});
  }

  // from the first touch: a wave now, then one every 10 s while the robot is
  // on screen, the tab is open and the visitor is on the homepage
  var WAVE_EVERY_MS = 10000;
  var waveLoop = 0;
  function startWaveLoop() {
    if (waveLoop || reduceMotion()) return;
    wave();
    waveLoop = setInterval(function () {
      var r = document.getElementById(ID);
      if (!r || document.hidden || !heroVisible || location.pathname !== "/") return;
      if (!r.classList.contains("sr-waving")) wave();
    }, WAVE_EVERY_MS);
  }

  // ...and a light pulse on each spoken word
  var pulseTimer = 0;
  function pulse() {
    var r = document.getElementById(ID);
    if (!r || reduceMotion()) return;
    r.classList.add("sr-word");
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(function () { r.classList.remove("sr-word"); }, 140);
  }

  function dock() {
    var d = document.getElementById(DOCK);
    if (d) return d;
    d = document.createElement("div");
    d.id = DOCK;
    d.hidden = true;
    d.innerHTML = '<span class="sd-face" aria-hidden="true"></span><p></p><button type="button">Stop</button>';
    d.querySelector("p").textContent = line;
    d.querySelector("button").addEventListener("click", stopTour);
    document.body.appendChild(d);
    return d;
  }

  // ---- what the robot says -------------------------------------------------
  var synth = window.speechSynthesis || null;
  if (synth) try { synth.getVoices(); } catch (e) { synth = null; } // warm the voice list

  // On-device voices only (localService): an online voice would send the
  // words to an outside service. No on-device voice = the bubble only.
  function voice() {
    if (!synth) return null;
    var vs = synth.getVoices().filter(function (v) { return v.localService; });
    var en = vs.filter(function (v) { return /^en(-|_|$)/i.test(v.lang); });
    var pick = function (list, re) {
      for (var i = 0; i < list.length; i++) if (re.test(list[i].lang)) return list[i];
      return null;
    };
    return pick(en, /^en.US/i) || pick(en, /^en.GB/i) || en[0] || null;
  }

  var running = false;
  var run = 0; // bumped on every start/stop, so stale callbacks do nothing
  var line = HELLO;
  var heroVisible = true;
  var timer = 0;

  function show(text) {
    line = text;
    var r = document.getElementById(ID);
    if (r) r.querySelector(".sr-bubble").textContent = text;
    var d = document.getElementById(DOCK);
    if (d) d.querySelector("p").textContent = text;
  }

  function talking(on) {
    var r = document.getElementById(ID);
    if (r) r.classList.toggle("sr-talking", on);
  }

  function speak(text, done) {
    var finished = false;
    function fin() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done();
    }
    var ms = 1600 + text.length * 70; // reading time when there is no voice
    var v = voice();
    var beat = 0;
    var heard = false;
    var stopBeat = function () { clearInterval(beat); beat = 0; };
    if (v) {
      var u = new SpeechSynthesisUtterance(text);
      u.voice = v;
      u.lang = v.lang;
      u.rate = 1;
      u.pitch = 1.1;
      // lights on each word as it is spoken
      u.onboundary = function (e) {
        if (!e.name || e.name === "word") { heard = true; stopBeat(); pulse(); }
      };
      u.onend = function () { stopBeat(); fin(); };
      u.onerror = function () { stopBeat(); fin(); };
      synth.speak(u);
      // a voice that sends no word events still gets a talking rhythm
      beat = setInterval(function () { if (!heard) pulse(); }, 320);
      timer = setTimeout(function () { stopBeat(); fin(); }, ms + 8000); // in case the browser never reports the end
    } else {
      beat = setInterval(pulse, 320); // words only shown: the same rhythm
      timer = setTimeout(function () { stopBeat(); fin(); }, ms);
    }
  }

  function updateDock() {
    var d = document.getElementById(DOCK);
    if (d) d.hidden = !(running && !heroVisible);
  }

  var focused = null;
  function focusOn(el) {
    if (focused) focused.classList.remove("sr-focus");
    focused = el;
    if (el) el.classList.add("sr-focus");
  }

  function scrollToEl(el) {
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var top = el ? el.getBoundingClientRect().top + window.pageYOffset - 72 : 0; // 58px fixed header
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }

  function step(my, i) {
    if (my !== run) return;
    if (location.pathname !== "/") return stopTour();
    if (i >= STEPS.length) return finish();
    var s = STEPS[i];
    var el = s.target ? document.getElementById(s.target) : null;
    if (s.target && !el) return step(my, i + 1); // section not on the page: skip it
    focusOn(el);
    scrollToEl(el);
    talking(true);
    if (s.wave) wave();                         // greeting and goodbye
    var j = 0;
    (function next() {
      if (my !== run) return;
      if (j >= s.say.length) {
        timer = setTimeout(function () { step(my, i + 1); }, 500);
        return;
      }
      var text = s.say[j++];
      show(text);
      speak(text, function () {
        if (my === run) timer = setTimeout(next, 250);
      });
    })();
  }

  // the visitor takes over: their own scrolling ends the tour
  var SCROLL_KEYS = { ArrowUp: 1, ArrowDown: 1, PageUp: 1, PageDown: 1, Home: 1, End: 1, " ": 1 };
  function userScroll(e) {
    if (e.type === "keydown" && !SCROLL_KEYS[e.key]) return;
    stopTour();
  }
  function listen(on) {
    var f = on ? "addEventListener" : "removeEventListener";
    window[f]("wheel", userScroll, { passive: true });
    window[f]("touchmove", userScroll, { passive: true });
    window[f]("keydown", userScroll);
  }

  function startTour() {
    stopTour();
    try { sessionStorage.setItem(SEEN, "1"); } catch (e) {}
    running = true;
    dock();
    updateDock();
    listen(true);
    step(++run, 0);
  }

  function end(text) {
    run++;
    clearTimeout(timer);
    if (synth) try { synth.cancel(); } catch (e) {}
    running = false;
    listen(false);
    talking(false);
    focusOn(null);
    show(text);
    updateDock();
  }

  function stopTour() {
    if (running) end(AGAIN);
  }

  function finish() {
    end(AGAIN);
  }

  // first tap/click on the homepage starts the tour (speech needs a tap:
  // browsers do not let a page talk before the visitor touches it)
  var SKIP =
    "a,button,input,textarea,select,label,summary,[role=button],[contenteditable],video,audio," +
    "header,nav,#chat,#pioneers,#project-scan,#sovereign-side-panel,#" + DOCK;
  // any first touch or click on the homepage wakes the robot's waving
  document.addEventListener("pointerdown", function () {
    if (location.pathname === "/" && document.getElementById(ID)) startWaveLoop();
  }, { capture: true, passive: true });

  document.addEventListener("click", function (e) {
    if (running || seen() || location.pathname !== "/") return;
    if (!document.getElementById(ID)) return;
    var t = e.target;
    if (t && t.closest && t.closest(SKIP)) return;
    startTour();
  });

  // ---- placing the robot ---------------------------------------------------
  // React marks a node with __reactFiber$… once it has hydrated it; adding a
  // child before that would be undone by hydration.
  function hydrated(el) {
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) if (keys[i].indexOf("__reactFiber") === 0) return true;
    return false;
  }

  var io = "IntersectionObserver" in window
    ? new IntersectionObserver(function (entries) {
        heroVisible = entries[entries.length - 1].isIntersecting;
        updateDock();
      }, { threshold: 0.35 })
    : null;

  // ---- wide screens: the open stage area right of the seal ------------------
  // The stage picture (2400 x 1352, drawn "cover" at 50% 45%) has the seal at
  // 49.7% of its width, 28.8% wide. The robot stands right of it with a gap,
  // anchored to the right edge, as big as fits above the panels below.
  var STAGE = { w: 2400, h: 1352, sealCenter: 0.4973, sealHalf: 0.144 };
  var MIN_FREE = 300, MAX_FREE = 520, EDGE = 20, GAP = 24;

  function layout() {
    var el = document.getElementById(ID), home = document.getElementById("home");
    if (!el || !home) return;
    var set = function (free, side, bw) {
      el.classList.toggle("sr-free", free);
      el.classList.toggle("sr-side", free && side);
      if (!free) el.style.left = el.style.top = el.style.width = "";
      if (free && side) el.style.setProperty("--sr-bw", bw + "px");
    };
    if (window.innerWidth < 1280) return set(false);
    var bg = home.querySelector(":scope > div[aria-hidden]");
    if (!bg) return set(false);
    // measured on screen (viewport px); the site may scale itself with CSS
    // zoom, so z converts screen px back to the hero's own px for the styles
    var hr = home.getBoundingClientRect(), br = bg.getBoundingClientRect();
    var z = home.offsetWidth ? hr.width / home.offsetWidth : 1;
    if (!(z > 0)) z = 1;
    var scale = Math.max(br.width / STAGE.w, br.height / STAGE.h);
    var imgLeft = br.left - hr.left + (br.width - STAGE.w * scale) / 2;
    var sealRight = imgLeft + STAGE.w * scale * (STAGE.sealCenter + STAGE.sealHalf);
    var W = hr.width, heroH = hr.height;
    // the feet may stand a little below the red stage on the open right side
    var floor = heroH + Math.min(180 * z, heroH * 0.3);
    var below = home.nextElementSibling ? home.nextElementSibling.children : [];
    for (var w = MAX_FREE; w >= MIN_FREE; w -= 10) {
      var ws = w * z;                       // the robot's width on screen
      var left = W - EDGE * z - ws;
      var room = left - (sealRight + GAP * z);
      if (room < 0) continue;
      var side = room >= 200 * z;
      set(true, side, Math.min(260, room / z));
      el.style.width = w + "px";
      var h = el.offsetHeight * z;
      // never on a panel below the hero
      var limit = floor;
      for (var i = 0; i < below.length; i++) {
        var cr = below[i].getBoundingClientRect();
        if (cr.right - hr.left > left && cr.left - hr.left < left + ws) {
          limit = Math.min(limit, cr.top - hr.top - 12 * z);
          break;
        }
      }
      if (h + 12 * z > limit) continue;
      el.style.left = left / z + "px";
      el.style.top = Math.max(12, Math.min(limit - h, heroH - h * 0.88) / z) + "px";
      return;
    }
    set(false); // not enough room: the robot stays in its column
  }

  var laidOut = false;
  function relayout() {
    if (laidOut) return;
    laidOut = true;
    requestAnimationFrame(function () {
      laidOut = false;
      layout();
    });
  }

  var started = Date.now();
  function place() {
    if (location.pathname !== "/") {
      if (running) stopTour();
      return;
    }
    var col = document.querySelector(COL);
    if (!col) return;
    addStyle();
    if (!hydrated(col) && Date.now() - started < 8000) return;
    var r = document.getElementById(ID);
    if (r && r.parentElement === col) return;
    if (r) r.remove();
    r = build();
    col.appendChild(r);
    if (io) {
      io.disconnect();
      io.observe(r);
    }
    layout();
    if (hero && "ResizeObserver" in window) {
      hero.disconnect();
      hero.observe(document.getElementById("home"));
    }
  }
  var hero = "ResizeObserver" in window ? new ResizeObserver(relayout) : null;

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
    addStyle();
    window.addEventListener("resize", relayout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
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
