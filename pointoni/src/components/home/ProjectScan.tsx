"use client";

import { useEffect, useRef, useState } from "react";
import {
  FolderArchive,
  ClipboardPaste,
  ShieldCheck,
  ShieldAlert,
  Crosshair,
  BadgeCheck,
  TriangleAlert,
  Copy,
  RotateCcw,
  HeartPulse,
  FileCode2,
  CheckCircle2,
} from "lucide-react";
import { Panel, PanelTitle } from "@/components/ui/Panel";

// ── PROJECT VITAL SCAN — free project health scan, request-memory only ──
// Drop a ZIP / code files / paste a snippet → expanding medical-style scan
// → deterministic, evidenced report. Mirrors /api/project-scan.

type Severity = "critical" | "warning" | "note";
type ScanFinding = {
  severity: Severity;
  rule: string;
  where: string;
  snippet: string;
  suggestion: string;
};
type ScanCheck = {
  key: string;
  title: string;
  weight: number;
  measured: string;
  threshold: string;
  status: "pass" | "warn" | "fail";
  suggestion?: string;
};
type ScanReport = {
  scanId: string;
  version: string;
  timestampUtc: string;
  durationMs: number;
  sha256: string;
  retention: string;
  stats: {
    files: number;
    analyzedFiles: number;
    skippedBinary: number;
    totalBytes: number;
    totalLines: number;
    languages: { lang: string; files: number; bytes: number }[];
  };
  checks: ScanCheck[];
  findings: ScanFinding[];
  score: number;
  benchmark: number;
  benchmarkDelta: number;
  grade: "A" | "B" | "C" | "D" | "F";
  verdict: string;
};

const PHASES = [
  "INGESTING PACKAGE — reading container & hashing bytes",
  "UNPACKING — mapping file tree & running language census",
  "DEEP ANALYSIS — secret sweep · duplication graph · complexity map",
  "BENCHMARK COMPARE — scoring against clean-bill benchmark 100",
  "SEALING REPORT — determinism lock & SHA-256 fingerprint",
];
const MIN_STAGE_MS = 4600;

const PLACEHOLDER_STREAM = [
  "src/index.ts", "src/lib/core.ts", "package.json", "app/routes/api.py",
  "internal/engine.go", "web/App.tsx", "styles/site.css", "tests/core.test.py",
  "README.md", "LICENSE", "utils/helpers.js", "docker-compose.yml",
];

function fmtBytes(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function ProjectScan() {
  const [files, setFiles] = useState<File[]>([]);
  const [pasteOn, setPasteOn] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [phase, setPhase] = useState<"idle" | "scanning" | "report" | "error">("idle");
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ringOn, setRingOn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  // staged progress while the real request runs
  useEffect(() => {
    if (phase !== "scanning") return;
    const started = Date.now();
    const t = setInterval(() => {
      const el = Date.now() - started;
      setProgress(Math.min(99, Math.round((el / MIN_STAGE_MS) * 100)));
      setStage(Math.min(PHASES.length - 1, Math.floor(el / (MIN_STAGE_MS / PHASES.length))));
    }, 90);
    return () => clearInterval(t);
  }, [phase]);

  // score ring draw-in
  useEffect(() => {
    if (phase !== "report") return;
    const t = setTimeout(() => setRingOn(true), 220);
    return () => clearTimeout(t);
  }, [phase]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 60));
  }

  async function runScan() {
    setErr(null);
    setReport(null);
    if (pasteOn) {
      if (!pasteText.trim()) {
        setErr("Paste some code first.");
        return;
      }
    } else if (files.length === 0) {
      setErr("Drop a ZIP, code files, or switch to paste mode.");
      return;
    }

    setPhase("scanning");
    setStage(0);
    setProgress(0);
    setRingOn(false);

    const t0 = Date.now();
    let request: Promise<Response>;
    if (pasteOn) {
      request = fetch("/api/project-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: pasteText, label: "snippet" }),
      });
    } else {
      const fd = new FormData();
      for (const f of files) fd.append("files", f, f.name);
      request = fetch("/api/project-scan", { method: "POST", body: fd });
    }

    try {
      const res = await request;
      const body = await res.json();
      const remaining = MIN_STAGE_MS - (Date.now() - t0);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      if (!res.ok) {
        setErr(body.error || "Scan failed. Try a smaller source-only package.");
        setPhase("error");
        return;
      }
      setProgress(100);
      setReport(body as ScanReport);
      setPhase("report");
    } catch {
      setErr("The scan engine is unreachable. Check your connection and try again.");
      setPhase("error");
    }
  }

  function reset() {
    setFiles([]);
    setPasteText("");
    setReport(null);
    setErr(null);
    setPhase("idle");
  }

  function copyReport() {
    if (!report) return;
    navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  const streamNames =
    files.length > 0 ? files.slice(0, 12).map((f) => f.name) : pasteOn ? ["pasted/snippet.js"] : PLACEHOLDER_STREAM;
  const streamLoop = [...streamNames, ...streamNames];

  const statusIcon = (s: ScanCheck["status"]) =>
    s === "pass" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    ) : s === "warn" ? (
      <TriangleAlert className="h-4 w-4 text-amber-300" />
    ) : (
      <ShieldAlert className="h-4 w-4 text-red-400" />
    );

  // score ring geometry
  const R = 54;
  const C = 2 * Math.PI * R;

  return (
    <Panel id="project-scan" className="flex flex-col">
      <div className="relative flex flex-none items-center justify-center border-b border-red-500/25 px-4 py-3">
        <PanelTitle accent="cyan">PROJECT VITAL SCAN</PanelTitle>
        <span className="absolute right-3 inline-flex items-center gap-1.5 rounded border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 font-display text-[8px] font-black tracking-[0.18em] text-emerald-300">
          <ShieldCheck className="h-3 w-3" /> FREE · ANALYZED IN REQUEST MEMORY · APP WRITES NO FILE BODIES
        </span>
      </div>

      {/* intro rail */}
      <p className="px-5 pt-3 text-center font-mono2 text-[10px] leading-relaxed tracking-[0.18em] text-slate-400">
        DROP YOUR PROJECT → STRUCTURED SCAN → EVIDENCED HEALTH REPORT ·
        APP PROCESSES IN REQUEST MEMORY · NO REPORT ROWS PERSISTED · REVERSE PROXY LOGS MAY STILL APPLY
      </p>

      {/* ─────────── IDLE / INPUT ─────────── */}
      {phase !== "report" && (
        <div className="p-4">
          <div className="mb-3 flex justify-center gap-2">
            <button
              onClick={() => setPasteOn(false)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-[10px] font-bold tracking-widest transition ${
                !pasteOn
                  ? "border-red-400/60 bg-red-500/15 text-red-200"
                  : "border-white/15 text-slate-400 hover:text-white"
              }`}
            >
              <FolderArchive className="h-3.5 w-3.5" /> DROP FILES
            </button>
            <button
              onClick={() => setPasteOn(true)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-[10px] font-bold tracking-widest transition ${
                pasteOn
                  ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                  : "border-white/15 text-slate-400 hover:text-white"
              }`}
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> PASTE CODE
            </button>
          </div>

          {!pasteOn ? (
            <>
              <div
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  addFiles(e.dataTransfer.files);
                }}
                className={`group grid cursor-pointer place-items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
                  drag
                    ? "border-emerald-400 bg-emerald-500/10 shadow-[0_0_30px_rgba(34,224,140,.25)]"
                    : "border-red-400/40 bg-black/40 hover:border-red-300/70 hover:shadow-[0_0_26px_rgba(255,31,46,.2)]"
                }`}
              >
                <FolderArchive className={`h-9 w-9 transition ${drag ? "text-emerald-300" : "text-red-400 group-hover:text-red-300"}`} strokeWidth={1.4} />
                <div className="font-display text-sm font-black tracking-[0.18em] text-white">
                  DROP YOUR PROJECT HERE
                </div>
                <div className="font-mono2 text-[10px] tracking-[0.2em] text-slate-400">
                  .ZIP PACKAGE · CODE FILES · ANY LANGUAGE · or click to browse
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </div>
              {files.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {files.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2 py-1 font-mono2 text-[10px] text-slate-200"
                    >
                      <FileCode2 className="h-3 w-3 text-cyan-300" /> {f.name} · {fmtBytes(f.size)}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="// paste your code here — it is scanned in memory and never stored"
              className="input-dark h-40 w-full resize-y p-3 font-mono2 text-[12px]"
              spellCheck={false}
            />
          )}

          {phase === "error" && err && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-300">
              <TriangleAlert className="h-4 w-4 flex-none" /> {err}
            </div>
          )}

          <div className="mt-4 flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
            <span className="font-mono2 text-[9px] tracking-[0.2em] text-slate-500">
              BUDGET: 8 MB UPLOAD · 300 FILES · SOURCE ONLY, NO BUILD FOLDERS
            </span>
            <button
              onClick={runScan}
              disabled={phase === "scanning"}
              className="btn-red inline-flex items-center gap-2 px-6 py-2.5 font-display text-[11px] font-black tracking-[0.2em] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Crosshair className="h-4 w-4" />
              {phase === "scanning" ? "SCANNING…" : "CHECK PROJECT HEALTH"}
            </button>
          </div>
        </div>
      )}

      {/* ─────────── SCANNING THEATER — expands when running ─────────── */}
      <div
        className={`grid transition-[grid-template-rows] duration-500 ease-out ${
          phase === "scanning" ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {phase === "scanning" && (
            <div className="expand-open m-4 overflow-hidden rounded-xl border border-emerald-400/30 bg-black/60">
              <div className="flex items-center justify-between border-b border-emerald-400/25 px-4 py-2">
                <span className="inline-flex items-center gap-2 font-display text-[11px] font-black tracking-[0.22em] text-emerald-300">
                  <HeartPulse className="h-4 w-4 pulse-soft" /> SCAN IN PROGRESS
                </span>
                <span className="font-display text-2xl font-black tabular-nums text-emerald-300">{progress}%</span>
              </div>
              <div className="relative grid gap-0 sm:grid-cols-[220px_1fr]">
                {/* medical beam theater */}
                <div className="relative h-44 overflow-hidden border-b border-emerald-400/20 bg-gradient-to-b from-emerald-950/40 to-black sm:h-auto sm:border-b-0 sm:border-r">
                  <div className="absolute inset-0 grid place-items-center">
                    <span className="relative grid h-28 w-28 place-items-center">
                      <span className="radar-ring" />
                      <span className="radar-ring" style={{ animationDelay: "0.8s" }} />
                      <span className="radar-ring" style={{ animationDelay: "1.6s" }} />
                      <Crosshair className="h-10 w-10 text-emerald-300 spin-slow" style={{ animationDuration: "6s" }} strokeWidth={1.3} />
                    </span>
                  </div>
                  <span className="scan-beam" />
                </div>
                {/* telemetry stream */}
                <div className="relative h-44 overflow-hidden sm:h-36">
                  <div className="stream-track absolute inset-x-0 top-0">
                    {streamLoop.map((n, i) => (
                      <div key={`${n}-${i}`} className="flex items-center gap-2 px-4 py-[5px] font-mono2 text-[10px] tracking-wider text-emerald-200/80">
                        <FileCode2 className="h-3 w-3 text-emerald-400/70" /> ./{n}
                        <span className="ml-auto text-emerald-400/50">…parsed</span>
                      </div>
                    ))}
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black to-transparent" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black to-transparent" />
                </div>
              </div>
              <div className="border-t border-emerald-400/25 px-4 py-2.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-[width] duration-150"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-2 font-mono2 text-[10px] tracking-[0.16em] text-emerald-200/90">
                  ▸ {PHASES[stage]}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─────────── REPORT ─────────── */}
      {phase === "report" && report && (
        <div className="expand-open p-4">
          {/* score hero */}
          <div className="grid items-center gap-5 rounded-xl border border-white/10 bg-black/40 p-5 sm:grid-cols-[auto_1fr]">
            <div className="relative mx-auto h-[132px] w-[132px]">
              <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90">
                <circle cx="66" cy="66" r={R} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="10" />
                <circle
                  cx="66"
                  cy="66"
                  r={R}
                  fill="none"
                  stroke={report.score >= 80 ? "#22e08c" : report.score >= 60 ? "#f5c44c" : "#ff4f5e"}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={C}
                  strokeDashoffset={ringOn ? C - (C * report.score) / 100 : C}
                  style={{ transition: "stroke-dashoffset 1.4s cubic-bezier(.22,.9,.24,1)" }}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <div className="font-display text-3xl font-black tabular-nums text-white">{report.score}</div>
                  <div className="font-mono2 text-[9px] tracking-[0.24em] text-slate-400">
                    GRADE {report.grade}
                  </div>
                </div>
              </div>
            </div>
            <div className="text-center sm:text-left">
              <div className="font-display text-lg font-black tracking-[0.14em] text-white">
                PROJECT HEALTH REPORT
              </div>
              <div
                className={`mt-1 font-display text-[13px] font-bold tracking-[0.1em] ${
                  report.benchmarkDelta >= 0 ? "text-emerald-300" : "text-red-300"
                }`}
              >
                {report.benchmarkDelta >= 0 ? (
                  <>AT THE CLEAN-BILL BENCHMARK ({report.benchmark})</>
                ) : (
                  <>{Math.abs(report.benchmarkDelta)} PTS BELOW BENCHMARK ({report.benchmark})</>
                )}
              </div>
              <p className="mt-2 max-w-xl text-[13px] font-medium leading-relaxed text-slate-300">{report.verdict}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 font-mono2 text-[10px] tracking-wider text-slate-400 sm:justify-start">
                <span>{report.stats.analyzedFiles} FILES</span>
                <span>{report.stats.totalLines.toLocaleString()} LINES</span>
                <span>{fmtBytes(report.stats.totalBytes)}</span>
                <span>{report.stats.languages.slice(0, 4).map((l) => l.lang).join(" · ")}</span>
                <span>{report.durationMs} MS ENGINE TIME</span>
              </div>
            </div>
          </div>

          {/* checks grid */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {report.checks.map((c) => (
              <div
                key={c.key}
                className={`rounded-lg border p-3 ${
                  c.status === "pass"
                    ? "border-emerald-500/25 bg-emerald-500/[0.04]"
                    : c.status === "warn"
                    ? "border-amber-400/30 bg-amber-400/[0.05]"
                    : "border-red-400/40 bg-red-500/[0.07]"
                }`}
              >
                <div className="flex items-center gap-2">
                  {statusIcon(c.status)}
                  <span className="flex-1 font-display text-[11px] font-bold tracking-wider text-white">
                    {c.title}
                  </span>
                  <span className="font-mono2 text-[9px] tracking-wider text-slate-500">W{c.weight}</span>
                </div>
                <div className="mt-1.5 font-mono2 text-[10px] leading-relaxed text-slate-300">{c.measured}</div>
                <div className="font-mono2 text-[9px] tracking-wider text-slate-500">benchmark: {c.threshold}</div>
                {c.suggestion && (
                  <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] font-medium leading-relaxed text-slate-300">
                    💡 {c.suggestion}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* evidenced findings */}
          {report.findings.length > 0 && (
            <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/[0.05]">
              <div className="flex items-center gap-2 border-b border-red-400/25 px-4 py-2.5 font-display text-[11px] font-black tracking-[0.18em] text-red-300">
                <ShieldAlert className="h-4 w-4" /> EVIDENCE — {report.findings.length} FINDING(S), WORST FIRST
              </div>
              <ul className="max-h-56 divide-y divide-white/5 overflow-y-auto">
                {report.findings.map((f, i) => (
                  <li key={i} className="px-4 py-2">
                    <div className="flex items-center gap-2 font-mono2 text-[10px]">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[8px] font-black tracking-widest ${
                          f.severity === "critical" ? "bg-red-500/25 text-red-200" : "bg-amber-400/20 text-amber-200"
                        }`}
                      >
                        {f.severity.toUpperCase()}
                      </span>
                      <span className="flex-1 truncate text-slate-200">{f.rule}</span>
                      <span className="text-cyan-300">{f.where}</span>
                    </div>
                    <div className="mt-1 truncate font-mono2 text-[10px] text-slate-500">{f.snippet}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* verifier stamp */}
          <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-500/[0.05] px-4 py-3 text-center">
            <div className="inline-flex items-center gap-2 font-display text-[10px] font-black tracking-[0.22em] text-cyan-300">
              <BadgeCheck className="h-4 w-4" /> DETERMINISTIC · VERIFIABLE · ZERO RETENTION
            </div>
            <p className="font-mono2 text-[9px] leading-relaxed tracking-[0.14em] text-slate-400">
              SCAN-ID {report.scanId.toUpperCase()} · {report.stats.files} OBJECT(S) · SHA-256 {report.sha256.slice(0, 32)}…
              <br />
              {new Date(report.timestampUtc).toUTCString()} · ENGINE v{report.version} · {report.retention}
              <br />
              SAME BYTES IN → SAME REPORT OUT. RE-SCAN ANY TIME TO CONFIRM INDEPENDENTLY.
            </p>
            <div className="mt-1 flex gap-2">
              <button
                onClick={copyReport}
                className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 font-display text-[9px] font-bold tracking-widest text-cyan-200 transition hover:bg-cyan-500/20"
              >
                <Copy className="h-3 w-3" /> {copied ? "COPIED ✓" : "COPY REPORT JSON"}
              </button>
              <button
                onClick={reset}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-400/40 bg-red-500/10 px-3 py-1.5 font-display text-[9px] font-bold tracking-widest text-red-200 transition hover:bg-red-500/20"
              >
                <RotateCcw className="h-3 w-3" /> SCAN ANOTHER PROJECT
              </button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
