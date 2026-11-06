"use client";

import { useState, type ReactNode, useMemo } from "react";
import Link from "next/link";
import { COMPANY } from "@/lib/company";
import { TopNav } from "./TopNav";
import { Sidebar, SidebarDrawer } from "./Sidebar";
import { FooterRail } from "./FooterRail";

function Embers() {
  const sparks = useMemo(
    () =>
      Array.from({ length: 22 }).map((_, i) => ({
        left: `${(i * 4.6 + (i % 3) * 3) % 100}%`,
        bottom: `-10px`,
        delay: `${(i * 0.9) % 12}s`,
        duration: `${9 + (i % 7) * 2.4}s`,
        drift: `${(i % 2 ? 1 : -1) * (18 + (i % 5) * 12)}px`,
        scale: 0.6 + ((i * 7) % 10) / 10,
      })),
    [],
  );
  return (
    <div aria-hidden>
      {sparks.map((s, i) => (
        <span
          key={i}
          className="ember"
          style={{
            left: s.left,
            bottom: s.bottom,
            animationDelay: s.delay,
            animationDuration: s.duration,
            ["--drift" as string]: s.drift,
            transform: `scale(${s.scale})`,
          }}
        />
      ))}
    </div>
  );
}

export function SiteChrome({
  children,
  hideFooter = false,
}: {
  children: ReactNode;
  hideFooter?: boolean;
}) {
  const [drawer, setDrawer] = useState(false);

  return (
    <>
      <Embers />
      <TopNav onMenu={() => setDrawer(true)} />
      <Sidebar />
      <SidebarDrawer open={drawer} onClose={() => setDrawer(false)} />

      {/* side panel auto-hides — main takes the full viewport width */}
      <div>
        <main className="min-h-screen pt-[58px]">{children}</main>

        {!hideFooter && (
          <footer className="relative mt-10 border-t border-red-500/30 bg-black/60">
            <div className="glow-divider" />
            {/* the doctrine tape — runs continuously under every page */}
            <FooterRail />
            <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-4 px-4 py-10 text-center sm:flex-row sm:justify-between sm:text-left">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/emblem-v2.png" alt="Sovereign SG16 Brain" className="h-11 w-11 flex-none object-contain" />
                <div>
                  <div className="font-display text-sm font-black tracking-widest text-white">
                    SOVEREIGN <span className="text-red-500">SG16</span> BRAIN
                  </div>
                  <div className="font-mono2 text-[9px] tracking-[0.2em] text-slate-400">
                    mistralbrain.com
                  </div>
                </div>
              </div>
              <p className="max-w-md font-mono2 text-[10px] leading-relaxed tracking-wider text-slate-400">
                SG16-POWERED AI GLOBAL INTELLIGENCE NETWORK
                <br />
                BUILT FOR A BRIGHTER FUTURE.
                <br />
                ONE MIND, ONE PLANET. ONE SOVEREIGN BRAIN.
              </p>
              {/* official company identity — SAIF TECH GLOBAL LLC (old-site footer, mapped 1:1) */}
              <div className="max-w-md font-mono2 leading-relaxed">
                <div className="font-display text-[12px] font-black tracking-widest text-amber-300">
                  {COMPANY.name}
                </div>
                <div className="mt-1 text-[9px] tracking-[0.14em] text-slate-400">
                  {COMPANY.services}
                </div>
                <div className="mt-1 text-[9px] tracking-[0.14em] text-slate-500">
                  {COMPANY.address}
                </div>
                <div className="mt-2 text-[9px] tracking-[0.14em] text-slate-400">
                  {COMPANY.brandTagline}
                </div>
              </div>
              <div className="flex flex-col gap-1 font-display text-[10px] font-bold tracking-widest">
                <Link href="/vision" className="text-slate-300 transition hover:text-red-300">OUR VISION</Link>
                <Link href="/services" className="text-slate-300 transition hover:text-red-300">SERVICES</Link>
                <Link href="/api-access" className="text-slate-300 transition hover:text-red-300">API ACCESS</Link>
                <Link href="/support" className="text-slate-300 transition hover:text-red-300">SUPPORT</Link>
              </div>
            </div>
            <div className="border-t border-red-500/15 py-2.5 text-center font-mono2 text-[9px] tracking-[0.25em] text-slate-500">
              {COMPANY.copyright} · {COMPANY.motto}
            </div>
            <div className="border-t border-red-500/15 py-3 text-center font-mono2 text-[9px] tracking-[0.25em] text-slate-500">
              APACHE 2.0 · SOVEREIGN SG16 BRAIN · KNOWLEDGE · DIPLOMACY · A BETTER TOMORROW
            </div>
          </footer>
        )}
      </div>
    </>
  );
}
