"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Send, Globe2, CheckCircle2 } from "lucide-react";
import { SiteChrome } from "@/components/chrome/SiteChrome";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { COMPANY } from "@/lib/company";

function ContactForm() {
  const params = useSearchParams();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = params.get("subject");
    if (s) setSubject(s);
  }, [params]);

  async function submit() {
    if (!subject.trim() || !body.trim()) {
      setError("Subject and message are required.");
      return;
    }
    setError(null);
    // The message is written in YOUR mail program and sent from your own address. This site
    // receives and stores nothing.
    window.location.href = `mailto:${COMPANY.ownerEmail}?subject=${encodeURIComponent(subject.slice(0, 200))}&body=${encodeURIComponent(body.slice(0, 1800))}`;
    setSent(true);
  }

  return (
    <Panel className="corner p-6 sm:p-8">
      {sent ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <CheckCircle2 className="h-14 w-14 text-emerald-400" style={{ filter: "drop-shadow(0 0 16px rgba(34,224,140,.6))" }} />
          <h2 className="font-display text-lg font-black tracking-wide text-white">YOUR MAIL PROGRAM OPENED</h2>
          <p className="max-w-md text-[13px] text-slate-300">
            Send the message from there. This site does not receive or keep it. If nothing opened, write to {COMPANY.ownerEmail}.
          </p>
          <button onClick={() => setSent(false)} className="btn-ghost px-5 py-2 text-[11px]">SEND ANOTHER</button>
        </div>
      ) : (
        <>
          <h2 className="font-display text-sm font-black tracking-widest text-white">SEND A MESSAGE</h2>
          <div className="mt-4 space-y-3">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="input-dark h-11 w-full px-3 text-sm"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="How can the Sovereign SG16 Brain network help you?"
              rows={7}
              className="input-dark w-full resize-none p-3 text-sm"
            />
            {error && <p className="text-[12px] text-red-300">{error}</p>}
            <button onClick={submit} className="btn-red flex w-full items-center justify-center gap-2 py-3 text-[11px]">
              <Send className="h-4 w-4" /> OPEN IN MY MAIL PROGRAM
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

export default function ContactPage() {
  return (
    <SiteChrome>
      <PageHeader title="CONTACT" subtitle="Contact and ticket intake for this deployment. Response time depends on operator staffing; no multi-region desk is guaranteed by this build." />
      <div className="mx-auto grid max-w-[1000px] gap-5 px-4 py-10 lg:grid-cols-[1fr_300px]">
        <Suspense fallback={<Panel className="p-10 text-center text-sm text-slate-500">Loading…</Panel>}>
          <ContactForm />
        </Suspense>
        <div className="space-y-4">
          <Panel soft className="p-6">
            <Globe2 className="h-7 w-7 text-cyan-300" />
            <h3 className="mt-3 font-display text-[13px] font-black tracking-widest text-white">GLOBAL NODES</h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-slate-300">
              USA · UK · France · Russia · China · Germany. Every node carries the same sovereign stack
              under local jurisdiction.
            </p>
          </Panel>
          <Panel soft className="p-6">
            <h3 className="font-display text-[13px] font-black tracking-widest text-white">ENGINEERING DESK</h3>
            <p className="mt-2 font-mono2 text-[11px] leading-relaxed text-cyan-200/90">
              domain: mistralbrain.com
              <br />
              license: Apache 2.0
              <br />
              engine: configured SG16 gateway path
            </p>
          </Panel>
        </div>
      </div>
    </SiteChrome>
  );
}
