import { Panel, PanelTitle } from "@/components/ui/Panel";
import { TIMELINE, AI_PATH } from "@/lib/content";
import { ArrowRight } from "lucide-react";

export function HistoryTimeline() {
  return (
    <Panel id="history" className="mx-auto max-w-[1200px] px-4 py-5 sm:px-8">
      <PanelTitle>A SHORT HISTORY OF AI</PanelTitle>
      <p className="mt-1 text-center font-mono2 text-[9px] tracking-[0.28em] text-slate-400 sm:text-[10px]">
        DECADES OF RESEARCH · INNOVATION AHEAD.
      </p>

      <div className="relative mt-7">
        <div className="no-scrollbar overflow-x-auto pb-3">
          <div className="relative mx-auto min-w-[760px] max-w-[1000px]">
            <div className="timeline-rail absolute left-[3%] right-[3%] top-[13px] h-[3px] rounded-full" />
            <div className="relative grid grid-cols-6 gap-2">
              {TIMELINE.map((t) => (
                <div key={t.year} className="flex flex-col items-center text-center">
                  <span
                    className="timeline-node grid h-7 w-7 place-items-center rounded-full border-2"
                    style={
                      {
                        background: "#06070c",
                        borderColor: t.accent,
                        ["--node-glow" as string]: `${t.accent}88`,
                      } as React.CSSProperties
                    }
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: t.accent, boxShadow: `0 0 8px ${t.accent}` }} />
                  </span>
                  <span
                    className="mt-2 font-display text-[15px] font-black tracking-wide"
                    style={{ color: t.accent, textShadow: `0 0 12px ${t.accent}66` }}
                  >
                    {t.year}
                  </span>
                  <span className="mt-1 font-display text-[10px] font-bold tracking-wide text-slate-100">
                    {t.title}
                  </span>
                  <span className="mt-1 max-w-[150px] text-[10.5px] leading-snug text-slate-400">
                    {t.body}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-3 flex max-w-[900px] flex-wrap items-center justify-center gap-x-2 gap-y-2 rounded-lg border border-emerald-400/40 bg-emerald-500/5 px-4 py-2.5 shadow-[0_0_20px_rgba(34,224,140,.12)]">
        {AI_PATH.map((step, i) => (
          <span key={step} className="flex items-center gap-2">
            <span className="font-display text-[10px] font-black tracking-[0.14em] text-emerald-300 sm:text-[12px]">
              {step.toUpperCase()}
            </span>
            {i < AI_PATH.length - 1 && (
              <ArrowRight className="h-3.5 w-3.5 text-emerald-400/80" strokeWidth={2.5} />
            )}
          </span>
        ))}
      </div>
    </Panel>
  );
}
