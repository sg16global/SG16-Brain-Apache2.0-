"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogIn, ShieldCheck } from "lucide-react";
import { SiteChrome } from "@/components/chrome/SiteChrome";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { announceIdentityChange, useAdmin, useSignedIn } from "@/lib/use-session";

// OPERATOR sign-in. Visitors never need an account: they chat and subscribe without one, and the
// server keeps nothing about them. Only the platform operator signs in here, with the official
// email registered in the server's configuration plus a password (stored as a hash, not the
// password). Nothing is written to a database; the signed token lives in this browser only.

export default function LoginPage() {
  const router = useRouter();
  const signedIn = useSignedIn();
  const admin = useAdmin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admin-login", email, password }),
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        setError(data.error || "Sign-in failed.");
        return;
      }
      localStorage.setItem("sg16/identity", JSON.stringify({ token: data.token, email: data.email }));
      setPassword("");
      announceIdentityChange();
      router.push("/admin");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    try {
      localStorage.removeItem("sg16/identity");
    } catch {
      // storage unavailable
    }
    announceIdentityChange();
    router.push("/");
  }

  return (
    <SiteChrome>
      <PageHeader title="OPERATOR SIGN-IN" subtitle="For the platform operator only. Visitors do not need an account." />
      <div className="mx-auto max-w-[460px] px-4 py-10">
        <Panel className="p-7">
          {signedIn ? (
            <div className="space-y-4 text-center">
              <ShieldCheck className="mx-auto h-9 w-9 text-emerald-300" />
              <p className="text-[13px] text-slate-300">You are signed in on this device.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {admin === true && (
                  <Link href="/admin" className="btn-red px-5 py-2.5 text-[11px]">OPEN ADMIN CONSOLE</Link>
                )}
                <button onClick={signOut} className="btn-ghost px-5 py-2.5 text-[11px]">SIGN OUT</button>
              </div>
            </div>
          ) : (
            <form onSubmit={signIn} className="space-y-4">
              <label className="block">
                <span className="mb-1 block font-mono2 text-[10px] tracking-widest text-slate-400">OFFICIAL EMAIL</span>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-dark h-11 w-full px-3 text-[14px]"
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-mono2 text-[10px] tracking-widest text-slate-400">PASSWORD</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-dark h-11 w-full px-3 text-[14px]"
                  required
                />
              </label>
              {error && <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</p>}
              <button disabled={busy} className="btn-red inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[11px] disabled:opacity-50">
                <LogIn className="h-4 w-4" /> {busy ? "CHECKING…" : "SIGN IN"}
              </button>
              <p className="font-mono2 text-[9px] leading-relaxed tracking-wider text-slate-500">
                ONLY THE EMAIL REGISTERED IN THE BRAIN CONFIGURATION CAN OPEN THIS. TO CHAT, SUBSCRIBE OR KEEP YOUR
                HISTORY YOU NEED NO ACCOUNT.
              </p>
            </form>
          )}
        </Panel>
      </div>
    </SiteChrome>
  );
}
