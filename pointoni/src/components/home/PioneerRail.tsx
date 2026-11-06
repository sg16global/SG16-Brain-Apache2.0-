"use client";

import { useEffect, useRef, useState } from "react";
import { PIONEERS, type Pioneer } from "@/lib/pioneers";
import { Panel, PanelTitle } from "@/components/ui/Panel";

// A railway of historical pioneers travelling right -> left. One lightweight animation loop moves a single
// track by transform (no layout work), loops by exactly one set width so there is never a jump or a gap,
// and scales the card nearest the centre. It pauses off-screen, in hidden tabs, and for reduced motion.
const SPEED = 38; // px per second
const COPIES = 3;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
}

function Card({ p }: { p: Pioneer }) {
  return (
    <li className="pioneer-card" data-card aria-label={`${p.name}, ${p.role}`}>
      <div className="pioneer-photo">
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt={p.name} width={180} height={180} draggable={false} />
        ) : (
          <span aria-hidden className="pioneer-silhouette">
            <svg viewBox="0 0 100 100" className="h-full w-full">
              <circle cx="50" cy="38" r="17" fill="currentColor" />
              <path d="M16 100c0-22 15-36 34-36s34 14 34 36z" fill="currentColor" />
            </svg>
            <span className="pioneer-initials">{initials(p.name)}</span>
          </span>
        )}
      </div>
      <p className="pioneer-name">{p.name}</p>
      <p className="pioneer-role">{p.role}</p>
    </li>
  );
}

export function PioneerRail() {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const vp = viewport.current;
    const tr = track.current;
    if (!vp || !tr) return;
    const cards = Array.from(tr.querySelectorAll<HTMLElement>("[data-card]"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stride = 0;
    let setWidth = 0;
    let half = 0;
    let offset = 0;
    let last = 0;
    let raf = 0;
    let visible = true;
    let shown = -1;

    const measure = () => {
      stride = cards[1].offsetLeft - cards[0].offsetLeft;
      setWidth = stride * PIONEERS.length;
      half = vp.clientWidth / 2;
    };

    const paint = () => {
      tr.style.transform = `translate3d(${-offset}px,0,0)`;
      let best = 0;
      let bestI = 0;
      let bestK = -1;
      for (let i = 0; i < cards.length; i++) {
        const center = i * stride + stride / 2 - offset;
        const signed = (center - half) / (half * 0.9);
        const d = Math.min(1, Math.abs(signed));
        const k = 1 - d * d; // 1 at the centre, 0 near the edges
        // the rail bends like a shallow arc: side cards sit lower and turn slightly towards the centre
        const lift = d * d * 22;
        const turn = Math.max(-1, Math.min(1, signed)) * -16;
        cards[i].style.transform = `translateY(${lift.toFixed(1)}px) rotateY(${turn.toFixed(1)}deg) scale(${(0.8 + 0.3 * k).toFixed(3)})`;
        cards[i].style.opacity = (0.45 + 0.55 * k).toFixed(3);
        cards[i].style.zIndex = String(Math.round(k * 10));
        cards[i].dataset.center = "0";
        if (k > bestK) {
          bestK = k;
          bestI = i;
          best = i % PIONEERS.length;
        }
      }
      cards[bestI].dataset.center = "1"; // exactly one highlighted pioneer at a time
      if (best !== shown) {
        shown = best;
        setActive(best);
      }
    };

    const frame = (t: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
      last = t;
      offset = (offset + SPEED * dt) % setWidth;
      paint();
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (reduce || raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    measure();
    paint();
    start();

    const ro = new ResizeObserver(() => {
      measure();
      paint();
    });
    ro.observe(vp);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
    });
    io.observe(vp);
    const onVis = () => {
      if (!document.hidden) start();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const credited = PIONEERS.filter((p) => p.credit);

  return (
    <Panel className="mx-auto w-full max-w-[1200px] overflow-hidden px-2 py-5 sm:px-5" id="pioneers">
      <div className="flex items-center justify-center gap-3 sm:gap-5">
        <span aria-hidden className="pioneer-rule" />
        <PanelTitle accent="cyan" className="!px-0">
          AI PIONEERS
        </PanelTitle>
        <span aria-hidden className="pioneer-rule" />
      </div>
      <p className="mt-1 text-center font-mono2 text-[10px] tracking-[0.42em] text-slate-300 sm:text-[11px]">
        INTELLIGENCE HERITAGE
      </p>

      <div ref={viewport} className="pioneer-viewport mt-4" role="region" aria-label="AI pioneers, moving slowly">
        <ul ref={track} className="pioneer-track">
          {Array.from({ length: COPIES }).flatMap((_, c) =>
            PIONEERS.map((p) => <Card key={`${c}-${p.id}`} p={p} />),
          )}
        </ul>
      </div>

      <div aria-hidden className="pioneer-dots">
        {PIONEERS.map((p, i) => (
          <span key={p.id} data-on={i === active ? "1" : "0"} />
        ))}
      </div>
      <p className="mt-4 text-center font-mono2 text-[10px] tracking-[0.4em] text-slate-300 sm:text-[11px]">
        GREAT MINDS <span className="mx-1 text-amber-300">×</span> TIMELESS IMPACT
      </p>
      <p className="mt-2 text-center font-mono2 text-[9px] tracking-[0.2em] text-slate-500">
        HISTORICAL PROFILES · NOT AI MODELS · NOT CONNECTED TO THIS SYSTEM
      </p>
      <details className="mx-auto mt-2 max-w-[760px] text-center">
        <summary className="cursor-pointer font-mono2 text-[9px] tracking-[0.2em] text-slate-500 hover:text-slate-300">
          PORTRAIT CREDITS
        </summary>
        <ul className="mt-2 space-y-0.5 text-[10px] leading-snug text-slate-400">
          {credited.map((p) => (
            <li key={p.id}>
              {p.name} — {p.credit!.author},{" "}
              {p.credit!.source ? (
                <a href={p.credit!.source} target="_blank" rel="noreferrer" className="underline decoration-slate-600 hover:text-white">
                  {p.credit!.license}
                </a>
              ) : (
                p.credit!.license
              )}
            </li>
          ))}
        </ul>
      </details>
    </Panel>
  );
}
