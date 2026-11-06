import { CheckCircle2 } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { RESPONSIBLE_CHECKLIST } from "@/lib/content";
import { FallbackImg } from "./FallbackImg";

export function ResponsibleAi() {
  return (
    <Panel className="mx-auto max-w-[1200px] overflow-hidden border-emerald-500/30 shadow-[0_0_26px_rgba(34,224,140,.1),inset_0_0_30px_rgba(34,224,140,.04)]">
      <div className="grid md:grid-cols-[190px_1fr_290px]">
        {/* shield — restored in 5d9ac32 */}
        <div className="relative hidden min-h-[220px] items-center justify-center overflow-hidden bg-[#08120f] md:flex">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/30 via-transparent to-cyan-900/20" />
          <FallbackImg
            src="/images/shield.png"
            alt="Shield protecting united people — responsible AI"
            className="relative h-48 w-48 object-contain"
            style={{ mixBlendMode: "screen", filter: "drop-shadow(0 0 22px rgba(34,224,140,.55))" }}
            loading="lazy"
          />
        </div>

        {/* message */}
        <div className="border-b border-emerald-500/20 p-5 sm:p-7 md:border-b-0 md:border-r">
          <h2
            className="font-display text-lg font-black tracking-wide text-amber-300 sm:text-xl"
            style={{ textShadow: "0 0 14px rgba(255,209,102,.35)" }}
          >
            A MESSAGE TO EVERY AI USER
          </h2>
          <p className="mt-1 font-display text-[10px] font-bold tracking-[0.16em] text-cyan-300 sm:text-[11px]">
            USE AI WISELY. BUILD A BETTER TOMORROW.
          </p>
          <div className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-slate-300">
            <p>
              AI has intelligence, but that intelligence is not an independent authority. It operates
              through guidance — created, trained, configured, and directed by humans. The quality and
              direction of an AI interaction depend greatly on the instructions, content, and context
              provided by its user.
            </p>
            <p
              className="font-display text-[13px] font-black tracking-wide text-emerald-300"
              style={{ textShadow: "0 0 12px rgba(34,224,140,.4)" }}
            >
              Use AI with respect, clarity, responsibility, and purpose.
            </p>
          </div>
        </div>

        {/* checklist */}
        <div className="bg-emerald-500/[0.04] p-4">
          <ul className="space-y-2.5">
            {RESPONSIBLE_CHECKLIST.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <CheckCircle2
                  className="mt-0.5 h-[18px] w-[18px] flex-none text-emerald-400"
                  strokeWidth={2.2}
                  style={{ filter: "drop-shadow(0 0 6px rgba(34,224,140,.7))" }}
                />
                <span className="text-[12.5px] font-medium leading-snug text-emerald-100/90">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
