"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { History as HistoryIcon, Globe2 } from "lucide-react";
import { SiteChrome } from "@/components/chrome/SiteChrome";
import { ChatPanel } from "@/components/home/ChatPanel";
import { FinancialTicker } from "@/components/home/FinancialTicker";
import { PageHeader } from "@/components/PageHeader";

// Workspace routes all chat through /api/brain (the Sovereign SG16 Brain).

function Workspace() {
  const params = useSearchParams();
  const sessionId = params.get("s");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 220);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <PageHeader
        title="SOVEREIGN WORKSPACE"
        subtitle="SG16 gateway chat. Your conversations are saved on this device only; the server keeps none of them."
      >
        <Link href="/history" className="btn-ghost inline-flex items-center gap-2 px-4 py-2 text-[11px]">
          <HistoryIcon className="h-4 w-4" /> HISTORY
        </Link>
      </PageHeader>

      <div className="mx-auto max-w-[1200px] px-3 py-6 sm:px-5">
        {!ready ? (
          <div className="panel grid h-[420px] place-items-center text-sm tracking-widest text-slate-500">
            <span className="pulse-soft">ESTABLISHING SOVEREIGN CHANNEL…</span>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <ChatPanel full initialSessionId={sessionId ?? undefined} />
              <div className="h-[520px] lg:h-auto">
                <FinancialTicker />
              </div>
            </div>
            <p className="flex items-center justify-center gap-2 text-center font-mono2 text-[9px] tracking-[0.25em] text-slate-500">
              <Globe2 className="h-3 w-3" /> SOVEREIGN SG16 BRAIN · YOUR CONVERSATIONS STAY ON YOUR DEVICE
            </p>
          </div>
        )}
      </div>
    </>
  );
}

export default function ChatPage() {
  return (
    <SiteChrome>
      <Suspense fallback={<div className="p-20 text-center text-slate-500">Loading workspace…</div>}>
        <Workspace />
      </Suspense>
    </SiteChrome>
  );
}
