import Link from "next/link";
import { SiteChrome } from "@/components/chrome/SiteChrome";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui/Panel";

const PILLARS = [
  {
    title: "OPEN KNOWLEDGE",
    body: "Intelligence should be available to every nation, institution and developer — auditable, explainable and released under Apache 2.0, not locked behind opaque dependencies.",
  },
  {
    title: "GLOBAL PRESENCE PRESENTATION",
    body: "The interface shows timezone labels for the USA, UK, France, Russia, China and Germany. These clocks are presentation only and do not claim six active operational facilities.",
  },
  {
    title: "FOCUSED TOOLING",
    body: "This build focuses on a configured assistant gateway, account storage and operational tooling. Broader healthcare, education, research or governance deployments are not implemented here.",
  },
  {
    title: "A SMARTER WORLD",
    body: "AI directed by humans with respect, clarity, responsibility and purpose: one mind, one planet, one sovereign brain working for a brighter tomorrow.",
  },
];

export default function VisionPage() {
  return (
    <SiteChrome>
      <PageHeader
        title="OUR VISION"
        subtitle="Different nations, one vision — a brighter human future built on open, sovereign intelligence."
      />
      <div className="mx-auto max-w-[900px] space-y-4 px-4 py-10">
        <Panel className="corner p-7 text-center">
          <h2 className="font-display text-xl font-black tracking-wide text-cyan-300 sm:text-2xl" style={{ textShadow: "0 0 18px rgba(57,215,255,.4)" }}>
            OWNERSHIP, NOT DEPENDENCY
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-[14px] leading-relaxed text-slate-300">
            The Sovereign SG16 Brain runs on its own server, under its operator&apos;s control. Nothing you
            write is passed on to another company&apos;s AI, and nothing about you is kept: your history and
            files stay on your own device.
          </p>
        </Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          {PILLARS.map((p, i) => (
            <Panel key={p.title} soft className="p-6" >
              <span className="font-display text-[11px] font-black tracking-[0.3em] text-red-400">0{i + 1}</span>
              <h3 className="mt-1 font-display text-base font-black tracking-widest text-white">{p.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-300">{p.body}</p>
            </Panel>
          ))}
        </div>
        <Panel className="corner flex flex-col items-center gap-3 p-8 text-center">
          <p className="font-display text-lg font-black tracking-[0.15em] text-gold-gradient">
            KNOWLEDGE · DIPLOMACY · A BETTER TOMORROW
          </p>
          <Link href="/chat" className="btn-red px-6 py-2.5 text-[11px]">JOIN THE DEVELOPER PILOT</Link>
        </Panel>
      </div>
    </SiteChrome>
  );
}
