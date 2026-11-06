// Sovereign SG16 Brain interface.
//
// Two layers live in this file:
//   1. the backend wiring (gate verdicts, reasoning plan, parity, billing) -
//      unchanged in behaviour; every endpoint it called before it still calls;
//   2. the premium shell (collapsible 260px sidebar, slide-over panels,
//      on-device account / files / devices / settings).
//
// The operational diagnostics (3-GPT joint room, sealed perimeter, master
// door, reasoning plan, gate reasons, parity) stay mounted in the DOM so the
// brain keeps rendering them on every payload - they are simply out of the
// public view until an operator reveals them from Settings.
import { api, getJson, fileToBase64 } from "./api.js";
import { renderMarkdown } from "./markdown.js";
import {
  sessionId,
  appendHistory,
  loadHistory,
  store,
  exportLocalFolder,
} from "./storage.js";
import {
  PASSES,
  resolveBilling,
  effectivePrice,
  startCheckout,
  confirmDodoReturn,
  persistPricingStatus,
  currentPass,
  saveLocalProfile,
  currentIdentity,
  generateApiKey,
  currentApiKey,
} from "./billing.js";

const $ = (id) => document.getElementById(id);
const els = {
  dot: $("dot"),
  status: $("chip-status"),
  designation: $("chip-designation"),
  transport: $("chip-transport"),
  core: $("chip-core"),
  gate: $("chip-gate"),
  transcript: $("transcript"),
  input: $("input"),
  composer: $("composer"),
  audio: $("audio"),
  audioName: $("audio-name"),
  reset: $("reset"),
  charter: $("charter"),
  charterTitle: $("charter-title"),
  jointRisk: $("joint-risk"),
  threshold: $("threshold"),
  verdict: $("verdict"),
  door: $("door"),
  planHead: $("plan-head"),
  planRoute: $("plan-route"),
  planTokens: $("plan-tokens"),
  planSha: $("plan-sha"),
  planSeal: $("plan-seal"),
  planSteps: $("plan-steps"),
  reasons: $("reasons"),
  parityCount: $("parity-count"),
  parityOk: $("parity-ok"),
  parityDigest: $("parity-digest"),
  regionLine: $("region-line"),
  buyApi: $("buy-api"),
  openPortal: $("open-portal"),
  goChat: $("go-chat"),
  portal: $("portal"),
  portalClose: $("portal-close"),
  portalKey: $("portal-key"),
  genKey: $("gen-key"),
  pricingNote: $("pricing-note"),
  humanitarian: $("humanitarian"),
  notice: $("notice"),
  noticeRef: $("notice-ref"),
  noticeSession: $("notice-session"),
  noticeWarnings: $("notice-warnings"),
  noticeReason: $("notice-reason"),
  noticeStatements: $("notice-statements"),
  noticeAck: $("notice-ack"),
  noticeDisclaimer: $("notice-disclaimer"),
  vipChip: $("vip-chip"),
  // shell
  appShell: $("app-shell"),
  sidebar: $("sidebar"),
  sidebarToggle: $("sidebar-toggle"),
  sidebarHide: $("sidebar-hide"),
  sidebarScrim: $("sidebar-scrim"),
  newChat: $("new-chat"),
  signOut: $("sign-out"),
  viewPanel: $("view-panel"),
  viewPanelTitle: $("view-panel-title"),
  viewPanelBody: $("view-panel-body"),
  viewPanelClose: $("view-panel-close"),
  diagnostics: $("diagnostics"),
};

let session = sessionId();
const PANEL_THROTTLE_MS = 800;
let lastSubmitAt = 0;

// Live snapshot from the sovereign host, reused by the side panels.
const host = {
  charter: [],
  designation: null,
  officialName: null,
  transport: null,
  gate: null,
  parity: null,
  ready: false,
};

// ------------------------------------------------------------------
// tiny DOM helper (textContent everywhere - never innerHTML on user data)
// ------------------------------------------------------------------
// Panel builders nest arrays of nodes; flatten them all the way down so a
// nested list can never reach appendChild.
function flatten(nodes) {
  return [].concat(nodes).flat(Infinity).filter((n) => n != null && n !== false);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of flatten(children)) {
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function row(label, value) {
  return el("div", { class: "view-row" }, [
    el("span", { text: label }),
    el("b", { text: String(value ?? "—") }),
  ]);
}

function card(title, children) {
  return el("div", { class: "view-card" }, [
    title ? el("h3", { text: title }) : null,
    ...flatten(children),
  ]);
}

function emptyState(text) {
  return el("div", { class: "view-empty", text });
}

function fmtTime(seconds) {
  const ms = typeof seconds === "number" ? seconds * 1000 : new Date(seconds).getTime();
  if (!ms || Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleString();
}

// ------------------------------------------------------------------
// 3D Perspective Card Motion Engine
// ------------------------------------------------------------------
function init3DTilt() {
  /* disabled — 3D perspective transforms soften panel edges */
}

// ------------------------------------------------------------------
// Message Rendering (Safe Markdown)
// ------------------------------------------------------------------
function addMessage(kind, tag, text, markdown = true) {
  const node = document.createElement("div");
  node.className = `msg ${kind}`;
  const label = document.createElement("span");
  label.className = "tag";
  label.textContent = tag;
  node.appendChild(label);
  const body = document.createElement("div");
  if (markdown) body.innerHTML = renderMarkdown(text);
  else body.textContent = text;
  node.appendChild(body);
  els.transcript.appendChild(node);
  els.transcript.scrollTop = els.transcript.scrollHeight;
  return node;
}

function setBar(member, risk) {
  const row = document.querySelector(`.gpt[data-member="${member}"]`);
  if (!row) return;
  const pct = Math.max(0, Math.min(1, risk)) * 100;
  row.querySelector(".bar i").style.width = `${pct.toFixed(1)}%`;
  row.querySelector(".gpt-val").textContent = risk.toFixed(3);
  row.classList.toggle("hot", risk >= 0.4 && risk < 0.62);
  row.classList.toggle("crit", risk >= 0.62);
}

function flashDoor(allowed) {
  if (!els.door) return;
  els.door.classList.remove("pass", "block");
  void els.door.offsetWidth;
  els.door.classList.add(allowed ? "pass" : "block");
  setTimeout(() => els.door.classList.remove("pass", "block"), 900);
}

function renderVerdict(tx) {
  const v = tx.verdict;
  for (const member of v.members) setBar(member.member, member.risk);
  els.jointRisk.textContent = v.joint_risk.toFixed(4);
  els.threshold.textContent = v.threshold.toFixed(4);
  els.verdict.textContent = v.allowed ? "passed the gate" : "thrown back";
  els.verdict.style.color = v.allowed ? "var(--neon-green)" : "var(--crimson-2)";
  flashDoor(v.allowed);
  els.reasons.innerHTML = "";
  for (const reason of (v.reasons || []).slice(0, 8)) {
    const li = document.createElement("li");
    li.textContent = reason;
    els.reasons.appendChild(li);
  }
}

function renderPlan(tx) {
  els.planSeal.textContent = tx.seal ? tx.seal.slice(-20) : "—";
  const plan = tx.plan;
  els.planSteps.innerHTML = "";
  if (!plan) {
    els.planHead.textContent = "not executed";
    els.planRoute.textContent = "rejected at the gate";
    els.planTokens.textContent = "—";
    els.planSha.textContent = "—";
    const li = document.createElement("li");
    li.textContent = "the core never runs for a rejected payload";
    els.planSteps.appendChild(li);
    return;
  }
  els.planHead.textContent = plan.head;
  els.planRoute.textContent = plan.route;
  els.planTokens.textContent = `${plan.token_count} / ${plan.chunk_count}`;
  els.planSha.textContent = plan.plan_sha256.slice(0, 24);
  for (const step of plan.steps) {
    const li = document.createElement("li");
    li.textContent = step;
    els.planSteps.appendChild(li);
  }
}

function showNotice(notice) {
  els.noticeRef.textContent = notice.reference;
  els.noticeSession.textContent = notice.session_id;
  els.noticeWarnings.textContent = String(notice.warnings_issued);
  els.noticeReason.textContent = notice.reason;
  els.noticeStatements.innerHTML = "";
  for (const s of notice.statements) {
    const li = document.createElement("li");
    li.textContent = s;
    els.noticeStatements.appendChild(li);
  }
  els.noticeDisclaimer.textContent = notice.disclaimer;
  els.notice.hidden = false;
  els.noticeAck.focus();
}

// ------------------------------------------------------------------
// Billing UI
// ------------------------------------------------------------------
function refreshPricing() {
  const billing = resolveBilling();
  persistPricingStatus(billing);
  if (els.vipChip) els.vipChip.hidden = true;
  els.regionLine.textContent = "region: verified by the host during checkout";
  document.querySelectorAll(".pass").forEach((passCard) => {
    const id = passCard.dataset.pass;
    const price = effectivePrice(id, billing);
    const priceEl = passCard.querySelector(".price");
    priceEl.innerHTML = `$${price}<span>${PASSES[id].unit}</span>`;
    passCard.classList.toggle("free", billing.humanitarian);
  });
  const pass = currentPass();
  els.pricingNote.textContent = pass
    ? `Stored pass: ${PASSES[pass.pass]?.label || pass.pass} · $${pass.price_charged} · host validation required · expires ${pass.expires_at}.`
    : "No active pass is stored in this browser. Server access is decided by the host, not this local interface.";
  if (openView === "subscription") renderView("subscription");
}

async function handleBuy(passId) {
  let result;
  try {
    result = await startCheckout(passId);
  } catch (error) {
    addMessage(
      "audio-note",
      "checkout unavailable",
      `${String(error?.message || error)} No pass was issued; try again after the host's payment service is available.`,
      false,
    );
    return;
  }
  refreshPricing();

  if (result.mode === "dodo" && result.checkout_url) {
    addMessage(
      "audio-note",
      "dodo payments · secure mor checkout",
      `Opening the Dodo Payments Merchant-of-Record checkout for the ${PASSES[passId].label}. ` +
        `After payment is confirmed, the host will return a signed pass record. ` +
        `The browser stores its bearer token locally, and sends it when requesting premium access.`,
      false
    );
    setTimeout(() => {
      window.location.href = result.checkout_url;
    }, 600);
    return;
  }

  const record = result.record;
  if (!record) return;
  addMessage(
    "audio-note",
    "host-issued pass",
    `${PASSES[record.pass]?.label || record.pass} issued for $${record.price_charged}` +
      (record.humanitarian_bypass ? " (host-verified humanitarian rate)" : "") +
      `. The signed token is stored in this browser and is sent to the host when used.`
  );
  if (openView === "subscription") renderView("subscription");
}

// ------------------------------------------------------------------
// Data Ingest Dispatcher
// ------------------------------------------------------------------
async function submit(text, audioB64) {
  const wait = PANEL_THROTTLE_MS - (Date.now() - lastSubmitAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastSubmitAt = Date.now();

  addMessage("user", `you · ${session}`, text || "[audio attached]", false);
  const payload = { text, session_id: session };
  if (audioB64) payload.audio_b64 = audioB64;

  const headers = { "Content-Type": "application/json" };
  const pass = store.get("pass");
  if (pass && pass.token) headers["X-SG16-Pass"] = pass.token;

  const tx = await api("/api/ingest", { method: "POST", headers, body: JSON.stringify(payload) });

  let kind = "brain";
  if (tx.stage === "refused") kind = "refused";
  else if (tx.stage === "warning" || tx.stage === "notice_issued") kind = "warning";
  else if (tx.stage === "neutral") kind = "neutral";

  addMessage(kind, `sg16 · ${tx.stage}`, tx.reply);
  if (tx.audio) {
    addMessage(
      "audio-note",
      "sg16 brain · measured acoustics",
      `${tx.audio.classification} · ${tx.audio.duration_ms} ms @ ${tx.audio.sample_rate} Hz · rms ${tx.audio.rms} · zcr ${tx.audio.zero_crossing_rate} · transcript ${tx.audio.transcript_source}`,
      false
    );
  }
  if (tx.notice) showNotice(tx.notice);

  renderVerdict(tx);
  renderPlan(tx);

  appendHistory(session, { role: "user", text });
  appendHistory(session, { role: "brain", stage: tx.stage, text: tx.reply });
  if (openView === "history") renderView("history");
}

// ==================================================================
// SHELL · sidebar, drawer, slide-over panels
// ==================================================================
const DRAWER_MAX = 900;

function isDrawer() {
  return window.innerWidth <= DRAWER_MAX;
}

function syncShellMode() {
  const drawer = isDrawer();
  document.body.classList.toggle("drawer-mode", drawer);
  if (!drawer) document.body.classList.remove("sidebar-open");
  if (els.sidebarToggle) {
    els.sidebarToggle.setAttribute("aria-expanded", String(!drawer || document.body.classList.contains("sidebar-open")));
  }
}

function openDrawer() {
  document.body.classList.add("sidebar-open");
  if (els.sidebarToggle) els.sidebarToggle.setAttribute("aria-expanded", "true");
}

function closeDrawer() {
  document.body.classList.remove("sidebar-open");
  if (els.sidebarToggle) els.sidebarToggle.setAttribute("aria-expanded", "false");
}

function toggleDrawer() {
  if (document.body.classList.contains("sidebar-open")) closeDrawer();
  else openDrawer();
}

function collapseSidebar() {
  if (isDrawer()) {
    closeDrawer();
    return;
  }
  document.body.classList.toggle("sidebar-collapsed");
  store.set("ui/collapsed", document.body.classList.contains("sidebar-collapsed"));
}

// --------------------------- diagnostics ---------------------------
function applyDiagnostics() {
  const on = store.get("ui/diagnostics", false);
  if (els.diagnostics) {
    els.diagnostics.hidden = !on;
    els.diagnostics.setAttribute("aria-hidden", String(!on));
  }
  return on;
}

// ----------------------------- devices -----------------------------
function deviceId() {
  let id = store.get("device_id");
  if (!id) {
    id = "dev-" + Math.random().toString(36).slice(2, 10);
    store.set("device_id", id);
  }
  return id;
}

function deviceLabel() {
  const ua = navigator.userAgent || "";
  const platform =
    /iPhone|iPad|iPod/i.test(ua) ? "iOS"
    : /Android/i.test(ua) ? "Android"
    : /Mac/i.test(ua) ? "macOS"
    : /Win/i.test(ua) ? "Windows"
    : /Linux/i.test(ua) ? "Linux"
    : "Unknown";
  const form = window.innerWidth < 620 ? "phone" : window.innerWidth <= 900 ? "tablet" : "desktop";
  return `${platform} · ${form}`;
}

function registerDevice() {
  const id = deviceId();
  const devices = store.get("devices", []);
  const known = devices.find((d) => d.id === id);
  const entry = {
    id,
    label: deviceLabel(),
    screen: `${window.screen?.width || window.innerWidth}×${window.screen?.height || window.innerHeight}`,
    standalone: window.matchMedia("(display-mode: standalone)").matches,
    last_seen: new Date().toISOString(),
    first_seen: known ? known.first_seen : new Date().toISOString(),
  };
  const next = devices.filter((d) => d.id !== id).concat([entry]);
  store.set("devices", next.slice(-12));
  return entry;
}

// ------------------------------ files ------------------------------
function recordFile(file) {
  const files = store.get("files", []);
  files.push({
    name: file.name,
    size: file.size,
    type: file.type || "audio",
    added_at: new Date().toISOString(),
  });
  store.set("files", files.slice(-60));
}

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// --------------------------- view routing ---------------------------
let openView = null;

function closeView() {
  openView = null;
  if (els.viewPanel) els.viewPanel.classList.remove("is-open");
  setTimeout(() => {
    if (!openView && els.viewPanel) els.viewPanel.hidden = true;
  }, 260);
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.classList.toggle("is-active", false);
  });
}

function openViewPanel(name) {
  if (openView === name) {
    closeView();
    return;
  }
  openView = name;
  if (els.viewPanel) els.viewPanel.hidden = false;
  // one frame so the transition actually plays
  requestAnimationFrame(() => els.viewPanel.classList.add("is-open"));
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === name);
  });
  renderView(name);
}

const VIEW_TITLES = {
  history: "History",
  files: "My Files",
  subscription: "Subscription",
  api: "API Access",
  devices: "My Devices",
  settings: "Settings",
  account: "Account",
  help: "Help",
};

function renderView(name) {
  els.viewPanelTitle.textContent = VIEW_TITLES[name] || "Panel";
  els.viewPanelBody.innerHTML = "";
  const builder = VIEW_RENDERERS[name];
  const nodes = builder ? builder() : [emptyState("Nothing here yet.")];
  for (const node of flatten(nodes)) els.viewPanelBody.appendChild(node);
}

// ---------------------------- view bodies ----------------------------
const VIEW_RENDERERS = {
  history() {
    const entries = loadHistory(session);
    if (!entries.length) return emptyState("No conversation stored on this device yet.");
    const turns = [];
    for (const entry of entries) {
      if (entry.role === "user") turns.push({ user: entry, brain: null });
      else if (turns.length) turns[turns.length - 1].brain = entry;
      else turns.push({ user: null, brain: entry });
    }
    const list = turns.slice(-40).reverse().map((turn, index) =>
      card(`${turns.length - index}. ${turn.brain?.stage ? `sg16 · ${turn.brain.stage}` : "exchange"}`, [
        turn.user ? el("p", { text: (turn.user.text || "[audio]").slice(0, 240) }) : null,
        turn.brain
          ? el("p", { class: "mono", text: (turn.brain.text || "").slice(0, 240) })
          : null,
      ])
    );
    return [
      card("This device", [
        row("session", session),
        row("stored turns", turns.length),
        el("div", { class: "view-actions" }, [
          el("button", {
            class: "btn ghost",
            text: "Export full local folder",
            onclick: () => exportLocalFolder(session),
          }),
          el("button", {
            class: "btn ghost",
            text: "Forget this session",
            onclick: () => startNewChat(),
          }),
        ]),
      ]),
      ...list,
    ];
  },

  files() {
    const files = store.get("files", []);
    return [
      card("On-device only", [
        el("p", {
          text:
            "Selected audio is sent to the configured host for acoustic profiling. This browser keeps only a local file label, size and timestamp; host, proxy and platform retention depend on deployment.",
        }),
        row("recorded attachments", files.length),
      ]),
      files.length
        ? card("Attachments", files.slice().reverse().map((f) => row(f.name, `${fmtBytes(f.size)} · ${f.added_at.slice(0, 16).replace("T", " ")}`)))
        : emptyState("No attachments recorded yet."),
      card("Data", [
        el("div", { class: "view-actions" }, [
          el("button", {
            class: "btn ghost",
            text: "Export local folder",
            onclick: () => exportLocalFolder(session),
          }),
          el("button", {
            class: "btn ghost",
            text: "Clear file list",
            onclick: () => {
              store.set("files", []);
              renderView("files");
            },
          }),
        ]),
      ]),
    ];
  },

  subscription() {
    const billing = resolveBilling();
    const pass = currentPass();
    const passCards = Object.entries(PASSES).map(([id, def]) =>
      card(def.label, [
        row("price", billing.humanitarian ? "$0" : `$${def.price}${def.unit}`),
        row("duration", `${def.hours} h`),
        el("div", { class: "view-actions" }, [
          el("button", {
            class: "btn primary",
            text: "subscribe",
            onclick: () => handleBuy(id),
          }),
        ]),
      ])
    );
    return [
      card("Current entitlement", [
        pass
          ? [
              row("pass", PASSES[pass.pass]?.label || pass.pass),
              row("charged", `$${pass.price_charged}`),
              row("expires", fmtTime(pass.expires_at)),
              row("record", "stored in this browser; the host validates signed tokens"),
            ]
          : el("p", { text: "No active pass. The brain still answers; a pass lifts the panel throttle." }),
        row("region", "verified by host during checkout"),
        row("humanitarian zero-rate", pass?.humanitarian_bypass ? "host-verified" : "not verified"),
      ]),
      ...passCards,
      card("Note", [
        el("p", {
          text:
            "This browser cannot verify payment or location. Paid passes require confirmed host-side checkout; any regional zero-rate eligibility must be asserted by a proxy the operator trusts. The returned token is stored locally but is not secret from this browser's user.",
        }),
      ]),
    ];
  },

  api() {
    const key = currentApiKey();
    return [
      card("Local entitlement key", [
        el("p", { class: "mono", text: key ? `key: ${key}` : "key: (not generated yet)" }),
        el("div", { class: "view-actions" }, [
          el("button", {
            class: "btn primary",
            text: key ? "rotate key" : "generate key",
            onclick: async () => {
              await generateApiKey();
              renderView("api");
            },
          }),
        ]),
      ]),
      card("Endpoints", [
        el("p", { text: "Chat and brain endpoints run on the configured host. Paid checkout uses Dodo Payments when the operator has enabled it." }),
        row("POST /api/ingest", "payload through the door"),
        row("POST /api/audio", "audio route"),
        row("GET /api/health", "readiness + digests"),
        row("GET /api/charter", "eight behavioral invariants"),
        row("GET /api/parity", "repeatability of the structural plan"),
        row("GET /api/weight", "weight provenance"),
      ]),
      card("Transport", [
        row("mode", host.transport || "—"),
        row("gate digest", host.gate || "—"),
        row("core", "SG16-BRAIN"),
      ]),
    ];
  },

  devices() {
    const devices = store.get("devices", []);
    const me = deviceId();
    return [
      card("This device", [
        row("device id", me),
        row("platform", deviceLabel()),
        row("session", session),
        row("installed (PWA)", window.matchMedia("(display-mode: standalone)").matches ? "yes" : "no"),
      ]),
      devices.length
        ? card("Registered on this profile", devices.slice().reverse().map((d) =>
            row(`${d.label} ${d.id === me ? "(this device)" : ""}`, `last seen ${d.last_seen.slice(0, 16).replace("T", " ")}`)
          ))
        : emptyState("No other devices registered."),
      card("Residency", [
        el("p", {
          text:
            "This device list is local. Requests still reach the configured host, which keeps bounded session context; proxy, platform and infrastructure logging depend on deployment.",
        }),
        el("div", { class: "view-actions" }, [
          el("button", {
            class: "btn ghost",
            text: "Forget other devices",
            onclick: () => {
              store.set("devices", store.get("devices", []).filter((d) => d.id === me));
              renderView("devices");
            },
          }),
        ]),
      ]),
    ];
  },

  settings() {
    const diagnosticsOn = store.get("ui/diagnostics", false);
    const collapsed = store.get("ui/collapsed", false);
    return [
      card("Interface", [
        el("label", { class: "switch-row" }, [
          el("span", { text: "Collapse the sidebar by default" }),
          el("input", {
            type: "checkbox",
            ...(collapsed ? { checked: "" } : {}),
            onchange: (event) => {
              store.set("ui/collapsed", event.target.checked);
              document.body.classList.toggle("sidebar-collapsed", event.target.checked && !isDrawer());
            },
          }),
        ]),
        el("label", { class: "switch-row" }, [
          el("span", { text: "Operator diagnostics (gate, plan, parity)" }),
          el("input", {
            type: "checkbox",
            ...(diagnosticsOn ? { checked: "" } : {}),
            onchange: (event) => {
              store.set("ui/diagnostics", event.target.checked);
              applyDiagnostics();
            },
          }),
        ]),
      ]),
      card("Live host state", [
        row("status", host.ready ? "ready" : "unreachable"),
        row("transport", host.transport || "—"),
        row("gate digest", host.gate || "—"),
        row("parity payloads", host.parity ? host.parity.payloads : "—"),
        row("parity identical", host.parity ? (host.parity.identical ? "yes" : "NO") : "—"),
      ]),
      card("Your data", [
        el("p", { text: "Interface preferences, profile labels and displayed chat history are stored in this browser. Requests are sent to the configured host, which keeps bounded in-memory context; deployment logging and retention may vary." }),
        el("div", { class: "view-actions" }, [
          el("button", {
            class: "btn ghost",
            text: "Export local folder",
            onclick: () => exportLocalFolder(session),
          }),
          el("button", {
            class: "btn ghost",
            text: "Reset interface prefs",
            onclick: () => {
              store.del("ui/diagnostics");
              store.del("ui/collapsed");
              document.body.classList.remove("sidebar-collapsed");
              applyDiagnostics();
              renderView("settings");
            },
          }),
        ]),
      ]),
    ];
  },

  account() {
    const identity = currentIdentity();
    return [
      card("Browser-local profile", [
        identity
          ? [
              row("label", identity.label),
              row("profile type", "local only; not verified"),
              row("created", identity.created_at ? identity.created_at.slice(0, 16).replace("T", " ") : "—"),
            ]
          : el("p", { text: "No local profile is saved. A profile is optional and does not sign you in." }),
      ]),
      card("Local profile", [
        el("p", {
          text:
            "This label is stored in this browser only. It is not a Google or Apple sign-in, is not verified, and does not authenticate requests or grant owner access.",
        }),
        el("div", { class: "view-actions" }, [
          el("button", {
            class: "btn primary",
            text: identity ? "Change local label" : "Set local label",
            onclick: async () => {
              await saveLocalProfile();
              renderView("account");
            },
          }),
        ]),
      ]),
      identity
        ? card("Local data", [
            el("div", { class: "view-actions" }, [
              el("button", { class: "btn ghost", text: "Clear local profile", onclick: () => signOut() }),
            ]),
          ])
        : null,
    ].filter(Boolean);
  },

  help() {
    return [
      card("Start here", [
        el("p", { text: "This build answers a small set of curated facts, arithmetic, and English-first planning requests. Other questions are deferred; it has no general-purpose pretrained language model or live retrieval." }),
        row("new chat", "clears the local transcript and starts a new server context; older contexts are bounded and evicted"),
        row("attach audio", "sends a clip for local acoustic profiling; speech transcription is not implemented"),
        row("history", "the UI transcript is stored locally; accepted request context also exists in bounded host memory"),
      ]),
      card(`Charter · ${host.charter.length} invariants`, host.charter.length
        ? host.charter.map((inv, i) => row(`${i + 1}. ${inv.key.replace(/_/g, " ")}`, inv.text))
        : el("p", { text: "Charter not loaded - the sovereign host is unreachable." })),
      card("Contact", [
        el("p", { text: "mistralbrain.com · SAIF TECH GLOBAL LLC · 8206 Louisiana Blvd NE, Ste A #10595, Albuquerque, NM 87113, USA" }),
        el("p", { text: "Licensed Apache 2.0." }),
      ]),
    ];
  },
};

// --------------------------- shell actions ---------------------------
async function startNewChat() {
  const previousSession = session;
  store.del(`history/${previousSession}`);
  store.del("session");
  session = sessionId();
  els.transcript.innerHTML = "";
  addMessage("brain", "sg16 brain", "Fresh chat. What would you like help with?");
  if (openView === "history") renderView("history");
  els.input.focus();
  // Best-effort host context reset so New chat does not continue old core memory.
  try {
    await fetch("/api/session/forget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: previousSession }),
    });
  } catch {
    /* host context still ages out via bounded LRU/restart */
  }
}

async function signOut() {
  const ok = window.confirm("Sign out on this device? Your local pass and profile are cleared.");
  if (!ok) return;
  store.del("identity");
  store.del("pass");
  store.del("api_key");
  store.del("session");
  session = sessionId();
  refreshPricing();
  closeView();
  addMessage("audio-note", "sg16 brain", "Signed out on this device. Profile, pass and API key cleared locally.");
}

// --------------------------- shell wiring ---------------------------
function wireShell() {
  if (els.sidebarToggle) els.sidebarToggle.addEventListener("click", toggleDrawer);
  if (els.sidebarHide) els.sidebarHide.addEventListener("click", collapseSidebar);
  if (els.sidebarScrim) els.sidebarScrim.addEventListener("click", closeDrawer);
  if (els.newChat) els.newChat.addEventListener("click", () => { startNewChat(); closeDrawer(); });
  if (els.signOut) els.signOut.addEventListener("click", () => { closeDrawer(); signOut(); });
  if (els.viewPanelClose) els.viewPanelClose.addEventListener("click", closeView);

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openViewPanel(btn.dataset.view);
      if (isDrawer()) closeDrawer();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (els.notice && !els.notice.hidden) return;
    if (els.portal && !els.portal.hidden) {
      els.portal.hidden = true;
      return;
    }
    if (openView) closeView();
    else closeDrawer();
  });

  window.addEventListener("resize", syncShellMode);
  syncShellMode();

  if (store.get("ui/collapsed", false) && !isDrawer()) {
    document.body.classList.add("sidebar-collapsed");
  }
  applyDiagnostics();
}

// ------------------------------------------------------------------
// System Initialization
// ------------------------------------------------------------------
async function boot() {
  try {
    const [health, identity, charter, parity] = await Promise.all([
      getJson("/api/health"),
      getJson("/api/identity"),
      getJson("/api/charter"),
      getJson("/api/parity"),
    ]);
    els.dot.classList.add("live");
    els.status.textContent = "ready";
    host.ready = true;
    host.transport = health.transport;
    host.gate = health.gate_weights_sha256.slice(0, 10);
    host.charter = charter.invariants || [];
    if (els.charterTitle) {
      els.charterTitle.textContent = `Charter · ${host.charter.length} invariants`;
    }
    host.designation = identity.verified ? identity.designation : "UNVERIFIED";
    host.officialName = identity.official_name;
    host.parity = parity;

    if (els.designation) {
      els.designation.textContent = host.designation;
      els.designation.title = identity.official_name;
    }
    els.transport.textContent = health.transport;
    if (els.core) els.core.textContent = "SG16-BRAIN";
    els.gate.textContent = health.gate_weights_sha256.slice(0, 10);

    els.charter.innerHTML = "";
    charter.invariants.forEach((inv, i) => {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = `${i + 1}. ${inv.key.replace(/_/g, " ")}`;
      const span = document.createElement("span");
      span.textContent = inv.text;
      li.append(b, span);
      els.charter.appendChild(li);
    });

    els.parityCount.textContent = String(parity.payloads);
    els.parityOk.textContent = parity.identical ? "yes" : "NO";
    els.parityOk.style.color = parity.identical ? "var(--neon-green)" : "var(--crimson-2)";
    els.parityDigest.textContent = parity.online_digest.slice(0, 20);

    const history = loadHistory(session);
    if (history.length) {
      for (const entry of history) {
        addMessage(
          entry.role === "user" ? "user" : "brain",
          entry.role === "user" ? `you · ${session}` : `sg16 · ${entry.stage || ""}`,
          entry.text,
          entry.role !== "user"
        );
      }
    } else {
      addMessage("brain", "sg16 brain", "Share your idea first.");
    }
  } catch (error) {
    els.dot.classList.add("down");
    els.status.textContent = "unreachable";
    host.ready = false;
    addMessage("brain", "host error", String(error.message || error), false);
  }

  // Returning from a Dodo checkout: pick up the signed record if the webhook
  // has confirmed, and commit it to the local folder.
  try {
    const confirmed = await confirmDodoReturn();
    if (confirmed && confirmed.pass) {
      addMessage(
        "audio-note",
        "dodo payments · confirmed",
        `${PASSES[confirmed.pass]?.label || confirmed.pass} confirmed and signed into ` +
          `your local folder. Valid until ${new Date(confirmed.expires_at * 1000).toLocaleString()}.`,
        false
      );
    }
  } catch {}

  registerDevice();
  refreshPricing();
  init3DTilt();
}

// ------------------------------------------------------------------
// Event Binding
// ------------------------------------------------------------------
els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  const file = els.audio.files && els.audio.files[0];
  if (!text && !file) return;
  els.input.value = "";
  try {
    let audioB64 = null;
    if (file) {
      audioB64 = await fileToBase64(file);
      recordFile(file);
      els.audio.value = "";
      els.audioName.textContent = "";
    }
    await submit(text, audioB64);
  } catch (error) {
    addMessage("brain", "host error", String(error.message || error), false);
  }
});

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.composer.requestSubmit();
  }
});

els.audio.addEventListener("change", () => {
  const file = els.audio.files && els.audio.files[0];
  els.audioName.textContent = file
    ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB`
    : "";
});

els.reset.addEventListener("click", () => startNewChat());

document.querySelectorAll("[data-buy]").forEach((btn) => {
  btn.addEventListener("click", () => handleBuy(btn.dataset.buy));
});

els.buyApi.addEventListener("click", () => {
  document.getElementById("pricing").scrollIntoView({ behavior: "smooth" });
});
els.goChat.addEventListener("click", () => {
  document.getElementById("go-chat-target").scrollIntoView({ behavior: "smooth" });
});

els.openPortal.addEventListener("click", () => {
  els.portal.hidden = false;
  const key = currentApiKey();
  els.portalKey.textContent = key ? `key: ${key}` : "key: (not generated yet)";
});
els.portalClose.addEventListener("click", () => (els.portal.hidden = true));
els.genKey.addEventListener("click", async () => {
  const key = await generateApiKey();
  els.portalKey.textContent = `key: ${key}`;
  if (openView === "api") renderView("api");
});

els.noticeAck.addEventListener("click", () => (els.notice.hidden = true));

const MATRIX_CANDIDATES = [
  "dashboard-matrix.jpg",
  "dashboard-matrix.png",
  "IMG_2765.PNG",
];

function mountDashboardMatrix() {
  const img = document.getElementById("dashboard-matrix");
  if (!img) return;

  const activate = () => {
    img.hidden = false;
    document.body.classList.add("has-matrix");
    // The hero only folds into a canvas host when one is present; otherwise
    // the premium hero keeps its own grid.
    const canvas = document.querySelector(".dashboard-canvas");
    const hero = document.getElementById("hero-fallback");
    if (canvas && hero) {
      hero.prepend(hero.querySelector(".hero-actions"));
      canvas.prepend(hero);
    }
  };

  const tryNext = (index) => {
    if (index >= MATRIX_CANDIDATES.length) return;
    const name = MATRIX_CANDIDATES[index];
    fetch("/assets/" + name, { method: "HEAD" })
      .then((probe) => {
        if (!probe || !probe.ok) return tryNext(index + 1);
        img.src = "/assets/" + name;
        img.addEventListener("load", activate, { once: true });
        if (img.complete) activate();
      })
      .catch(() => tryNext(index + 1));
  };

  if (img.complete && img.naturalWidth > 0) {
    activate();
    return;
  }
  tryNext(0);
}

function wireAssetFallbacks() {
  const heroEl = document.querySelector(".hero-section");
  if (heroEl) {
    heroEl.style.backgroundImage = 'url("/assets/IMG_2764.JPEG")';
    heroEl.style.backgroundSize = "82% auto";
    heroEl.style.backgroundPosition = "center 24%";
    heroEl.style.backgroundRepeat = "no-repeat";
  }
  mountDashboardMatrix();
}

wireShell();
wireAssetFallbacks();
boot();
