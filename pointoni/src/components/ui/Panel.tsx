import type { ReactNode } from "react";

export function Panel({
  children,
  className = "",
  corners = true,
  soft = false,
  id,
}: {
  children: ReactNode;
  className?: string;
  corners?: boolean;
  soft?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`panel ${soft ? "panel-soft" : ""} ${corners ? "corner" : ""} ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelTitle({
  children,
  accent = "gold",
  className = "",
}: {
  children: ReactNode;
  accent?: "gold" | "cyan" | "green";
  className?: string;
}) {
  const color =
    accent === "cyan"
      ? "text-cyan-300"
      : accent === "green"
        ? "text-emerald-300"
        : "text-gold-gradient";
  return (
    <h2
      className={`panel-title text-center text-base sm:text-lg md:text-xl ${color} ${className}`}
      style={accent === "gold" ? {} : { textShadow: "0 0 14px rgba(57,215,255,.35)" }}
    >
      {children}
    </h2>
  );
}

export function StatusPill({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  const map: Record<string, { color: string; text: string }> = {
    online: { color: "#22e08c", text: "ONLINE" },
    connected: { color: "#39d7ff", text: "CONNECTED" },
    standby: { color: "#ffb020", text: "STANDBY" },
    degraded: { color: "#ff8a3d", text: "DEGRADED" },
    offline: { color: "#ff3b4c", text: "OFFLINE" },
    open: { color: "#ffd166", text: "OPEN" },
  };
  const meta = map[status] ?? { color: "#8aa0bd", text: status.toUpperCase() };
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-widest" style={{ color: meta.color }}>
      <span className="status-dot" style={{ background: meta.color, color: meta.color }} />
      {label ?? meta.text}
    </span>
  );
}
