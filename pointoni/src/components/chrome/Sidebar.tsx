"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Crown, LogIn, Pin, PinOff, Power } from "lucide-react";
import { announceIdentityChange, useAdmin, useSignedIn } from "@/lib/use-session";
import { SIDEBAR_LINKS } from "./nav-items";
import { GLOBAL_NODES } from "@/lib/content";
import { LiveClock } from "./LiveClock";

// Device-only keys. Nothing about the panel preference ever leaves the
// browser (charter §10 — no hidden dossiers, no server-side preference).
const SEEN_KEY = "sg16:panel:seen";
const PIN_KEY = "sg16:panel:pinned";
const PIN_EVENT = "sg16:panel:pin";
const PEEK_MS = 3800;
const IDLE_AFTER_MS = 45_000;

// The pin lives in localStorage — an external store — so it is read through
// a subscription rather than copied into state by an effect. That keeps the
// server render and the first client render identical (no hydration flip).
function subscribePin(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(PIN_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(PIN_EVENT, callback);
  };
}

function readPin(): boolean {
  try {
    return window.localStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false;
  }
}

// SSR / hydration snapshot: unpinned, exactly what a panel nobody has pinned
// should look like before the device gets a say.
function readPinOnServer(): boolean {
  return false;
}

function SidebarBody({
  onNavigate,
  pinned,
  onTogglePin,
}: {
  onNavigate?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const signedIn = useSignedIn();
  const isAdmin = useAdmin() === true;

  // Sign out = forget the sign-in token on this device. (There is no server session or cookie to end.)
  function signOut() {
    try {
      window.localStorage.removeItem("sg16/identity");
    } catch {
      // browser storage may be unavailable
    }
    announceIdentityChange();
    router.push("/");
    onNavigate?.();
  }

  return (
    <div className="flex h-full flex-col bg-[#070a10]/95">
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {onTogglePin && (
          <button
            onClick={onTogglePin}
            aria-pressed={pinned}
            className={`mb-2 flex w-full items-center justify-between rounded-lg border px-3 py-1.5 font-mono2 text-[9px] font-bold tracking-[0.22em] transition-all ${
              pinned
                ? "border-amber-300/50 bg-amber-400/10 text-amber-300"
                : "border-white/10 text-slate-400 hover:border-red-400/40 hover:text-red-200"
            }`}
          >
            <span>{pinned ? "PANEL PINNED" : "AUTO-PANEL"}</span>
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
        )}

        <ul className="space-y-1">
          {SIDEBAR_LINKS.filter((item) => item.href !== "/admin" || isAdmin).map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className={`group flex items-center gap-3 rounded-lg border px-3 py-2 font-display text-[12px] font-bold tracking-wider transition-all ${
                    active
                      ? "border-red-400/60 bg-gradient-to-r from-red-600/30 to-transparent text-white shadow-[0_0_16px_rgba(255,31,46,.35)]"
                      : "border-transparent text-slate-300 hover:border-red-400/30 hover:bg-red-500/10 hover:text-white"
                  }`}
                >
                  <Icon className={`h-[18px] w-[18px] flex-none ${active ? "text-red-400" : "text-slate-400 group-hover:text-red-300"}`} strokeWidth={2} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {signedIn ? (
          <button
            onClick={signOut}
            className="mt-2 flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2 font-display text-[12px] font-bold tracking-wider text-red-500 transition-all hover:border-red-400/40 hover:bg-red-500/15 hover:text-red-300"
          >
            <Power className="h-[18px] w-[18px] flex-none" strokeWidth={2.2} />
            Sign Out
          </button>
        ) : (
          <Link
            href="/login"
            onClick={onNavigate}
            className="mt-2 flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2 font-display text-[12px] font-bold tracking-wider text-emerald-400 transition-all hover:border-emerald-400/40 hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            <LogIn className="h-[18px] w-[18px] flex-none" strokeWidth={2.2} />
            Sign In
          </Link>
        )}

        <div className="my-4 hairline" />

        {/* mini globe */}
        <div className="mb-3 flex justify-center">
          <div className="relative h-28 w-28">
            <div className="absolute inset-0 rounded-full border border-cyan-400/30 spin-slow" style={{ borderTopColor: "rgba(57,215,255,.8)" }} />
            <div className="absolute inset-1.5 rounded-full border border-cyan-400/20 spin-rev" style={{ borderBottomColor: "rgba(255,90,60,.7)" }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/globe.png"
              alt="Global network"
              className="absolute inset-2 h-[calc(100%-16px)] w-[calc(100%-16px)] rounded-full object-cover"
              style={{ mixBlendMode: "screen", filter: "drop-shadow(0 0 14px rgba(57,150,255,.5))" }}
            />
          </div>
        </div>

        {/* live global clocks */}
        <div className="space-y-1.5">
          {GLOBAL_NODES.map((n) => (
            <LiveClock key={n.code} node={n} compact />
          ))}
        </div>
      </nav>

      <div className="border-t border-red-500/25 p-3">
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4 flex-none text-amber-300" fill="#f5c44c" />
          <span className="font-display text-[10px] font-black tracking-widest text-white">
            SOVEREIGN <span className="text-red-500">SG16</span> BRAIN
          </span>
        </div>
        <p className="mt-1.5 font-mono2 text-[8px] leading-relaxed tracking-wider text-slate-400">
          SG16-POWERED AI
          <br />
          GLOBAL INTELLIGENCE NETWORK
          <br />
          BUILT FOR A BRIGHTER FUTURE.
          <br />
          ONE MIND, ONE PLANET.
          <br />
          ONE SOVEREIGN BRAIN.
        </p>
      </div>
    </div>
  );
}

export function Sidebar() {
  // AUTO-PANEL sovereign side panel. Three behaviours, one component:
  //
  //   1. hover / keyboard focus slides it out (as before — the page keeps the
  //      full viewport width at all times);
  //   2. FIRST visit: it presents itself once, unprompted, then retracts —
  //      a visitor should never have to discover the 14px grab strip;
  //   3. PIN: when the pilot pins it, it stays open across pages; the choice
  //      lives in this device's localStorage and nowhere else.
  //
  // Everything is presentation: the panel carries no data, makes no request,
  // and reveals nothing about the person who pinned it.
  const pinned = useSyncExternalStore(subscribePin, readPin, readPinOnServer);
  const [peeking, setPeeking] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const peek = useCallback((ms: number) => {
    setPeeking(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setPeeking(false), ms);
  }, []);

  // greet a first-time visitor ONCE. The peek is scheduled rather than applied
  // synchronously, so it lands as its own render instead of cascading into the
  // one that mounted the panel.
  useEffect(() => {
    let first: ReturnType<typeof setTimeout> | null = null;
    let seen = true;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // private mode / storage disabled — the panel simply stays manual
    }
    if (!readPin() && !seen) {
      first = setTimeout(() => peek(PEEK_MS), 700);
      try {
        window.localStorage.setItem(SEEN_KEY, "1");
      } catch {
        // nothing to remember, nothing to leak
      }
    }
    return () => {
      if (first) clearTimeout(first);
    };
  }, [peek]);

  // idle re-peek: if the pilot goes quiet for a while, the panel shows itself
  // again briefly — never on top of a pinned state, never while typing.
  useEffect(() => {
    if (pinned) return;
    let idle: ReturnType<typeof setTimeout> | null = null;

    const arm = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => peek(PEEK_MS), IDLE_AFTER_MS);
    };
    const onActivity = () => arm();

    arm();
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("scroll", onActivity, { passive: true });
    return () => {
      if (idle) clearTimeout(idle);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("scroll", onActivity);
    };
  }, [pinned, peek]);

  const togglePin = useCallback(() => {
    const next = !readPin();
    try {
      window.localStorage.setItem(PIN_KEY, next ? "1" : "0");
    } catch {
      // storage unavailable — the pin still works through the event below
    }
    // notify this tab's subscription (other tabs hear the `storage` event)
    window.dispatchEvent(new Event(PIN_EVENT));
    setPeeking(false);
  }, []);

  const open = pinned || peeking;

  return (
    <aside
      id="sovereign-side-panel"
      aria-label="Sovereign side panel (auto-hide)"
      className={`group fixed bottom-0 left-0 top-[58px] z-40 hidden w-[224px] border-r border-red-500/40 shadow-[6px_0_34px_rgba(255,31,46,.35)] transition-transform duration-300 ease-out hover:translate-x-0 focus-within:translate-x-0 xl:block ${
        open ? "translate-x-0" : "-translate-x-[calc(100%-14px)]"
      }`}
    >
      <SidebarBody pinned={pinned} onTogglePin={togglePin} />
      {/* collapsed grab strip — the 14px still visible at the left edge */}
      <span
        aria-hidden
        className={`absolute inset-y-0 right-0 w-[14px] border-l border-red-500/40 bg-gradient-to-b from-[#180509] via-[#0a0306] to-[#180509] transition-opacity duration-200 group-hover:opacity-0 group-focus-within:opacity-0 ${
          open ? "opacity-0" : "opacity-100"
        }`}
      >
        <span className="absolute inset-x-0 top-1/2 h-16 -translate-y-1/2 rounded-full bg-red-500/60 blur-[2px] pulse-soft" />
        <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center font-mono2 text-[8px] font-bold tracking-[0.32em] text-red-300 [writing-mode:vertical-rl]">
          PANEL ▸
        </span>
      </span>
    </aside>
  );
}

export function SidebarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div className={`fixed inset-0 z-[60] xl:hidden ${open ? "" : "pointer-events-none"}`}>
      <div
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        className={`absolute bottom-0 left-0 top-0 w-[270px] border-r border-red-500/40 shadow-[8px_0_40px_rgba(255,31,46,.3)] transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarBody onNavigate={onClose} />
      </aside>
    </div>
  );
}
