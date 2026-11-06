"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Shield,
  Activity,
  Database,
  Cpu,
  Heart,
  KeyRound,
  FileStack,
  Users,
  Crown,
  CheckCircle2,
  AlertTriangle,
  Server,
  Layers,
  BookOpen,
  Lock,
} from "lucide-react";
import { SiteChrome } from "@/components/chrome/SiteChrome";
import { PageHeader } from "@/components/PageHeader";
import { Panel, StatusPill } from "@/components/ui/Panel";
import { identityHeaders } from "@/lib/browser-identity";
import { useAdmin, useSignedIn } from "@/lib/use-session";

type Health = {
  ok: boolean;
  database: boolean;
  brain: "online" | "offline";
  persistence: string;
  heart: { status: string; model?: string; detail?: string };
  answering: string;
  lastAnswered?: { engine: string; at: string } | null;
  metrics?: {
    since: string;
    answered: Record<string, number>;
    total: number;
    avgMs: number | null;
    p95Ms: number | null;
    samples: number;
    queue: { active: number; queued: number };
  };
  engines: string[];
  charter?: { laws?: number; bodies?: number; digest?: string };
};

type Model = {
  id: string;
  name: string;
  vendor: string;
  role: string;
  status: string;
  selfHosted: boolean;
};

type Billing = {
  currency: string;
  passes: Record<string, { label: string; price: string; hours: number }>;
  gateway?: { provider: string; mode: string };
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
}) {
  return (
    <Panel soft corners={false} className="p-4">
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 place-items-center rounded-xl border"
          style={{
            borderColor: `${accent}50`,
            background: `${accent}18`,
            color: accent,
            boxShadow: `0 0 18px ${accent}30`,
          }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <p className="font-mono2 text-[9px] tracking-[0.18em] text-slate-400">{label}</p>
          <p className="font-display text-xl font-black tracking-wide text-white">{value}</p>
          {sub && <p className="font-mono2 text-[9px] tracking-widest text-slate-500">{sub}</p>}
        </div>
      </div>
    </Panel>
  );
}

// Project keys: how the operator's other projects use the Brain. A key is signed on the spot and
// shown once; the server stores nothing, so the keys survive every restart.
function ProjectsPanel() {
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ project: string; key: string } | null>(null);
  const [info, setInfo] = useState<{ configured: boolean; revoked: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/project-keys", { headers: identityHeaders(), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setInfo(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function create() {
    setError(null);
    setCreated(null);
    setCopied(false);
    const res = await fetch("/api/admin/project-keys", {
      method: "POST",
      headers: identityHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ project: name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "Could not create the key.");
    setCreated({ project: data.project, key: data.key });
  }

  const origin = typeof window === "undefined" ? "https://your-brain" : window.location.origin;
  return (
    <Panel className="p-5">
      <h3 className="flex items-center gap-2 font-display text-[13px] font-black tracking-widest text-white">
        <KeyRound className="h-4 w-4 text-amber-300" /> PROJECT KEYS
      </h3>
      <p className="mt-2 font-mono2 text-[10px] leading-relaxed tracking-wider text-slate-400">
        Connect your own projects to the Brain. Keys are free and unlimited, signed on the spot and never stored.
      </p>
      {info && !info.configured && (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-2.5 font-mono2 text-[10px] text-amber-200">
          SG16_PROJECT_KEY_SECRET is not set on the server, so keys cannot be made yet.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder="project name, e.g. my-shop"
          className="input-dark h-10 min-w-0 flex-1 px-3 text-[13px]"
        />
        <button onClick={() => void create()} disabled={!name || info?.configured === false} className="btn-red px-4 text-[10px] disabled:opacity-50">
          CREATE KEY
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-red-300">{error}</p>}
      {created && (
        <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3">
          <p className="font-mono2 text-[10px] tracking-widest text-emerald-300">KEY FOR {created.project.toUpperCase()} · SHOWN ONCE · COPY IT NOW</p>
          <code className="mt-2 block break-all font-mono2 text-[11px] text-white">{created.key}</code>
          <button
            onClick={() => navigator.clipboard?.writeText(created.key).then(() => setCopied(true))}
            className="btn-ghost mt-2 px-3 py-1.5 text-[10px]"
          >
            {copied ? "COPIED" : "COPY"}
          </button>
          <pre className="mt-3 overflow-x-auto rounded bg-black/50 p-2 font-mono2 text-[10px] text-cyan-100">{`curl -X POST ${origin}/api/brain \
  -H "Authorization: Bearer <the key>" -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'`}</pre>
        </div>
      )}
      <p className="mt-3 font-mono2 text-[9px] leading-relaxed tracking-wider text-slate-500">
        STOP ONE PROJECT: put its name in SG16_REVOKED_PROJECTS on the server{info && info.revoked.length ? ` (now: ${info.revoked.join(", ")})` : ""}. STOP ALL: change SG16_PROJECT_KEY_SECRET.
      </p>
    </Panel>
  );
}

function AdminConsole() {
  const [health, setHealth] = useState<Health | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const headers = identityHeaders();

        // the operator token unlocks the detail in /api/health
        const hRes = await fetch("/api/health", { cache: "no-store", headers });
        const hData = await hRes.json();
        if (hRes.ok) setHealth(hData);

        const mRes = await fetch("/api/models", { cache: "no-store" });
        const mData = await mRes.json();
        if (mRes.ok) setModels(mData.models ?? []);

        const bRes = await fetch("/api/billing", { cache: "no-store" });
        const bData = await bRes.json();
        if (bRes.ok) setBilling(bData.billing ?? bData);

      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load admin console.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <SiteChrome>
      <PageHeader
        title="ADMIN CONSOLE"
        subtitle="Sovereign operator dashboard — system health, charter law, models, billing and project keys. Operator only; no user data exists on this server."
      />

      <div className="mx-auto max-w-[1200px] space-y-6 px-3 py-8 sm:px-5">
        {/* top banner */}
        <Panel className="relative overflow-hidden p-0">
          <div className="absolute inset-0 bg-gradient-to-r from-red-600/20 via-transparent to-cyan-500/15" />
          <div className="relative grid items-center gap-6 p-6 sm:grid-cols-[auto_1fr_auto] sm:p-8">
            <span className="grid h-16 w-16 place-items-center rounded-2xl border border-red-400/50 bg-gradient-to-b from-red-600/40 to-red-900/40 shadow-[0_0_28px_rgba(255,31,46,.4)]">
              <Shield className="h-8 w-8 text-white" />
            </span>
            <div>
              <h2 className="font-display text-xl font-black tracking-widest text-white sm:text-2xl">
                SOVEREIGN <span className="text-red-400">SG16</span> BRAIN — OPERATOR MODE
              </h2>
              <p className="mt-1 max-w-2xl font-mono2 text-[11px] leading-relaxed tracking-wider text-slate-300">
                This console is the single operator surface for the SG16 platform. Health, charter, models,
                billing, and presence are reported honestly — no mock statuses, no hidden dossiers. All data
                lives on this deployment; no third-party analytics.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 font-mono2 text-[9px] tracking-widest text-emerald-300">
                  ADMIN · OPERATOR SIGNED IN
                </span>
                <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 font-mono2 text-[9px] tracking-widest text-cyan-300">
                  BUILD · {health?.persistence ?? "checking"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono2 text-[9px] tracking-widest text-slate-300">
                  LAST ANSWER · {(health?.lastAnswered?.engine ?? "none yet").toUpperCase()}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:flex-col">
              <Link href="/login" className="btn-ghost px-4 py-2 text-[11px]">
                <Users className="mr-2 inline h-4 w-4" />
                OPERATOR SESSION
              </Link>
            </div>
          </div>
        </Panel>

        {loading && (
          <Panel className="p-10 text-center font-display text-sm tracking-widest text-slate-500 pulse-soft">
            LOADING ADMIN CONSOLE…
          </Panel>
        )}

        {error && (
          <Panel className="border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            {error}
          </Panel>
        )}

        {/* health grid */}
        {health && (
          <>
            {health.metrics && (
              <Panel className="p-4">
                <p className="font-mono2 text-[10px] tracking-widest text-slate-400">
                  TRAFFIC · ANONYMOUS COUNTERS SINCE {new Date(health.metrics.since).toLocaleString()}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(health.metrics.answered).map(([engine, n]) => (
                    <div key={engine} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <p className="font-mono2 text-[10px] tracking-widest text-slate-400">{engine.toUpperCase()}</p>
                      <p className="mt-1 font-display text-lg font-black text-white">{n}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 font-mono2 text-[11px] text-slate-300">
                  answer time avg {health.metrics.avgMs ?? "—"} ms · p95 {health.metrics.p95Ms ?? "—"} ms (last{" "}
                  {health.metrics.samples}) · queue {health.metrics.queue.queued} waiting,{" "}
                  {health.metrics.queue.active} answering · numbers only: no visitor, address or message is recorded
                </p>
              </Panel>
            )}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={Database}
                label="DATABASE"
                value={health.database ? "ONLINE" : "OFFLINE"}
                sub={health.ok ? "ledger answering" : "ledger unreachable"}
                accent={health.database ? "#22e08c" : "#ff3b4c"}
              />
              <StatCard
                icon={Cpu}
                label="SOVEREIGN CORE"
                value={health.brain.toUpperCase()}
                sub={`Q16.16 · ${health.engines.join(" → ")}`}
                accent={health.brain === "online" ? "#39d7ff" : "#ffb020"}
              />
              <StatCard
                icon={Heart}
                label="HEART-BRIDGE"
                value={health.heart.status.toUpperCase()}
                sub={health.heart.model ?? health.heart.detail ?? "ollama bridge"}
                accent={health.heart.status === "online" ? "#ff8a3d" : "#8aa0bd"}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <Panel className="p-5">
                <h3 className="flex items-center gap-2 font-display text-[13px] font-black tracking-widest text-white">
                  <Activity className="h-4 w-4 text-cyan-300" /> SYSTEM HEALTH
                </h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <p className="font-mono2 text-[10px] tracking-widest text-slate-400">DATABASE LEDGER</p>
                    <div className="mt-2 flex items-center gap-2">
                      <StatusPill status={health.database ? "online" : "offline"} />
                      <span className="font-mono2 text-[11px] text-slate-300">
                        {health.database ? "Postgres / local DB answering" : "DB unreachable — check DATABASE_URL"}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <p className="font-mono2 text-[10px] tracking-widest text-slate-400">BRAIN GATEWAY</p>
                    <div className="mt-2 flex items-center gap-2">
                      <StatusPill status={health.brain} />
                      <span className="font-mono2 text-[11px] text-slate-300">
                        last answered by: {health.lastAnswered
                          ? `${health.lastAnswered.engine} @ ${new Date(health.lastAnswered.at).toLocaleTimeString()}`
                          : "none yet"} · next clean message: {health.answering}
                      </span>
                      <span className="font-mono2 text-[11px] text-slate-500">
                        {health.engines.join(" / ")}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <p className="font-mono2 text-[10px] tracking-widest text-slate-400">CHARTER LAW</p>
                    <p className="mt-1 font-display text-[11px] font-bold tracking-widest text-cyan-200">
                      {health.charter?.laws ?? 16} LAWS · {health.charter?.bodies ?? 3} BODIES ·{" "}
                      <span className="font-mono2 text-[10px] text-slate-400">{health.charter?.digest?.slice(0, 12) ?? "—"}</span>
                    </p>
                  </div>
                </div>
              </Panel>

              <ProjectsPanel />
            </div>
          </>
        )}

        {/* models */}
        <Panel className="p-5">
          <h3 className="flex items-center gap-2 font-display text-[13px] font-black tracking-widest text-white">
            <Layers className="h-4 w-4 text-red-400" /> CONNECTED MODELS · {models.length}
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {models.map((m) => (
              <div key={m.id} className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-4">
                <div className="flex items-center justify-between">
                  <p className="font-display text-[12px] font-black tracking-widest text-white">{m.name.toUpperCase()}</p>
                  <StatusPill status={m.status} />
                </div>
                <p className="mt-1 font-mono2 text-[10px] tracking-widest text-slate-400">
                  {m.vendor} · {m.role} · {m.selfHosted ? "SELF-HOSTED" : "RELAY"}
                </p>
                <p className="mt-2 font-mono2 text-[10px] text-slate-500">id: {m.id}</p>
              </div>
            ))}
            {models.length === 0 && !loading && (
              <p className="col-span-full font-mono2 text-[11px] tracking-widest text-slate-500">No models reported — seed may be pending.</p>
            )}
          </div>
        </Panel>

        {/* billing */}
        {billing && (
          <Panel className="p-5">
            <h3 className="flex items-center gap-2 font-display text-[13px] font-black tracking-widest text-white">
              <Crown className="h-4 w-4 text-amber-300" /> BILLING · {billing.currency} · {billing.gateway?.provider ?? "dodo"} ·{" "}
              <span className="font-mono2 text-[10px] tracking-widest text-slate-400">{billing.gateway?.mode ?? "display-only"}</span>
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(billing.passes).map(([id, pass]) => (
                <div key={id} className="rounded-xl border border-amber-400/20 bg-amber-500/[0.04] p-4">
                  <p className="font-display text-[11px] font-black tracking-[0.14em] text-amber-200">{pass.label.toUpperCase()}</p>
                  <p className="mt-1 font-display text-2xl font-black text-white">{pass.price}</p>
                  <p className="font-mono2 text-[10px] tracking-widest text-slate-400">{pass.hours}h · id: {id}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 font-mono2 text-[10px] leading-relaxed tracking-wider text-slate-500">
              Checkout is fail-closed when Dodo credentials are unset. Pass verification and webhook correlation enforce amount, currency (USD), and region match. No client-side minting.
            </p>
          </Panel>
        )}

        {/* doctrine + quick links */}
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Panel className="p-5">
            <h3 className="flex items-center gap-2 font-display text-[13px] font-black tracking-widest text-white">
              <BookOpen className="h-4 w-4 text-cyan-300" /> SOVEREIGN DOCTRINE
            </h3>
            <div className="mt-4 space-y-3 font-mono2 text-[11px] leading-relaxed tracking-wider text-slate-300">
              <p className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-400" />
                <span>One brain, one charter, one operator — every body speaks under the same 16 laws.</span>
              </p>
              <p className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-400" />
                <span>Engine ladder: core → ollama heart-bridge → fallback-local. No vendor API is called unless operator configures it.</span>
              </p>
              <p className="flex gap-2">
                <Lock className="mt-0.5 h-4 w-4 flex-none text-amber-300" />
                <span>Apache-2.0 posture, zero hidden dossiers, process-local fair-use buckets, and honest model statuses.</span>
              </p>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              <Link href="/vision" className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-center transition hover:border-cyan-400/40">
                <p className="font-display text-[11px] font-black tracking-widest text-white">OUR VISION</p>
                <p className="mt-1 font-mono2 text-[9px] tracking-widest text-slate-400">Sovereign charter</p>
              </Link>
              <Link href="/services" className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-center transition hover:border-cyan-400/40">
                <p className="font-display text-[11px] font-black tracking-widest text-white">SERVICES</p>
                <p className="mt-1 font-mono2 text-[9px] tracking-widest text-slate-400">Deployment help</p>
              </Link>
              <Link href="/contact" className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-center transition hover:border-cyan-400/40">
                <p className="font-display text-[11px] font-black tracking-widest text-white">CONTACT</p>
                <p className="mt-1 font-mono2 text-[9px] tracking-widest text-slate-400">Operator line</p>
              </Link>
            </div>
          </Panel>

          <Panel className="p-5">
            <h3 className="flex items-center gap-2 font-display text-[13px] font-black tracking-widest text-white">
              <Server className="h-4 w-4 text-red-400" /> OPERATOR ACTIONS
            </h3>
            <div className="mt-4 space-y-2.5">
              <a
                href="/api/health"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 font-mono2 text-[11px] tracking-widest text-slate-200 transition hover:border-cyan-400/40 hover:text-white"
              >
                <span>GET /api/health</span>
                <span className="text-[10px] text-slate-500">JSON ↗</span>
              </a>
              <a
                href="/api/models"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 font-mono2 text-[11px] tracking-widest text-slate-200 transition hover:border-cyan-400/40 hover:text-white"
              >
                <span>GET /api/models</span>
                <span className="text-[10px] text-slate-500">JSON ↗</span>
              </a>
              <a
                href="/api/billing"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 font-mono2 text-[11px] tracking-widest text-slate-200 transition hover:border-cyan-400/40 hover:text-white"
              >
                <span>GET /api/billing</span>
                <span className="text-[10px] text-slate-500">JSON ↗</span>
              </a>
              <Link
                href="/api-access"
                className="flex items-center justify-between rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2.5 font-mono2 text-[11px] tracking-widest text-amber-200 transition hover:border-amber-400/50"
              >
                <span className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" /> API TOKENS
                </span>
                <span className="text-[10px]">MANAGE →</span>
              </Link>
              <Link
                href="/subscription"
                className="flex items-center justify-between rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5 font-mono2 text-[11px] tracking-widest text-emerald-200 transition hover:border-emerald-400/50"
              >
                <span className="flex items-center gap-2">
                  <Crown className="h-4 w-4" /> SUBSCRIPTION
                </span>
                <span className="text-[10px]">PASSES →</span>
              </Link>
            </div>
            <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
              <p className="font-display text-[10px] font-black tracking-[0.18em] text-red-300">SECURITY NOTE</p>
              <p className="mt-1 font-mono2 text-[10px] leading-relaxed tracking-wider text-red-200/80">
                Admin console never shows secrets. Owner bypass requires server-side SG16_OWNER_SECRET header, never a client token. Email-as-owner is disabled. All rate limits are process-local.
              </p>
            </div>
          </Panel>
        </div>

        {/* imagery showcase — proves the 5d9ac32 imagery payload */}
        <Panel className="overflow-hidden p-0">
          <div className="grid md:grid-cols-3">
            <div className="relative min-h-[180px] border-b border-white/10 md:border-b-0 md:border-r">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/globe.png" alt="Sovereign global vision globe" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <p className="absolute bottom-2 left-3 font-display text-[10px] font-black tracking-[0.18em] text-cyan-200">GLOBE · GLOBAL VISION</p>
            </div>
            <div className="relative min-h-[180px] border-b border-white/10 md:border-b-0 md:border-r">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/ai-brain.jpg" alt="AI brain on circuit board" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <p className="absolute bottom-2 left-3 font-display text-[10px] font-black tracking-[0.18em] text-emerald-200">BRAIN · WHAT IS AI</p>
            </div>
            <div className="relative min-h-[180px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/shield.png" alt="Shield protecting united people" className="absolute inset-0 h-full w-full object-contain bg-[#070a10] p-6" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
              <p className="absolute bottom-2 left-3 font-display text-[10px] font-black tracking-[0.18em] text-amber-200">SHIELD · RESPONSIBLE AI</p>
            </div>
          </div>
        </Panel>

        <div className="flex justify-center gap-3 pb-6">
          <Link href="/" className="btn-ghost px-5 py-2 text-[11px]">
            ← BACK TO HOME
          </Link>
          <Link href="/chat" className="btn-red px-5 py-2 text-[11px]">
            OPEN CHAT
          </Link>
        </div>
      </div>
    </SiteChrome>
  );
}

// Operators only. The server enforces the same rule on every admin API call; this page just does not
// render the console (or call those APIs) for anyone else.
export default function AdminPage() {
  const signedIn = useSignedIn();
  const admin = useAdmin();
  if (admin === true) return <AdminConsole />;
  return (
    <SiteChrome>
      <div className="mx-auto max-w-[560px] px-4 py-20">
        <Panel className="p-8 text-center">
          <Shield className="mx-auto h-8 w-8 text-red-400" />
          <h1 className="mt-4 font-display text-lg font-black tracking-[0.14em] text-white">OPERATOR ACCESS</h1>
          {!signedIn ? (
            <>
              <p className="mt-3 text-[13px] leading-relaxed text-slate-400">
                This console is for the platform operator. Sign in with the operator email to continue.
              </p>
              <Link href="/login" className="btn-red mt-6 inline-flex items-center gap-2 px-6 py-3 text-[11px]">
                SIGN IN
              </Link>
            </>
          ) : admin === null ? (
            <p className="mt-3 text-[13px] text-slate-400">Checking your account…</p>
          ) : (
            <p className="mt-3 text-[13px] leading-relaxed text-slate-400">
              This account is not an operator of this platform.
            </p>
          )}
        </Panel>
      </div>
    </SiteChrome>
  );
}
