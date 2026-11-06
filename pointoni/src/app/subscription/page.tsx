"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Crown, ShieldCheck, Globe2, AlertTriangle, Download, Upload } from "lucide-react";
import Link from "next/link";
import { SiteChrome } from "@/components/chrome/SiteChrome";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui/Panel";
import {
  BILLING_COPY,
  HUMANITARIAN_REGION,
  PASSES,
  encodePassHeader,
  formatExpiry,
  loadPassRecord,
  parsePassFile,
  passFileText,
  passLabel,
  storePassRecord,
  type PassId,
  type PassRecord,
} from "@/lib/billing";

export default function SubscriptionPage() {
  const [record, setRecord] = useState<PassRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [gateway, setGateway] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Your pass is the proof that you subscribed: it lives on this device and the host recognises it
  // by its signature, with nothing about you stored. So keep a copy: if the device is lost, a pass
  // file is the only way back (there is no account to recover it from).
  function savePass() {
    if (!record) return;
    const blob = new Blob([passFileText(record)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sg16-pass-${record.pass}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNote("Pass file saved. Keep it somewhere safe: anyone holding it can use the pass until it expires.");
  }

  async function restorePass(file: File) {
    setError(null);
    setNote(null);
    const restored = parsePassFile(await file.text());
    if (!restored) return setError("That file is not an SG16 pass.");
    try {
      const res = await fetch("/api/pass-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pass: encodePassHeader(restored) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.valid) return setError(data.error || "This pass could not be verified.");
      activate(restored);
      setNote("Pass restored on this device.");
    } catch {
      setError("Could not reach the host to check the pass. Try again.");
    }
  }

  function activate(rec: PassRecord) {
    storePassRecord(rec);
    setRecord(rec);
    setConfirmed(passLabel(rec.pass));
    window.setTimeout(() => setConfirmed(null), 3200);
  }

  useEffect(() => {
    queueMicrotask(() => setRecord(loadPassRecord()));
    fetch("/api/billing")
      .then((response) => response.json())
      .then((data) => setGateway(data.billing?.gateway?.mode ?? null))
      .catch(() => setGateway("unavailable"));

    const checkoutRef = new URLSearchParams(window.location.search).get("sg16_checkout_ref");
    if (!checkoutRef) return;
    let cancelled = false;
    setBusy("confirm");
    setError(null);
    void (async () => {
      try {
        for (let attempt = 0; attempt < 6 && !cancelled; attempt += 1) {
          const response = await fetch("/api/billing/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: checkoutRef }),
            cache: "no-store",
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "The host could not confirm payment.");
          if (data.confirmed && data.record) {
            activate({ ...(data.record as PassRecord), gateway: "dodo" });
            const clean = new URL(window.location.href);
            clean.searchParams.delete("sg16_checkout_ref");
            window.history.replaceState({}, "", clean.toString());
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
        }
        if (!cancelled) setError("Payment is not confirmed yet. No pass was activated; check back shortly.");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Payment confirmation is unavailable.");
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const humanitarian = record?.region === HUMANITARIAN_REGION;

  async function choose(id: PassId) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pass: id, return_url: window.location.href }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Checkout is unavailable.");

      if (data.mode === "dodo" && typeof data.checkout_url === "string") {
        const checkoutUrl = new URL(data.checkout_url);
        if (checkoutUrl.protocol !== "https:") throw new Error("Payment provider returned an unsafe checkout URL.");
        window.location.assign(checkoutUrl.toString());
        return;
      }
      if (data.mode === "humanitarian_bypass" && data.record) {
        const hostRecord = data.record as PassRecord;
        if (!hostRecord.token || !/^[a-f0-9]{64}$/.test(hostRecord.token)) {
          throw new Error("The host returned an invalid pass record.");
        }
        activate({ ...hostRecord, gateway: "verified-humanitarian" });
        return;
      }
      throw new Error("The host did not issue a pass or create a checkout session.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout is unavailable.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <SiteChrome>
      <PageHeader
        title="SUBSCRIPTION"
        subtitle={`${BILLING_COPY.deckTitle} \u2014 ${BILLING_COPY.localizedNote}`}
      />

      <div className="mx-auto max-w-[1200px] space-y-5 px-4 py-8">
        {/* current entitlement — ported from the old settings subscription view */}
        <Panel className="p-5">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-5 w-5 text-emerald-300" />
              <h2 className="font-display text-[12px] font-black tracking-widest text-white">
                CURRENT ENTITLEMENT
              </h2>
            </div>
            {record ? (
              <p className="font-mono2 text-[11px] tracking-wider text-emerald-300">
                STORED PASS · {passLabel(record.pass)} · ${record.price_charged} CHARGED ·
                EXPIRES {formatExpiry(record.expires_at)} · PREMIUM CHAT LIVE ON THIS DEVICE
              </p>
            ) : (
              <p className="font-mono2 text-[11px] tracking-wider text-slate-400">
                {BILLING_COPY.noPassNote}
              </p>
            )}
            <span className="inline-flex flex-wrap items-center gap-2">
              {record && (
                <button onClick={savePass} className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px]">
                  <Download className="h-3.5 w-3.5" /> SAVE MY PASS
                </button>
              )}
              <button onClick={() => fileInput.current?.click()} className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px]">
                <Upload className="h-3.5 w-3.5" /> RESTORE PASS FROM FILE
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void restorePass(f);
                  e.target.value = "";
                }}
              />
            </span>
            <span className="ml-auto inline-flex items-center gap-2 font-mono2 text-[10px] tracking-[0.2em] text-slate-400">
              <Globe2 className="h-3.5 w-3.5 text-cyan-300" />
              REGION: {humanitarian ? HUMANITARIAN_REGION : "DETERMINED BY HOST"}
              {humanitarian && <span className="text-emerald-300">· HOST-VERIFIED ZERO-RATE RECORD</span>}
              {gateway && <span className="text-slate-500">· GATEWAY {gateway.toUpperCase()}</span>}
            </span>
          </div>
        </Panel>

        {note && (
          <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">{note}</div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            <AlertTriangle className="h-3.5 w-3.5 flex-none" /> {error}
          </div>
        )}

        {/* the pass deck — exact old tiers, logic and copy */}
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {PASSES.map((p) => {
            const isCurrent = record?.pass === p.id;
            return (
              <Panel
                key={p.id}
                className={`relative flex flex-col p-6 ${p.featured ? "border-emerald-400/60 shadow-[0_0_34px_rgba(34,224,140,.18)]" : ""}`}
              >
                {p.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-400 px-3 py-0.5 font-display text-[9px] font-black tracking-[0.2em] text-black">
                    MOST SOVEREIGN
                  </span>
                )}
                <div className="flex items-center gap-2.5">
                  <Crown className="h-6 w-6" style={{ color: p.accent }} />
                  <h2 className="font-display text-[14px] font-black tracking-wide text-white">
                    {p.label}
                  </h2>
                </div>
                <div className="mt-4 flex items-end gap-2">
                  <span className="font-display text-4xl font-black" style={{ color: p.accent }}>
                    ${p.price}
                  </span>
                  <span className="pb-1 font-mono2 text-[10px] tracking-widest text-slate-400">
                    {p.unit}
                  </span>
                </div>
                <ul className="mt-5 flex-1 space-y-2.5">
                  <li className="flex items-start gap-2.5 text-[12.5px] text-slate-300">
                    <Check className="mt-0.5 h-4 w-4 flex-none" style={{ color: p.accent }} strokeWidth={3} />
                    {p.blurb}
                  </li>
                  <li className="flex items-start gap-2.5 text-[12.5px] text-slate-300">
                    <Check className="mt-0.5 h-4 w-4 flex-none" style={{ color: p.accent }} strokeWidth={3} />
                    Duration-locked {p.hours}h sovereign token
                  </li>
                  <li className="flex items-start gap-2.5 text-[12.5px] text-slate-300">
                    <Check className="mt-0.5 h-4 w-4 flex-none" style={{ color: p.accent }} strokeWidth={3} />
                    Host validates the bearer token on use; keep it private
                  </li>
                </ul>
                {isCurrent ? (
                  <span className="mt-6 rounded-lg border border-emerald-400/50 bg-emerald-500/10 py-2.5 text-center font-display text-[11px] font-black tracking-widest text-emerald-300">
                    ACTIVE PASS
                  </span>
                ) : (
                  <button
                    onClick={() => choose(p.id)}
                    disabled={busy !== null}
                    className="btn-red mt-6 py-2.5 text-[11px] disabled:opacity-50"
                  >
                    {busy !== null ? busy === p.id ? "OPENING CHECKOUT…" : "PLEASE WAIT…" : "SUBSCRIBE"}
                  </button>
                )}
              </Panel>
            );
          })}
        </div>

        {/* the two sovereign notes — exact old copy */}
        <Panel className="space-y-3 p-5">
          <p className="text-[12px] leading-relaxed text-slate-300">
            <span className="font-display text-[10px] font-black tracking-widest text-emerald-300">
              HUMANITARIAN ZERO-RATE ·{" "}
            </span>
            {BILLING_COPY.humanitarianNote}
          </p>
          <p className="text-[12px] leading-relaxed text-slate-400">
            <span className="font-display text-[10px] font-black tracking-widest text-cyan-300">
              GATEWAY MODEL ·{" "}
            </span>
            {BILLING_COPY.gatewayNote}
          </p>
        </Panel>
      </div>

      {confirmed && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-emerald-400/60 bg-[#08130d]/95 px-5 py-3 font-display text-[11px] font-bold tracking-widest text-emerald-300 shadow-[0_0_30px_rgba(34,224,140,.4)]">
          PASS ACTIVATED · {confirmed}
        </div>
      )}
      <p className="pb-10 text-center font-mono2 text-[10px] tracking-widest text-slate-500">
        NEED SOMETHING DIFFERENT?{" "}
        <Link href="/contact" className="text-cyan-300 underline">
          CONTACT THE GLOBAL DESK
        </Link>
      </p>
    </SiteChrome>
  );
}
