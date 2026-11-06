// This platform keeps no user data on the server, so this route is retired. It answers clearly
// instead of disappearing, so an older client gets an explanation rather than a crash.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GONE = {
  error: "This platform has no user accounts and stores nothing about visitors. This route is retired.",
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
