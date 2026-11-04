import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPairingToken, isPairingToken } from "@/lib/pairing-token";

export const runtime = "nodejs";
const migrationRequired = "Apply Supabase migrations 009 and 010 in order before using mobile camera pairing.";

function missingMigration(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "42P01" || error.code === "42703" || error.code === "PGRST205");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const pairingId = typeof body.pairingId === "string" ? body.pairingId : "";
    const mobileCloseToken = typeof body.mobileCloseToken === "string" ? body.mobileCloseToken : "";
    if (!pairingId || !isPairingToken(mobileCloseToken)) {
      return NextResponse.json({ error: "The mobile pairing credential is invalid." }, { status: 401 });
    }

    const now = new Date().toISOString();
    const supabase = createAdminClient();
    const { data: pairing, error } = await supabase
      .from("vehicle_camera_pairings")
      .update({
        closed_at: now,
        expires_at: now,
        token_hash: null,
        mobile_close_token_hash: null,
      })
      .eq("id", pairingId)
      .eq("mobile_close_token_hash", hashPairingToken(mobileCloseToken))
      .not("joined_at", "is", null)
      .is("closed_at", null)
      .select("monitoring_session_id")
      .maybeSingle();
    if (error) throw error;
    if (!pairing) return NextResponse.json({ error: "The pairing is already closed or expired." }, { status: 410 });

    if (pairing.monitoring_session_id) {
      const { error: sessionError } = await supabase
        .from("vehicle_uploads")
        .update({ processing_status: "completed", monitoring_ended_at: now })
        .eq("id", pairing.monitoring_session_id);
      if (sessionError) throw sessionError;
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Mobile pairing close failed:", error);
    if (missingMigration(error)) return NextResponse.json({ error: migrationRequired }, { status: 503 });
    return NextResponse.json({ error: "The mobile pairing could not be closed." }, { status: 500 });
  }
}
