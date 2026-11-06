import Link from "next/link";
import { Shield, MessageSquare } from "lucide-react";
import { HERO_PILLARS } from "@/lib/content";
import { FallbackImg } from "./FallbackImg";
import { AdminOnly } from "@/components/AdminOnly";

function Pillar({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="relative grid h-5 w-5 flex-none place-items-center">
        <span className="absolute inset-0 rounded-full border border-cyan-300/70" />
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(57,215,255,.9)]" />
      </span>
      <span className="font-display text-[12px] font-bold tracking-[0.18em] text-cyan-200 sm:text-[13px]">
        {label.toUpperCase()}
      </span>
    </li>
  );
}

function GlobeModule() {
  return (
    <div className="relative mx-auto w-[240px] sm:w-[280px]">
      <div className="relative aspect-square">
        <div
          className="absolute inset-0 rounded-full spin-slow"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(57,150,255,.35) 40deg, transparent 90deg, transparent 200deg, rgba(255,60,70,.3) 250deg, transparent 300deg)",
            maskImage: "radial-gradient(circle, transparent 62%, black 63%)",
            WebkitMaskImage:
              "radial-gradient(circle, transparent 62%, black 63%)",
          }}
        />
        <div className="absolute inset-3 rounded-full border border-blue-400/30 spin-rev" />
        <div className="absolute inset-7 rounded-full border border-blue-400/20" />
        {/* sovereign globe imagery — restored in 5d9ac32 */}
        <FallbackImg
          onMissing="hide"
          src="/images/globe.png"
          alt="One brain global vision network globe"
          className="absolute inset-4 h-[calc(100%-32px)] w-[calc(100%-32px)] rounded-full object-cover"
          style={{
            mixBlendMode: "screen",
            filter: "drop-shadow(0 0 24px rgba(60,140,255,.55))",
          }}
          loading="eager"
        />
        {/* fallback inner glow when image fails */}
        <div className="absolute inset-4 rounded-full bg-gradient-to-br from-blue-600/20 via-cyan-500/10 to-red-600/20 blur-[1px]" />
      </div>
      <div className="absolute inset-x-0 top-[30%] text-center">
        <p className="font-display text-[13px] font-black leading-tight tracking-wide text-white drop-shadow-[0_0_8px_rgba(0,0,0,.9)]">
          ONE BRAIN
          <br />
          GLOBAL VISION
          <br />A SMARTER WORLD
        </p>
      </div>
      <div className="absolute inset-x-0 bottom-[2%] text-center">
        <p className="font-display text-[11px] font-black leading-[1.35] tracking-[0.14em] text-cyan-300 drop-shadow-[0_0_8px_rgba(57,215,255,.8)]">
          LEARN · BUILD
          <br />
          INNOVATE · GROW
          <br />
          TOGETHER
        </p>
      </div>
    </div>
  );
}

export function HeroStage() {
  return (
    <section id="home" className="relative isolate w-full pb-16 pt-8 sm:pt-12">
      {/* The red stage with the official seal is the background of the whole hero; the seal is part of the
          picture, so no separate logo or pedestal is drawn on top. Full width, fading into the page below. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[430px] lg:h-full"
        style={{
          backgroundImage: "url('/images/stage-bg-v2.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "50% 45%",
          backgroundRepeat: "no-repeat",
          maskImage:
            "linear-gradient(180deg, #000 0%, #000 82%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(180deg, #000 0%, #000 82%, transparent 100%)",
        }}
      />
      <div className="mx-auto max-w-[1200px] px-3 sm:px-5">
        {/* operator strip — visible proof that admin imagery payload landed */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 font-mono2 text-[9px] tracking-[0.18em] text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(34,224,140,.8)]" />
            SOVEREIGN CORE · Q16.16
          </span>
          <AdminOnly>
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/10 px-3 py-1 font-mono2 text-[9px] tracking-[0.18em] text-red-200 transition hover:border-red-400/70 hover:text-white"
            >
              <Shield className="h-3 w-3" /> ADMIN CONSOLE
            </Link>
          </AdminOnly>
        </div>

        <div className="grid items-center gap-8 lg:min-h-[520px] lg:grid-cols-[1fr_380px_1fr]">
          {/* Left: headline */}
          <div className="order-2 text-center lg:order-1 lg:text-left">
            <h1 className="font-display text-[26px] font-black leading-[1.05] tracking-wide text-white sm:text-[34px] xl:text-[40px]">
              SOVEREIGN
              <br />
              INTELLIGENCE
              <br />
              FOR A BRIGHTER
              <br />
              <span
                className="text-tomorrow-gradient text-[34px] sm:text-[44px] lg:text-[40px] xl:text-[46px]"
                style={{ filter: "drop-shadow(0 0 18px rgba(255,40,60,.45))" }}
              >
                TOMORROW
              </span>
            </h1>
            <ul className="mt-6 space-y-2.5">
              {HERO_PILLARS.map((p) => (
                <Pillar key={p} label={p} />
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
              <Link
                href="/chat"
                className="btn-red inline-flex items-center gap-2 px-6 py-2.5 text-[11px]"
              >
                <MessageSquare className="h-4 w-4" /> START CHAT
              </Link>
              <AdminOnly>
                <Link
                  href="/admin"
                  className="btn-ghost inline-flex items-center gap-2 px-6 py-2.5 text-[11px]"
                >
                  <Shield className="h-4 w-4" /> OPERATOR CONSOLE
                </Link>
              </AdminOnly>
            </div>
          </div>

          {/* Center: left empty on purpose - the seal in the background picture sits here */}
          <div
            aria-hidden
            className="order-1 h-[300px] sm:h-[340px] lg:order-2 lg:h-auto"
          />

          {/* Right: globe */}
          <div className="order-3 flex justify-center lg:justify-end">
            <GlobeModule />
          </div>
        </div>
      </div>
    </section>
  );
}
