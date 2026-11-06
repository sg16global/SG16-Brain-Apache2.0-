# SG16 BODY TEMPLATE — birth a new sovereign project in ~1 hour

*Companion to `SG16-CONNECTOR-API.md`. v1 sealed · SAIF TECH GLOBAL LLC.*

A **body** = one static page + one fetch. Nothing more, ever. This file is the
starter skeleton: copy it into the new domain's repo, reskin the face, launch.

---

## 1. The only code a body ever needs

```tsx
// app/page.tsx — a full sovereign body
"use client";

import { useState } from "react";

const BRAIN_URL = "https://mistralbrain.com/api/brain"; // power plant

export default function Home() {
  const [sid, setSid] = useState<string | null>(null);
  const [log, setLog] = useState<{ role: string; content: string; tier?: string }[]>([]);
  const [input, setInput] = useState("");

  async function talk() {
    const message = input.trim(); if (!message) return;
    setInput("");
    setLog((l) => [...l, { role: "user", content: message }]);
    const r = await fetch(BRAIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, modelId: "sg16-brain", sessionId: sid }),
    });
    const d = await r.json();
    if (r.status === 429) {
      setLog((l) => [...l, { role: "assistant", content: "The brain rests an hour — fair use. Come back soon. 🌙" }]);
      return;
    }
    setSid(d.sessionId ?? sid);
    setLog((l) => [...l, { role: "assistant", content: d.assistantMessage.content, tier: d.tier }]);
  }

  return (
    <main style={{ minHeight: "100svh", padding: 16, background: "#050608", color: "#e8f0fb", fontFamily: "system-ui" }}>
      <h1>YOUR BODY NAME <small style={{ color: "#22e08c" }}>· powered by SG16</small></h1>
      <div style={{ maxWidth: 640, margin: "24px auto", display: "grid", gap: 8 }}>
        {log.map((m, i) => (
          <div key={i} style={{ justifySelf: m.role === "user" ? "end" : "start", background: m.role === "user" ? "#3d0a12" : "#0d1524", padding: 12, borderRadius: 12 }}>
            {m.content}
          </div>
        ))}
      </div>
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && talk()}
          placeholder="Talk to the brain…" style={{ flex: 1, padding: 12, borderRadius: 10, border: "1px solid #334", background: "#0a0e14", color: "#fff" }} />
        <button onClick={talk} style={{ padding: "0 18px", borderRadius: 10, border: "none", background: "#ff1f2e", color: "#fff", fontWeight: 800 }}>SEND</button>
      </div>
      <p style={{ marginTop: 20, fontSize: 11, opacity: 0.6, textAlign: "center" }}>
        ZERO STORAGE · NOTHING SAVED · YOUR DEVICE KEEPS ONLY WHAT YOU CHOOSE
      </p>
    </main>
  );
}
```

> That's the whole project. One file. One cable. Zero storage by inheritance.

## 2. Body variants (drop-in deltas)

| Body | Delta against this template | Never add |
|---|---|---|
| **finance** | inject latest demo-tape JSON into each message as context (`MARKET SNAPSHOT: …`) | real-time market claims — keep DEMO TAPE badge |
| **corporate/about** | static branding + embedded same chat | anything dark-pattern |
| **any body** | skin, fonts, tone of copy | a second model, a second storage backend, a forking of the core |

## 3. Launch checklist (every body, every time)

1. [ ] The fetch is the one in §1 (never a second model name).
2. [ ] Tier/fair-use exhaustion shows a kind message from 429 (don't hide it).
3. [ ] Session tokens live ONLY in the user's device memory (`localStorage`, never cookies shared).
4. [ ] Humanitarian region bypass shows free-unlimited where applicable — inherited, not duplicated.
5. [ ] No analytics, no third-party pixels. Visits counted by the edge (Cloudflare) only.
6. [ ] Footer carries: `ZERO STORAGE · SG16 POWERED · mistralbrain.com`.
7. [ ] Body lands in ITS OWN domain — one site per domain, domains stay sovereign.

## 4. Costs stay charitable by construction

A body's monthly run-rate = its static hosting (≈$0 on any tier) because 100%
of thinking is paid by the power plant's own fair-use architecture and
visitors' devices. Transactions and licenses live
only on the flagship—bodies never ever bill.

---

*One brain, many bodies, all of them small and honest. Clone the file, give it a face, launch.*
