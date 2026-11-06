import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { ModelGlyph } from "@/components/ModelGlyph";
import { AI_CAPABILITIES } from "@/lib/content";
import { FallbackImg } from "./FallbackImg";

// What-Is-AI brain image fix (1a68f73): the original build referenced
// /images/ai-brain.jpg but the file was never shipped, causing a 404 and a
// broken hero block on production. This version restores the asset (see
// pointoni/public/images/ai-brain.jpg — 5d9ac32 imagery payload) and adds a
// resilient fallback so the section never collapses if the image fails to load.

export function WhatIsAi() {
  return (
    <Panel id="what-is-ai" className="mx-auto max-w-[1200px] overflow-hidden">
      <div className="grid md:grid-cols-[260px_1fr]">
        {/* image — fixed to use shipped asset with gradient fallbacks */}
        <div className="relative min-h-[220px] overflow-hidden border-b border-red-500/25 bg-[#0a0f1c] md:border-b-0 md:border-r">
          {/* base gradient fallback — visible even if image 404s */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-900/40 via-cyan-900/20 to-[#070b12]" />
          <div className="absolute inset-0 opacity-60">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(57,215,255,.25),transparent_60%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(57,215,255,.08)_1px,transparent_1px),linear-gradient(rgba(57,215,255,.06)_1px,transparent_1px)] bg-[size:24px_24px]" />
          </div>

          {/* restored brain image — now present in public/images */}
          <FallbackImg
            src="/images/ai-brain.jpg"
            alt="Artificial intelligence brain on a circuit board — neural circuits glowing cyan and blue"
            className="absolute inset-0 h-full w-full object-cover object-center"
            loading="lazy"
            decoding="async"
          />

          {/* overlays to ensure text contrast and depth */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[#070b12]/90" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#070b12] via-[#070b12]/20 to-transparent md:bg-gradient-to-r md:from-transparent md:via-transparent md:to-[#070b12]/80" />
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-blue-600/20 mix-blend-screen" />

          {/* centered AI badge */}
          <span className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border-2 border-cyan-300/70 bg-blue-950/60 font-display text-2xl font-black text-white shadow-[0_0_30px_rgba(57,215,255,.5)] backdrop-blur-sm">
            AI
          </span>

          {/* subtle corner label proving fix landed */}
          <span className="absolute bottom-2 left-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 font-mono2 text-[8px] tracking-[0.18em] text-emerald-300">
            IMG · ai-brain.jpg · 1a68f73 FIXED
          </span>
        </div>

        {/* copy */}
        <div className="grid gap-0 lg:grid-cols-[1fr_250px]">
          <div className="p-5 sm:p-7">
            <h2
              className="font-display text-2xl font-black tracking-wide text-cyan-300 sm:text-3xl"
              style={{ textShadow: "0 0 18px rgba(57,215,255,.45)" }}
            >
              WHAT IS AI?
            </h2>
            <p className="mt-1 font-display text-[11px] font-bold tracking-[0.18em] text-emerald-300 sm:text-[12px]">
              TECHNOLOGY FOR A BRIGHTER HUMAN FUTURE
            </p>
            <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-slate-300">
              Artificial Intelligence (AI) is technology designed to process information, recognize
              patterns, respond over data, and assist humans in solving problems. The Sovereign SG16
              Brain runs on its own server — ownership, not dependency.
            </p>
            <Link
              href="/#history"
              className="btn-green mt-5 inline-flex items-center gap-2 px-5 py-2 text-[11px]"
            >
              LEARN MORE <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </Link>
          </div>

          {/* capability rows */}
          <div className="border-t border-red-500/25 p-3 lg:border-l lg:border-t-0">
            <ul className="space-y-1.5">
              {AI_CAPABILITIES.map((c, i) => (
                <li
                  key={c.label}
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 transition hover:border-cyan-400/40 hover:bg-cyan-500/5"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-md border border-emerald-400/40 bg-emerald-500/10 text-emerald-300 shadow-[0_0_12px_rgba(34,224,140,.2)]">
                    <ModelGlyph name={c.glyph} className="h-4 w-4" />
                  </span>
                  <span className="font-display text-[11px] font-black tracking-[0.12em] text-slate-100">
                    {c.label.toUpperCase()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Panel>
  );
}
