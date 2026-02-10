import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServiceSupabase();

  const { data, error } = await supabase
    .from("sessions")
    .select(
      "id,track_url,track_sc_id,created_at,playing,position_ms,state_updated_at,host_lease_expires_at,last_error"
    )
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
