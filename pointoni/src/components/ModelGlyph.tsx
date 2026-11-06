import {
  BrainCircuit,
  Flame,
  Sparkles,
  Atom,
  Gem,
  Layers,
  Image as ImageIcon,
  Bot,
  Star,
  TrendingUp,
  BarChart3,
  Users,
  Globe,
  ShieldCheck,
  Network,
  Code2,
  Scale,
  type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  brain: BrainCircuit,
  flame: Flame,
  sparkles: Sparkles,
  atom: Atom,
  gem: Gem,
  layers: Layers,
  image: ImageIcon,
  star: Star,
  trending: TrendingUp,
  bars: BarChart3,
  users: Users,
  globe: Globe,
  shield: ShieldCheck,
  network: Network,
  code: Code2,
  scale: Scale,
};

export function ModelGlyph({
  name,
  className = "h-5 w-5",
  strokeWidth = 2,
}: {
  name: string;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = MAP[name] ?? Bot;
  return <Icon className={className} strokeWidth={strokeWidth} />;
}
