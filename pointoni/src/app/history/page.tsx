"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Trash2, MessageSquareText, SquarePen, Download, Upload, FolderOpen, ShieldCheck } from "lucide-react";
import { SiteChrome } from "@/components/chrome/SiteChrome";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { CapsuleCenter } from "@/components/CapsuleCenter";
import {
  buildExport,
  deviceVault,
  importSessions,
  listSessions,
  parseExport,
  type VaultSession,
} from "@/lib/device-vault";
import {
  backupFolderName,
  chooseBackupFolder,
  folderBackupSupported,
  forgetBackupFolder,
  readFolderBackups,
  writeAllBackups,
} from "@/lib/device-folder";

// HISTORY lives on THIS device (the browser's own database). The server keeps none of it, so no
// sign-in is needed to have it, and it is not lost when the server restarts. Clearing the browser's
// site data does erase it - export a file or pick a backup folder to keep a copy you own.

export default function HistoryPage() {
  const [sessions, setSessions] = useState<VaultSession[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [canFolder, setCanFolder] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await listSessions(deviceVault()));
    } catch {
      setSessions([]);
      setError("This browser is blocking local storage, so history cannot be kept here (private windows often do this).");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    listSessions(deviceVault())
      .then((s) => alive && setSessions(s))
      .catch(() => {
        if (!alive) return;
        setSessions([]);
        setError("This browser is blocking local storage, so history cannot be kept here (private windows often do this).");
      });
    backupFolderName().then((n) => alive && setFolder(n));
    // window.showDirectoryPicker only exists in the browser: read it after mount
    Promise.resolve().then(() => alive && setCanFolder(folderBackupSupported()));
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [load]);

  async function remove(id: string) {
    if (!confirm("Delete this conversation from this device?")) return;
    await deviceVault().remove(id);
    // best effort: ask the core to drop its short in-memory context too
    void fetch(`/api/brain?session=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
    setSessions((prev) => (prev ?? []).filter((s) => s.id !== id));
  }

  async function exportFile() {
    setError(null);
    const all = await listSessions(deviceVault());
    const blob = new Blob([JSON.stringify(buildExport(all), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sg16-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNote(`Saved ${all.length} conversation(s) to a file you own.`);
  }

  async function importFile(file: File) {
    setError(null);
    setNote(null);
    try {
      if (file.size > 20_000_000) throw new Error("That file is too large to be an SG16 history file.");
      const result = await importSessions(deviceVault(), parseExport(JSON.parse(await file.text())));
      setNote(`Imported: ${result.added} new, ${result.updated} updated, ${result.kept} already up to date.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    }
  }

  async function pickFolder() {
    setError(null);
    const name = await chooseBackupFolder();
    if (!name) return;
    setFolder(name);
    const n = await writeAllBackups(await listSessions(deviceVault()));
    setNote(`Backup folder "${name}" is set. ${n} conversation(s) saved there; new ones are saved automatically.`);
  }

  async function restoreFolder() {
    setError(null);
    const { sessions: found, skipped } = await readFolderBackups();
    const result = await importSessions(deviceVault(), found);
    setNote(
      `Read the backup folder: ${result.added} new, ${result.updated} updated${skipped ? `, ${skipped} file(s) skipped` : ""}.`,
    );
    await load();
  }

  async function stopFolder() {
    await forgetBackupFolder();
    setFolder(null);
    setNote("The backup folder is forgotten. Your files in it are untouched.");
  }

  return (
    <SiteChrome>
      <PageHeader title="HISTORY" subtitle="Your conversations are kept on this device only. The server stores none of them.">
        <Link href="/chat" className="btn-red inline-flex items-center gap-2 px-4 py-2 text-[11px]">
          <SquarePen className="h-4 w-4" /> NEW CHAT
        </Link>
      </PageHeader>

      <div className="mx-auto max-w-[900px] space-y-5 px-4 py-8">
        <Panel soft corners={false} className="flex flex-col gap-3 p-4">
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-slate-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-300" />
            Saved automatically in this browser, no sign-in needed. Clearing this site&apos;s data erases it, so
            keep a copy you own: download a file, or choose a folder and new conversations are saved there too.
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportFile} className="btn-ghost inline-flex items-center gap-2 px-3 py-2 text-[10px]">
              <Download className="h-4 w-4" /> DOWNLOAD ALL
            </button>
            <button onClick={() => fileInput.current?.click()} className="btn-ghost inline-flex items-center gap-2 px-3 py-2 text-[10px]">
              <Upload className="h-4 w-4" /> IMPORT FILE
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = "";
              }}
            />
            {canFolder && (
              <>
                <button onClick={pickFolder} className="btn-ghost inline-flex items-center gap-2 px-3 py-2 text-[10px]">
                  <FolderOpen className="h-4 w-4" /> {folder ? `FOLDER: ${folder.toUpperCase()}` : "CHOOSE BACKUP FOLDER"}
                </button>
                {folder && (
                  <>
                    <button onClick={restoreFolder} className="btn-ghost px-3 py-2 text-[10px]">RESTORE FROM FOLDER</button>
                    <button onClick={stopFolder} className="btn-ghost px-3 py-2 text-[10px]">STOP BACKUP</button>
                  </>
                )}
              </>
            )}
          </div>
          {!canFolder && (
            <p className="font-mono2 text-[9px] tracking-widest text-slate-500">
              THIS BROWSER CANNOT SAVE TO A FOLDER · USE DOWNLOAD / IMPORT (CHROME AND EDGE CAN DO FOLDERS)
            </p>
          )}
          {note && <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-200">{note}</p>}
        </Panel>

        {error && <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-200">{error}</p>}

        {sessions === null && !error && (
          <Panel className="p-10 text-center text-sm tracking-widest text-slate-500 pulse-soft">
            READING THIS DEVICE…
          </Panel>
        )}

        {sessions && sessions.length === 0 && (
          <Panel className="corner flex flex-col items-center gap-4 p-14 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full border border-cyan-400/40 bg-cyan-500/10">
              <MessageSquareText className="h-8 w-8 text-cyan-300" />
            </span>
            <h2 className="font-display text-lg font-black tracking-wide text-white">NO CONVERSATIONS YET</h2>
            <p className="max-w-sm text-sm text-slate-400">
              Your conversations will appear here, saved on this device as you chat.
            </p>
            <Link href="/chat" className="btn-red px-5 py-2.5 text-[11px]">START A CONVERSATION</Link>
          </Panel>
        )}

        <ul className="space-y-2.5">
          {(sessions ?? []).map((s) => (
            <li key={s.id}>
              <Panel soft corners={false} className="group flex items-center gap-4 px-4 py-3.5 transition hover:border-red-400/60">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-lg border border-red-400/30 bg-red-500/10">
                  <MessageSquareText className="h-5 w-5 text-red-300" />
                </span>
                <Link href={`/chat?s=${encodeURIComponent(s.id)}`} className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-slate-100 group-hover:text-white">
                    {s.title}
                  </span>
                  <span className="mt-0.5 block font-mono2 text-[9px] tracking-widest text-slate-500">
                    {s.messages.length} MESSAGES · {new Date(s.updatedAt).toLocaleString()}
                  </span>
                </Link>
                <Link
                  href={`/chat?s=${encodeURIComponent(s.id)}`}
                  className="btn-ghost hidden px-3 py-1.5 text-[10px] sm:inline-block"
                >
                  OPEN
                </Link>
                <button
                  onClick={() => void remove(s.id)}
                  aria-label="Delete conversation"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-red-400/30 text-red-400 transition hover:bg-red-500/20 hover:text-red-200"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Panel>
            </li>
          ))}
        </ul>

        <CapsuleCenter />
      </div>
    </SiteChrome>
  );
}
