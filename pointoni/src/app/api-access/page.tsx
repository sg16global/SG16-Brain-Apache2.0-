"use client";

import { useState } from "react";
import { Copy, KeyRound, ShieldCheck, Terminal } from "lucide-react";
import Link from "next/link";
import { SiteChrome } from "@/components/chrome/SiteChrome";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui/Panel";

// API access without accounts: the public endpoint works for anyone within the fair-use limits;
// the operator's own projects use signed project keys that are created in the admin console and
// never stored. There is nothing to sign up for here, and nothing about callers is kept.

export default function ApiAccessPage() {
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "https://mistralbrain.com" : window.location.origin;
  const curl = `curl -X POST ${origin}/api/brain \\
  -H "Content-Type: application/json" \\
  -d '{"message":"Hello SG16"}'`;

  return (
    <SiteChrome>
      <PageHeader
        title="API ACCESS"
        subtitle="Call the Brain from your own code. No sign-up, and nothing about callers is stored."
      />
      <div className="mx-auto max-w-[900px] space-y-5 px-4 py-8">
        <Panel className="p-5">
          <h2 className="flex items-center gap-2 font-display text-[13px] font-black tracking-widest text-white">
            <Terminal className="h-4 w-4 text-cyan-300" /> PUBLIC ENDPOINT
          </h2>
          <p className="mt-2 text-[12.5px] leading-relaxed text-slate-300">
            <code className="font-mono2">POST /api/brain</code> with a JSON body <code className="font-mono2">{"{ \"message\": \"...\" }"}</code>.
            Free use is rate-limited per visitor. A subscription pass lifts the limits for the device that holds it:
            send it in the <code className="font-mono2">X-SG16-Pass</code> header.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-cyan-500/25 bg-black/60 p-3 font-mono2 text-[11px] text-cyan-100">{curl}</pre>
          <button
            onClick={() => navigator.clipboard?.writeText(curl).then(() => setCopied(true))}
            className="btn-ghost mt-2 inline-flex items-center gap-2 px-3 py-1.5 text-[10px]"
          >
            <Copy className="h-3.5 w-3.5" /> {copied ? "COPIED" : "COPY"}
          </button>
        </Panel>

        <Panel className="p-5">
          <h2 className="flex items-center gap-2 font-display text-[13px] font-black tracking-widest text-white">
            <KeyRound className="h-4 w-4 text-amber-300" /> PROJECT KEYS
          </h2>
          <p className="mt-2 text-[12.5px] leading-relaxed text-slate-300">
            Projects run by the operator connect with a project key: free, no limits per visitor, no subscription. Keys are
            created in the <Link href="/admin" className="underline">admin console</Link> (operator sign-in) and are shown
            once. The server stores no key list; it only checks each key&apos;s signature, so keys keep working across
            restarts. Send the key as <code className="font-mono2">Authorization: Bearer &lt;key&gt;</code>.
          </p>
        </Panel>

        <Panel soft corners={false} className="flex items-start gap-2 p-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-300" />
          <p className="text-[12px] leading-relaxed text-slate-400">
            Nothing is stored about you or your project here: no accounts, no logs of messages, no history on the server.
          </p>
        </Panel>
      </div>
    </SiteChrome>
  );
}
