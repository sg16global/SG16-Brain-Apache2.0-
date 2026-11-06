"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Panel, PanelTitle } from "@/components/ui/Panel";
import { Flag } from "@/components/chrome/Flags";
import { LiveClock } from "@/components/chrome/LiveClock";
import { GLOBAL_NODES } from "@/lib/content";

export function GlobalPresence() {
  const trackRef = useRef<HTMLDivElement>(null);

  function scroll(dir: 1 | -1) {
    trackRef.current?.scrollBy({ left: dir * 260, behavior: "smooth" });
  }

  return (
    <Panel className="mx-auto max-w-[1200px] px-2 py-4 sm:px-5">
      <PanelTitle>GLOBAL PRESENCE</PanelTitle>
      <p className="mt-1 text-center font-mono2 text-[9px] tracking-[0.3em] text-slate-400 sm:text-[10px]">
        UNITED MINDS · FOR A BETTER TOMORROW
      </p>

      <div className="relative mt-3 flex items-center">
        <button
          aria-label="Scroll countries left"
          onClick={() => scroll(-1)}
          className="z-10 mr-1 grid h-9 w-9 flex-none place-items-center rounded-full border border-red-400/50 bg-black/70 text-red-400 transition hover:bg-red-500/25 hover:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div
          ref={trackRef}
          className="no-scrollbar flex flex-1 items-start gap-7 overflow-x-auto scroll-smooth px-2 py-2 sm:gap-10"
        >
          {GLOBAL_NODES.map((n) => (
            <div key={n.code} className="flex flex-none flex-col items-center">
              <LiveClock node={n} />
            </div>
          ))}
        </div>

        <button
          aria-label="Scroll countries right"
          onClick={() => scroll(1)}
          className="z-10 ml-1 grid h-9 w-9 flex-none place-items-center rounded-full border border-red-400/50 bg-black/70 text-red-400 transition hover:bg-red-500/25 hover:text-white"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <p className="text-center font-mono2 text-[9px] tracking-[0.24em] text-amber-200/80 sm:text-[10px]">
        DIFFERENT NATIONS <span className="text-amber-400">★</span> SAME VISION{" "}
        <span className="text-amber-400">★</span> A BRIGHTER HUMAN FUTURE
      </p>
    </Panel>
  );
}
