"use client";

import { useEffect, useState } from "react";
import { Flag } from "./Flags";

type Node = {
  code: string;
  flag: string;
  tz: string;
  zone: string;
  zoneDst: string;
  gmt: string;
  gmtDst: string;
};

function getOffsetMinutes(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour === 24 ? 0 : map.hour,
    map.minute,
    map.second,
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

function gmtLabel(offset: number): string {
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

export function LiveClock({ node, compact = false }: { node: Node; compact?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(t);
  }, []);

  if (!now) {
    return (
      <ClockShell node={node} compact={compact} time="--:-- --" gmt="" zone="" />
    );
  }

  const offset = getOffsetMinutes(node.tz, now);
  const janOffset = getOffsetMinutes(node.tz, new Date(now.getFullYear(), 0, 15));
  const isDst = offset > janOffset;
  const zone = isDst ? node.zoneDst : node.zone;
  const gmt = isDst ? node.gmtDst : node.gmt;
  void gmtLabel;
  const realGmt = gmtLabel(offset);

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: node.tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  return <ClockShell node={node} compact={compact} time={time} gmt={realGmt} zone={zone} />;
}

function ClockShell({
  node,
  compact,
  time,
  gmt,
  zone,
}: {
  node: Node;
  compact: boolean;
  time: string;
  gmt: string;
  zone: string;
}) {
  if (compact) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-red-500/25 bg-black/45 px-2.5 py-2">
        <Flag code={node.flag} className="w-8 h-[22px] flex-none" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-display text-[11px] font-bold tracking-widest text-slate-100">
              {node.code}
            </span>
            <span className="flex items-center gap-1 text-[9px] font-bold tracking-widest text-emerald-400">
              <span className="status-dot !h-[5px] !w-[5px]" style={{ background: "#22e08c", color: "#22e08c" }} />
              LIVE
            </span>
          </div>
          <div className="font-mono2 text-[11px] leading-tight text-cyan-200">{time}</div>
          <div className="font-mono2 text-[9px] leading-tight text-slate-400">
            {gmt} ({zone})
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-center gap-1">
      <Flag code={node.flag} className="w-16 h-11 sm:w-20 sm:h-14 transition-transform duration-300 group-hover:scale-110" />
      <div className="flex items-center gap-1.5">
        <span className="font-display text-sm font-bold tracking-widest text-slate-100">{node.code}</span>
        <span className="text-[11px]">★★</span>
      </div>
      <span className="font-mono2 text-[10px] text-cyan-300/80 opacity-0 transition-opacity group-hover:opacity-100">
        {time} · {gmt}
      </span>
    </div>
  );
}
