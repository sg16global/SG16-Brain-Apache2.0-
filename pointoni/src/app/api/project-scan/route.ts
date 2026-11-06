import { NextRequest, NextResponse } from "next/server";
import { buildReport, unzip } from "@/lib/project-scan";

// PROJECT VITAL SCAN — free forever, no subscription, runs 24/7.
// Files arrive over this one request, are analyzed in memory, fingerprinted
// (SHA-256), reported, and immediately discarded. Nothing is stored.

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // cap the upload itself (before unzip)

export async function POST(req: NextRequest) {
  try {
    const out: { path: string; data: Buffer }[] = [];
    let uploadBytes = 0;

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      // pasted-code mode: { label, files: [{ path, content }] } or { label, content }
      const body = (await req.json()) as {
        label?: string;
        content?: string;
        files?: { path: string; content: string }[];
      };
      if (Array.isArray(body.files) && body.files.length > 0) {
        for (const f of body.files) {
          if (typeof f.path !== "string" || typeof f.content !== "string") continue;
          const data = Buffer.from(f.content, "utf8");
          uploadBytes += data.length;
          out.push({ path: sanitize(f.path), data });
        }
      } else if (typeof body.content === "string" && body.content.trim()) {
        const data = Buffer.from(body.content, "utf8");
        uploadBytes += data.length;
        out.push({ path: `pasted/${body.label?.trim() || "snippet.js"}`, data });
      }
    } else {
      // multipart form-data mode — ZIP and/or individual files
      const form = await req.formData();
      const files = form.getAll("files");
      for (const f of files) {
        if (!(f instanceof File)) continue;
        const raw = Buffer.from(await f.arrayBuffer());
        uploadBytes += raw.length;
        if (uploadBytes > MAX_UPLOAD_BYTES) {
          return NextResponse.json(
            { error: "Upload exceeds the 8 MB budget. Share a trimmed archive (code only, no build folders)." },
            { status: 413 },
          );
        }
        const name = sanitize(f.name || "upload.bin");
        if (/\.zip$/i.test(name)) {
          try {
            for (const e of unzip(raw)) out.push({ path: e.path, data: e.data });
          } catch {
            return NextResponse.json(
              { error: "That ZIP could not be read. Re-export it as a standard (stored/deflate) archive and try again." },
              { status: 422 },
            );
          }
        } else {
          out.push({ path: name, data: raw });
        }
      }
    }

    if (out.length === 0) {
      return NextResponse.json(
        { error: "Nothing scannable received. Drop a .zip, one or more code files, or paste a snippet." },
        { status: 400 },
      );
    }

    const report = buildReport(out);
    return NextResponse.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Scan failed.";
    if (msg.includes("scan budget")) {
      return NextResponse.json({ error: `${msg}. Reduce the project to source files only.` }, { status: 413 });
    }
    return NextResponse.json({ error: `Scan failed: ${msg}` }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    service: "SG16 Project Vital Scan",
    version: "1.0.0",
    cost: "free — no subscription, online 24/7",
    retention: "zero — files are analyzed in memory and discarded; only a SHA-256 fingerprint appears in the report",
    determinism: "identical input bytes produce an identical report",
    accepts: [".zip archives (stored/deflate)", "individual code/text files", "pasted code (application/json)"],
    budgets: { upload: "8 MB", decompressed: "16 MB", files: 300, perFile: "512 KB" },
  });
}

function sanitize(p: string): string {
  return p.replace(/^([A-Za-z]:)?[\\/]*/, "").replace(/\.\.([/\\]|$)/g, "").slice(0, 240);
}
