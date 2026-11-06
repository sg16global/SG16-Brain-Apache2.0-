"use client";

import type { ReactNode } from "react";
import { useAdmin } from "@/lib/use-session";

/** Renders its children only for a signed-in operator (the server decides who that is). */
export function AdminOnly({ children }: { children: ReactNode }) {
  return useAdmin() === true ? <>{children}</> : null;
}
