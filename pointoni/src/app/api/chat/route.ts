// Legacy alias retained for existing API clients. All chat traffic shares the
// same authentication, ownership checks, rate limits, and core safety path.
import { NextRequest } from "next/server";
import {
  GET as brainGET,
  POST as brainPOST,
  DELETE as brainDELETE,
} from "../brain/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(req: NextRequest) { return brainGET(req); }
export function POST(req: NextRequest) { return brainPOST(req); }
export function DELETE(req: NextRequest) { return brainDELETE(req); }
