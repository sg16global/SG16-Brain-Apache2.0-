// Files are kept on the visitor's own device (lib/device-files.ts); this server stores none.
// The route stays only so an old client gets a clear answer instead of a crash.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GONE = {
  error: "Files are kept on your device, not on this server.",
  files: [] as unknown[],
  storedOn: "device",
};

export async function GET() {
  return NextResponse.json(GONE, { status: 410 });
}

export async function POST() {
  return NextResponse.json(GONE, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json(GONE, { status: 410 });
}
