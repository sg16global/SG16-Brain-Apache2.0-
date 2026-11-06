"use client";

import { useState } from "react";
import { HardDriveDownload, HardDriveUpload, Lock, Unlock, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { MAX_SESSIONS, deviceVault, importSessions, listSessions, type VaultMessage, type VaultSession } from "@/lib/device-vault";
import {
  downloadCapsule,
  openCapsule,
  sealCapsule,
  type CapsulePayload,
  type CapsuleSession,
} from "@/lib/capsule";

// DEVICE CAPSULE center - an encrypted copy of the history that lives on THIS device
// (lib/device-vault.ts). Sealing needs no sign-in and no server; opening a capsule merges its
// conversations back into this device. The server never sees either.

export function CapsuleCenter({ email }: { email?: string | null; token?: string | null }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState<"idle" | "sealing" | "opening">("idle");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sealAll() {
    setError(null);
    setNote(null);
    if (pass.length < 12) {
      setError("Choose a passphrase of at least 12 characters. It stays in this browser and protects the downloaded file.");
      return;
    }
    setBusy("sealing");
    try {
      const sessions = (await listSessions(deviceVault())).slice(0, MAX_SESSIONS);
      if (sessions.length === 0) throw new Error("There is no saved history on this device yet.");
      const bundle: CapsuleSession[] = sessions.map((s) => ({
        title: s.title,
        modelId: "sg16-brain",
        createdAt: s.updatedAt,
        messages: s.messages.map((m) => ({ role: m.role, content: m.content, modelId: "sg16-brain", createdAt: m.createdAt })),
      }));
      const payload: CapsulePayload = {
        kind: "sg16-capsule",
        version: 1,
        sealedAtUtc: new Date().toISOString(),
        owner: email ?? null,
        sessions: bundle,
      };
      downloadCapsule(email ?? "sovereign", await sealCapsule(payload, pass));
      setNote(`Encrypted copy created: ${bundle.length} conversation(s), AES-GCM with PBKDF2. Your history on this device is unchanged.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sealing failed.");
    } finally {
      setBusy("idle");
    }
  }

  async function openFile(file: File) {
    setError(null);
    setNote(null);
    if (pass.length < 4) {
      setError("Enter the passphrase you sealed it with first, then choose the capsule file.");
      return;
    }
    setBusy("opening");
    try {
      const payload = await openCapsule(await file.text(), pass);
      const stamp = Date.now().toString(36);
      const sessions: VaultSession[] = payload.sessions.slice(0, MAX_SESSIONS).map((s, i) => {
        const created = s.createdAt && !Number.isNaN(Date.parse(s.createdAt)) ? new Date(s.createdAt).toISOString() : new Date().toISOString();
        const messages: VaultMessage[] = s.messages
          .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(0, 2000)
          .map((m, j) => ({
            id: `cap-${stamp}-${i}-${j}`,
            role: m.role as "user" | "assistant",
            content: m.content.slice(0, 20_000),
            createdAt: m.createdAt && !Number.isNaN(Date.parse(m.createdAt)) ? new Date(m.createdAt).toISOString() : created,
          }));
        return { id: `capsule-${stamp}-${i}`, title: (s.title || "Conversation").slice(0, 200), createdAt: created, updatedAt: created, messages };
      });
      const result = await importSessions(deviceVault(), sessions);
      setNote(`Capsule opened: ${result.added} conversation(s) added to this device${payload.owner ? ` · sealed by ${payload.owner}` : ""}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opening failed.");
    } finally {
      setBusy("idle");
    }
  }

  return (
    <Panel className="flex flex-col">
      <div className="border-b border-amber-400/25 px-4 py-3 text-center">
        <h3 className="panel-title text-base text-gold-gradient">DEVICE CAPSULE</h3>
        <p className="mt-1 font-mono2 text-[9px] tracking-[0.22em] text-slate-400">
          ENCRYPTED FILE · AES-256-GCM · STAYS ON YOUR DEVICE
        </p>
      </div>
      <div className="space-y-3 p-4">
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="capsule passphrase (stays in this browser)"
          className="input-dark h-10 w-full px-3 text-[13px]"
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={sealAll}
            disabled={busy !== "idle"}
            className="btn-red inline-flex items-center gap-2 px-4 py-2 font-display text-[10px] font-black tracking-[0.18em] disabled:opacity-50"
          >
            <Lock className="h-4 w-4" /> {busy === "sealing" ? "SEALING…" : "SEAL & DOWNLOAD"}
            <HardDriveDownload className="h-4 w-4" />
          </button>
          <label
            className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 font-display text-[10px] font-black tracking-[0.18em] text-cyan-200 transition hover:bg-cyan-500/20 ${
              busy !== "idle" ? "pointer-events-none opacity-50" : ""
            }`}
          >
            <Unlock className="h-4 w-4" /> {busy === "opening" ? "OPENING…" : "OPEN CAPSULE"}
            <HardDriveUpload className="h-4 w-4" />
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) openFile(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {note && <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-[12px] font-medium text-emerald-200">{note}</p>}
        {error && (
          <p className="flex items-center gap-2 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-300">
            <TriangleAlert className="h-4 w-4 flex-none" /> {error}
          </p>
        )}
        <p className="font-mono2 text-[9px] leading-relaxed tracking-[0.14em] text-slate-500">
          HOW IT WORKS · the file &lt;name&gt;-capsule.sg16.json lands in your downloads — park it in
          your Google Drive or phone folder. New device? Open the capsule there to bring your
          conversations back. The server never holds your history: if the file is lost, so is the copy.
        </p>
      </div>
    </Panel>
  );
}
