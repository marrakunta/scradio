import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { safeSecretMatch } from "@/lib/crypto";

export const dynamic = "force-dynamic";

type StatePayload = {
  playing?: boolean;
  position_ms?: number;
  client_sent_at_ms?: number;
  action?: "PLAY" | "PAUSE" | "SEEK" | "HEARTBEAT";
};

function getBearer(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
}

function clampPosition(raw: number): number {
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.floor(raw));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const secret = getBearer(req);
  if (!secret) {
    return NextResponse.json({ error: "Missing authorization" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => null)) as StatePayload | null;
  if (!payload || typeof payload.playing !== "boolean" || typeof payload.position_ms !== "number") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const supabase = createServiceSupabase();

  const { data: row, error: readError } = await supabase
    .from("sessions")
    .select("id,host_secret_hash")
    .eq("id", params.id)
    .single();

  if (readError || !row) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (!safeSecretMatch(secret, row.host_secret_hash)) {
    return NextResponse.json({ error: "Invalid host secret" }, { status: 401 });
  }

  const now = new Date();
  const lease = new Date(now.getTime() + 20_000);

  const { error: updateError } = await supabase
    .from("sessions")
    .update({
      playing: payload.playing,
      position_ms: clampPosition(payload.position_ms),
      state_updated_at: now.toISOString(),
      host_lease_expires_at: lease.toISOString(),
      last_error: null
    })
    .eq("id", params.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to update state" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, server_time: now.toISOString() });
}
