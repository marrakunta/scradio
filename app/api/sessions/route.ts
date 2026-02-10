import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { generateHostSecret, hashHostSecret } from "@/lib/crypto";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function isValidTrackUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.hostname.includes("soundcloud.com");
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { track_url?: string } | null;
  const trackUrl = body?.track_url?.trim();

  if (!trackUrl || !isValidTrackUrl(trackUrl)) {
    return NextResponse.json({ error: "Invalid SoundCloud track URL" }, { status: 400 });
  }

  const hostSecret = generateHostSecret();
  const hostSecretHash = hashHostSecret(hostSecret);
  const supabase = createServiceSupabase();

  const now = Date.now();
  const leaseExpires = new Date(now + 20_000).toISOString();
  const stateUpdatedAt = new Date(now).toISOString();

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      track_url: trackUrl,
      host_secret_hash: hostSecretHash,
      playing: false,
      position_ms: 0,
      state_updated_at: stateUpdatedAt,
      host_lease_expires_at: leaseExpires
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }

  const baseUrl = env.appUrl || req.nextUrl.origin;
  const listenerPath = `/session/${data.id}`;
  const hostPath = `${listenerPath}#host=${hostSecret}`;

  return NextResponse.json({
    session_id: data.id,
    host_secret: hostSecret,
    session_url_host: `${baseUrl}${hostPath}`,
    session_url_listener: `${baseUrl}${listenerPath}`
  });
}
