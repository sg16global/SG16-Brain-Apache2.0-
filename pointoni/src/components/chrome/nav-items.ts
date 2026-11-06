import {
  SquarePen,
  History,
  FolderClosed,
  Crown,
  Globe2,
  CircleHelp,
  Power,
  Shield,
  type LucideIcon,
} from "lucide-react";

export type SidebarLink = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const SIDEBAR_LINKS: SidebarLink[] = [
  { label: "New Chat", href: "/chat", icon: SquarePen },
  { label: "History", href: "/history", icon: History },
  { label: "My Files", href: "/files", icon: FolderClosed },
  { label: "Subscription", href: "/subscription", icon: Crown },
  { label: "API Access", href: "/api-access", icon: Globe2 },
  { label: "Admin Console", href: "/admin", icon: Shield },
  { label: "Help & Support", href: "/support", icon: CircleHelp },
];

export const SIGN_OUT = { label: "Sign Out", icon: Power };

export const TOP_LINKS = [
  { label: "Home", href: "/" },
  { label: "What is AI", href: "/#what-is-ai" },
  { label: "AI-History", href: "/#history" },
  { label: "Our Vision", href: "/vision" },
  { label: "Services", href: "/services" },
  { label: "Contact", href: "/contact" },
  { label: "Admin", href: "/admin" },
];
