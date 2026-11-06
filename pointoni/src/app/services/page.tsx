import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteChrome } from "@/components/chrome/SiteChrome";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ModelGlyph } from "@/components/ModelGlyph";
import { SERVICES } from "@/lib/content";

export default function ServicesPage() {
  return (
    <SiteChrome>
      <PageHeader title="SERVICES" subtitle="Deployment assistance for this reference stack. Offerings are informational; production staffing, SLAs and multi-region facilities are not guaranteed by this build." />
      <div className="mx-auto max-w-[1100px] px-4 py-10">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((s) => (
            <Panel key={s.title} soft className="group p-6 transition hover:border-red-400/60">
              <span className="grid h-12 w-12 place-items-center rounded-xl border border-red-400/40 bg-red-500/10 text-red-300 shadow-[0_0_18px_rgba(255,31,46,.2)] transition group-hover:scale-105">
                <ModelGlyph name={s.glyph} className="h-6 w-6" />
              </span>
              <h3 className="mt-4 font-display text-[14px] font-black tracking-widest text-white">{s.title}</h3>
              <p className="mt-2 text-[12.5px] leading-relaxed text-slate-300">{s.body}</p>
            </Panel>
          ))}
        </div>
        <Panel className="corner mt-8 flex flex-col items-center gap-4 p-8 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            <h2 className="font-display text-lg font-black tracking-wide text-white">READY FOR SOVEREIGN INTELLIGENCE?</h2>
            <p className="mt-1 text-[13px] text-slate-400">Start free with the Developer Pilot, or request a private enterprise deployment.</p>
          </div>
          <div className="flex gap-3">
            <Link href="/chat" className="btn-red inline-flex items-center gap-2 px-5 py-2.5 text-[11px]">START FREE <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/contact" className="btn-ghost px-5 py-2.5 text-[11px]">CONTACT US</Link>
          </div>
        </Panel>
      </div>
    </SiteChrome>
  );
}
