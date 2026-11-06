"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Radio } from "lucide-react";
import { Panel, PanelTitle } from "@/components/ui/Panel";

// Live Global Markets ticker — infinite bottom-to-top vertical scroll.
// Snapshot quotes with light on-device jitter so the tape feels alive;
// the container/typography follow the platform's existing panel styling.

type Quote = { sym: string; name: string; price: number; change: number; kind: string };

const QUOTES: Quote[] = [
  { sym: "S&P 500", name: "US500 Index", price: 6184.32, change: +0.42, kind: "INDEX" },
  { sym: "NASDAQ", name: "Composite", price: 20311.77, change: +0.87, kind: "INDEX" },
  { sym: "DOW", name: "Jones Industrial", price: 44296.15, change: -0.18, kind: "INDEX" },
  { sym: "FTSE 100", name: "London", price: 8234.60, change: +0.31, kind: "INDEX" },
  { sym: "DAX", name: "Frankfurt", price: 19280.40, change: +0.55, kind: "INDEX" },
  { sym: "NIKKEI", name: "Tokyo 225", price: 38920.10, change: -0.64, kind: "INDEX" },
  { sym: "HANG SENG", name: "Hong Kong", price: 19805.30, change: +1.12, kind: "INDEX" },
  { sym: "BTC/USD", name: "Bitcoin", price: 97412.00, change: +2.31, kind: "CRYPTO" },
  { sym: "ETH/USD", name: "Ethereum", price: 3412.86, change: +1.74, kind: "CRYPTO" },
  { sym: "SOL/USD", name: "Solana", price: 218.42, change: -0.96, kind: "CRYPTO" },
  { sym: "XAU/USD", name: "Gold Spot", price: 2688.40, change: +0.58, kind: "METAL" },
  { sym: "XAG/USD", name: "Silver Spot", price: 31.24, change: +1.06, kind: "METAL" },
  { sym: "BRENT", name: "Crude Oil", price: 74.86, change: -1.22, kind: "ENERGY" },
  { sym: "EUR/USD", name: "Euro", price: 1.0842, change: +0.11, kind: "FX" },
  { sym: "GBP/USD", name: "Pound", price: 1.2718, change: -0.07, kind: "FX" },
  { sym: "USD/JPY", name: "Yen", price: 154.32, change: +0.34, kind: "FX" },
  { sym: "USD/MYR", name: "Ringgit", price: 4.4921, change: -0.12, kind: "FX" },
  { sym: "US10Y", name: "Treasury Yield", price: 4.281, change: +0.02, kind: "BOND" },
];

function fmt(n: number) {
  return n >= 1000 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toFixed(n < 10 ? 4 : 2);
}

function TapeRow({ q, jitter }: { q: Quote; jitter: number }) {
  const price = q.price * (1 + jitter);
  const up = q.change >= 0;
  const accent = up ? "#22e08c" : "#ff4f5e";
  return (
    <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
      <span className="grid h-7 w-7 flex-none place-items-center rounded-md border border-white/10 bg-white/[0.04]">
        {up ? (
          <TrendingUp className="h-3.5 w-3.5" style={{ color: accent }} />
        ) : (
          <TrendingDown className="h-3.5 w-3.5" style={{ color: accent }} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[11px] font-black tracking-wide text-white">
          {q.sym}
        </span>
        <span className="block truncate font-mono2 text-[8px] tracking-[0.18em] text-slate-500">
          {q.name} · {q.kind}
        </span>
      </span>
      <span className="text-right">
        <span className="block font-mono2 text-[11px] font-bold text-white">{fmt(price)}</span>
        <span className="block font-mono2 text-[9px] font-bold" style={{ color: accent }}>
          {up ? "▲" : "▼"} {Math.abs(q.change).toFixed(2)}%
        </span>
      </span>
    </div>
  );
}

export function FinancialTicker({ full = false }: { full?: boolean }) {
  // gentle ±0.15% on-device jitter every 2s keeps the tape breathing
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setBeat((b) => b + 1), 2000);
    return () => clearInterval(t);
  }, []);
  const jitter = Math.sin(beat * 0.9) * 0.0015;

  // the list renders twice; the CSS keyframe translates -50% for a
  // seamless infinite bottom-to-top loop
  const loop = [...QUOTES, ...QUOTES];

  return (
    <Panel className="flex h-full flex-col">
      <div className="relative flex items-center justify-center border-b border-red-500/25 px-4 py-3">
        <PanelTitle>LIVE GLOBAL MARKETS</PanelTitle>
        <span className="absolute right-3 inline-flex items-center gap-1.5 font-mono2 text-[9px] font-bold tracking-widest text-emerald-300">
          <Radio className="h-3 w-3 pulse-soft" /> TAPE
        </span>
      </div>
      <div
        className={`ticker-viewport relative ${full ? "flex-1" : "h-[320px] sm:h-[360px]"}`}
      >
        <div className="ticker-track absolute inset-x-0 top-0">
          {loop.map((q, i) => (
            <TapeRow key={`${q.sym}-${i}`} q={q} jitter={jitter} />
          ))}
        </div>
        <span className="scanline" aria-hidden />
        {/* edge fades, same language as the platform's vignettes */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[#070a10] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#070a10] to-transparent" />
      </div>
      <p className="border-t border-red-500/20 px-3 py-2 text-center font-mono2 text-[8px] tracking-[0.24em] text-slate-500">
        DEMONSTRATION TAPE · SGT/MY TIME · SCROLLS CONTINUOUSLY
      </p>
    </Panel>
  );
}
