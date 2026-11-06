# SG16 MODEL WEIGHT SYSTEM — Sovereign Weight Doctrine (v2, corrected)

*Status: doctrine v2 (supersedes v1's "sovereign host" residency model — that anchor has been judged wrong and removed.)*
*Canon: the brain is a friend to everyone — rich or poor, cheap phone or flagship. The home the brain lives in is THE USER'S OWN DOMAIN, not the vendor's. No founder servers doing inference. No third-party AI APIs. Zero stored conversations, by physics, not by promise.*

---

## 1. The anchoring error (fixed in v2)

v1 answered "where do the weights run" with *the operator's host* — one sovereign box pinning W1/W2/W3. That is a third-party dependency with a nicer name: it makes chats travel to someone else's machine, costs scale with users, and the "zero storage" claim becomes a promise rather than a law of physics.

**Correction (v2):** the brain serves from **inside the user's own domain**. There is exactly one operator-side compute machine: the **development/showroom core** (the live demo you can chat with publicly) — everything else is user-side.

## 2. The three domains

| Domain | What lives there | Economics |
|---|---|---|
| **USER-DOMAIN (the home)** | the user's Google/Firebase account: identity email, a folder named after them, the license record, and **the inference itself** | user's own free-tier resources; platform cost ≈ $0; scale is the user's scale |
| **USER-DEVICE (the energy)** | the friend's thinking — weights cached once per device, then answer locally in-browser (WebGPU, WASM fallback) | one-time download; **zero per-message cloud requests** — the "10,000 requests/day" worker ceiling is never touched by chatting |
| **SHOWROOM (the demo)** | this Web platform's dev core (the SG16 engine on the public site) | project site only; deliberately zero-retention |

Google/Firebase = **the doorway of his house** (his email, his folder, his place). Never the model's brain, never a message store.

## 3. Weight classes (v2) — fitted to the user's device, not to the poor's wallets

| Class | Footprint | Runs where | Who it's for |
|---|---|---|---|
| **FRIEND-S** | ~300–600 MB (sub-GB quantized) | any phone's browser (WebGPU/WASM) | the cheapest phone in the world — the poor man gets the same friend |
| **FRIEND-M** | ~1–2 GB quantized | mid-range phone / laptop browser | everyday deep chats, long answers |
| **CORE** | the 14–16 GB authored engine | the **showroom dev core**, and optionally *inside the user's own domain* if they upgrade their own account | heavy research & work-mode depth |

The device, not the wallet, picks the tier automatically — measure free RAM/GPU, choose the largest weight class that fits, warn honestly. Nobody pays for weights; the payment is a **license** that unlocks features and heavier weight downloads — it funds development, not electricity.

## 4. Serving policy (v2)

```
visitor (no login)       → SITE showroom core · fair-use hours · zero storage (current build — unchanged)
friend, signed in        → in-browser FRIEND-S/M · unlimited (his device burns his battery, not our quota)
subscriber (work mode)   → FRIEND heavier classes + CORE access per license · unlimited · local
humanitarian region      → everything above, license bypassed (existing Palestine rule stands)
worker's 10k/day         → irrelevant by construction: per-message inference = 0 cloud calls
```

## 5. How requests actually spend the user's quota

| Action | Per-message quota cost | Notes |
|---|---|---|
| Chat inference | **0 requests** — runs on the device | this is the whole point |
| Weight fetch | once per device per class (cached forever) | static hosting bytes only |
| Auth / license check | ~2 tiny documents | Firestore free-tier: 50k reads/day — weighs nothing |
| Folder/artifact sync | user's own storage file ops | kilobytes, inside his own account |

Even the kid with the book-length essay is free to drain nothing.

## 6. What's already real vs. what's next

**Real now (unchanged, correct by design):**
- Exclusive SG16-only chat → showroom core, fair-use buckets, work-mode gating (zero-profile email identity).
- Device capsule: AES-256-GCM sealed in the browser; the user's own folder holds the copy-of-record.
- Weight manifest signed, provenance per message.

**Next (the corrected roadmap):**
1. **FRIEND in-browser engine — REMOVED 2026-11-06.** It ran a third-party in-browser model (transformers.js + SmolLM2 from a model hub); SG16 Brain Q4_K_M is now the one and only brain. Former description, kept for the record: the homepage carries a live `FRIEND ENGINE · THIS DEVICE` station (transformers.js + self-hosted ONNX/WebGPU WASM runtime under `/onnx/`, device-fitted FRIEND-S 135M / FRIEND-M 360M classes, weights cached in the browser forever after one download; per-chat-turn requests = 0).
2. User-domain scaffolding: Firebase Auth email + his-folder storage adapter (adapter already designed in the identity chain, drop-in).
3. When traffic matures: weights served from the user's own account storage, operator's static files only.

*The brain runs on his own home, his own energy, his own blood, his own brain — and nobody needs to trust that, because nothing of his ever leaves the house he owns.*
