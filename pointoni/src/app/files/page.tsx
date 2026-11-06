"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, FileText, Download, Trash2, FolderLock } from "lucide-react";
import { SiteChrome } from "@/components/chrome/SiteChrome";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { addDeviceFile, getDeviceFile, listDeviceFiles, removeDeviceFile, MAX_FILE_BYTES, type DeviceFile } from "@/lib/device-files";

type FileRow = DeviceFile;

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setFiles(await listDeviceFiles());
    } catch {
      setFiles([]);
      setError("This browser is blocking local storage, so files cannot be kept here (private windows often do this).");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    listDeviceFiles()
      .then((f) => alive && setFiles(f))
      .catch(() => {
        if (!alive) return;
        setFiles([]);
        setError("This browser is blocking local storage, so files cannot be kept here (private windows often do this).");
      });
    return () => {
      alive = false;
    };
  }, []);

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(list)) {
        try {
          await addDeviceFile(file);
        } catch (e) {
          setError(e instanceof Error ? e.message : `Could not save ${file.name}.`);
        }
      }
      await load();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function download(f: FileRow) {
    const saved = await getDeviceFile(f.id);
    if (!saved) return;
    const url = URL.createObjectURL(saved.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function remove(id: string) {
    if (!confirm("Remove this file from this device?")) return;
    await removeDeviceFile(id);
    setFiles((p) => (p ?? []).filter((f) => f.id !== id));
  }

  return (
    <SiteChrome>
      <PageHeader title="MY FILES" subtitle="Files you keep here are stored on this device only. They are never uploaded to the server.">
        <button onClick={() => inputRef.current?.click()} className="btn-red inline-flex items-center gap-2 px-4 py-2 text-[11px]">
          <UploadCloud className="h-4 w-4" /> ADD FILES
        </button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      </PageHeader>

      <div className="mx-auto max-w-[900px] px-4 py-8">
        <Panel
          className={`corner flex flex-col items-center gap-3 border-dashed p-8 text-center transition ${
            dragOver ? "border-cyan-400/80 bg-cyan-500/10" : ""
          }`}
          corners={false}
        >
          <span className="grid h-14 w-14 place-items-center rounded-full border border-cyan-400/40 bg-cyan-500/10">
            <UploadCloud className="h-7 w-7 text-cyan-300" />
          </span>
          <p className="font-display text-sm font-bold tracking-widest text-white">
            {uploading ? "SAVING TO THIS DEVICE…" : "DRAG FILES HERE OR USE THE ADD BUTTON"}
          </p>
          <p className="font-mono2 text-[10px] tracking-widest text-slate-500">{`${MAX_FILE_BYTES / 1024 / 1024}MB PER FILE · KEPT ON THIS DEVICE ONLY`}</p>
          <input
            type="file"
            multiple
            className="absolute inset-0 cursor-pointer opacity-0"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              upload(e.dataTransfer.files);
            }}
            onChange={(e) => upload(e.target.files)}
          />
        </Panel>

        {error && <p className="mt-3 rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

        <div className="mt-6">
          {files === null ? (
            <Panel className="p-10 text-center text-sm tracking-widest text-slate-500 pulse-soft">SCANNING VAULT…</Panel>
          ) : files.length === 0 ? (
            <Panel className="corner flex flex-col items-center gap-3 p-12 text-center">
              <FolderLock className="h-10 w-10 text-slate-600" />
              <h2 className="font-display text-base font-black tracking-wide text-white">VAULT EMPTY</h2>
              <p className="max-w-sm text-sm text-slate-400">No files yet. Files you add stay in this browser on this device; nothing is sent to the server, and they are not attached to chat turns.</p>
            </Panel>
          ) : (
            <ul className="space-y-2.5">
              {files.map((f) => (
                <li key={f.id}>
                  <Panel soft corners={false} className="flex items-center gap-4 px-4 py-3">
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-lg border border-cyan-400/30 bg-cyan-500/10">
                      <FileText className="h-5 w-5 text-cyan-300" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-slate-100">{f.name}</p>
                      <p className="font-mono2 text-[9px] tracking-widest text-slate-500">
                        {f.mime || "unknown"} · {fmtSize(f.sizeBytes)} · {new Date(f.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => void download(f)}
                      className="btn-ghost grid h-9 w-9 place-items-center"
                      title="Download"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(f.id)}
                      className="grid h-9 w-9 place-items-center rounded-lg border border-red-400/30 text-red-400 transition hover:bg-red-500/20"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Panel>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SiteChrome>
  );
}
