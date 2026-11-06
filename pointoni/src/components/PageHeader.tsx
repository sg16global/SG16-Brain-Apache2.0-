import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden border-b border-red-500/25 bg-gradient-to-b from-red-950/40 to-transparent px-4 py-10 sm:px-8">
      <div className="relative z-10 mx-auto flex max-w-[1100px] flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-black tracking-[0.12em] text-white sm:text-3xl" style={{ textShadow: "0 0 22px rgba(255,31,46,.45)" }}>
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 max-w-2xl font-mono2 text-[11px] leading-relaxed tracking-wider text-slate-400 sm:text-[12px]">
              {subtitle}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
