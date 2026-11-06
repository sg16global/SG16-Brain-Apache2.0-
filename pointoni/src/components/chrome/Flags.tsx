// Accurate simplified national flags as inline SVG (3:2).
import type { ReactElement, ReactNode } from "react";

export function Flag({ code, className = "w-12 h-8" }: { code: string; className?: string }) {
  const map: Record<string, () => ReactElement> = {
    usa: UsaFlag,
    uk: UkFlag,
    france: FranceFlag,
    russia: RussiaFlag,
    china: ChinaFlag,
    germany: GermanyFlag,
  };
  const Cmp = map[code] ?? UsaFlag;
  return (
    <span className={`relative inline-block overflow-hidden rounded-[3px] ring-1 ring-white/25 shadow-[0_0_10px_rgba(255,40,50,.25)] ${className}`}>
      <Cmp />
    </span>
  );
}

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 60 40" className="block h-full w-full" preserveAspectRatio="none">
    {children}
  </svg>
);

function UsaFlag() {
  const stripes = Array.from({ length: 13 });
  return (
    <Svg>
      {stripes.map((_, i) => (
        <rect key={i} x="0" y={i * (40 / 13)} width="60" height={40 / 13 + 0.4} fill={i % 2 ? "#fff" : "#b22234"} />
      ))}
      <rect x="0" y="0" width="26" height={40 * (7 / 13)} fill="#3c3b6e" />
      {Array.from({ length: 5 }).map((_, r) =>
        Array.from({ length: 5 }).map((_, c) => (
          <circle key={`${r}-${c}`} cx={2.6 + c * 4.9 + (r % 2 ? 2.4 : 0)} cy={2.6 + r * 4.4} r="0.9" fill="#fff" />
        )),
      )}
    </Svg>
  );
}

function UkFlag() {
  return (
    <Svg>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" strokeWidth="8" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#c8102e" strokeWidth="3.4" />
      <path d="M30,0 V40 M0,20 H60" stroke="#fff" strokeWidth="13" />
      <path d="M30,0 V40 M0,20 H60" stroke="#c8102e" strokeWidth="7.6" />
    </Svg>
  );
}

function FranceFlag() {
  return (
    <Svg>
      <rect width="20" height="40" fill="#0055a4" />
      <rect x="20" width="20" height="40" fill="#ffffff" />
      <rect x="40" width="20" height="40" fill="#ef4135" />
    </Svg>
  );
}

function RussiaFlag() {
  return (
    <Svg>
      <rect width="60" height="13.33" fill="#ffffff" />
      <rect y="13.33" width="60" height="13.34" fill="#0039a6" />
      <rect y="26.67" width="60" height="13.33" fill="#d52b1e" />
    </Svg>
  );
}

function ChinaFlag() {
  return (
    <Svg>
      <rect width="60" height="40" fill="#de2910" />
      <polygon points="10,8 11.8,13.4 17.6,13.4 12.9,16.8 14.7,22.2 10,18.9 5.3,22.2 7.1,16.8 2.4,13.4 8.2,13.4" fill="#ffde00" />
      <polygon points="20,4 20.9,6.6 23.6,6.6 21.4,8.3 22.2,11 20,9.4 17.8,11 18.6,8.3 16.4,6.6 19.1,6.6" fill="#ffde00" />
      <polygon points="24,10 24.9,12.6 27.6,12.6 25.4,14.3 26.2,17 24,15.4 21.8,17 22.6,14.3 20.4,12.6 23.1,12.6" fill="#ffde00" />
      <polygon points="24,18 24.9,20.6 27.6,20.6 25.4,22.3 26.2,25 24,23.4 21.8,25 22.6,22.3 20.4,20.6 23.1,20.6" fill="#ffde00" />
      <polygon points="20,24 20.9,26.6 23.6,26.6 21.4,28.3 22.2,31 20,29.4 17.8,31 18.6,28.3 16.4,26.6 19.1,26.6" fill="#ffde00" />
    </Svg>
  );
}

function GermanyFlag() {
  return (
    <Svg>
      <rect width="60" height="13.33" fill="#000000" />
      <rect y="13.33" width="60" height="13.34" fill="#dd0000" />
      <rect y="26.67" width="60" height="13.33" fill="#ffce00" />
    </Svg>
  );
}
