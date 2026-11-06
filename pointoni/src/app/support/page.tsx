"use client";

import { useState } from "react";
import { ChevronDown, LifeBuoy, Send } from "lucide-react";
import { SiteChrome } from "@/components/chrome/SiteChrome";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { FAQS } from "@/lib/content";
import { COMPANY } from "@/lib/company";

export default function SupportPage() {
  const [openFaq, setOpenFaq] = useState<number>(0);

  return (
    <SiteChrome>
      <PageHeader title="HELP & SUPPORT" subtitle="Answers to common questions. To reach the operator, write by email: nothing you send is stored on this site." />
      <div className="mx-auto grid max-w-[1000px] gap-5 px-4 py-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <h2 className="font-display text-sm font-black tracking-widest text-gold-gradient">FREQUENTLY ASKED</h2>
          {FAQS.map((f, i) => (
            <Panel key={f.q} soft corners={false}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
              >
                <span className="text-[13.5px] font-bold text-slate-100">{f.q}</span>
                <ChevronDown className={`h-4 w-4 flex-none text-red-400 transition-transform ${openFaq === i ? "rotate-180" : ""}`} />
              </button>
              {openFaq === i && (
                <p className="border-t border-white/10 px-4 py-3 text-[12.5px] leading-relaxed text-slate-300">{f.a}</p>
              )}
            </Panel>
          ))}

        </div>

        <Panel className="corner h-fit p-5">
          <h2 className="flex items-center gap-2 font-display text-sm font-black tracking-widest text-white">
            <LifeBuoy className="h-5 w-5 text-red-400" /> NEED A PERSON?
          </h2>
          <p className="mt-3 text-[12.5px] leading-relaxed text-slate-300">
            There are no accounts or ticket systems here. Write to the operator and your mail program opens with the
            message ready; nothing passes through or stays on this server.
          </p>
          <a href={`mailto:${COMPANY.ownerEmail}?subject=${encodeURIComponent("SG16 Brain support")}`} className="btn-red mt-4 flex w-full items-center justify-center gap-2 py-2.5 text-[11px]">
            <Send className="h-4 w-4" /> EMAIL THE OPERATOR
          </a>
        </Panel>
      </div>
    </SiteChrome>
  );
}
