// ===================================================================
// SG16 FOOTER RAIL — the sovereign tape that runs under every page.
//
// One continuous rail carrying the doctrine that must never be buried in a
// legal paragraph: account-storage honesty, one brain and
// the frozen corporate footprint. It is the same "one mind, one planet"
// statement the footer already makes, but it moves — so the visitor reads it
// without being asked to.
//
// Presentation only: no state, no fetch, no analytics. The rail pauses on
// hover and stops entirely under `prefers-reduced-motion`.
// ===================================================================

import { COMPANY } from "@/lib/company";

const RAIL_ITEMS: readonly string[] = [
  "NO USER DATA STORED · SG16 POWERED · mistralbrain.com",
  "ONE MIND · ONE PLANET · ONE SOVEREIGN BRAIN",
  "APACHE 2.0 · OPEN INTELLIGENCE · NO VENDOR LOCK-IN",
  "YOUR HISTORY AND FILES STAY ON YOUR DEVICE · NOTHING ABOUT YOU IS STORED HERE",
  COMPANY.legalLine,
];

export function FooterRail() {
  // Rendered twice so the keyframe can translate a clean -50% for a seamless
  // loop; `aria-hidden` on the duplicate keeps screen readers at one copy.
  const items = [...RAIL_ITEMS, ...RAIL_ITEMS];

  return (
    <div
      className="footer-rail relative overflow-hidden border-t border-red-500/15 bg-[#04060a]/80"
      role="marquee"
      aria-label="Sovereign doctrine rail"
    >
      <div className="footer-rail-track footer-rail-track--slow flex w-max items-center py-2">
        {items.map((item, i) => (
          <span
            key={`${i}-${item.slice(0, 12)}`}
            aria-hidden={i >= RAIL_ITEMS.length}
            className="flex flex-none items-center font-mono2 text-[9px] tracking-[0.28em] text-slate-500"
          >
            <span className="whitespace-nowrap uppercase">{item}</span>
            <span className="mx-6 text-red-500/70">◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}
