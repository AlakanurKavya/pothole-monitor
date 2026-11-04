import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hashPairingToken, isPairingToken } from "@/lib/pairing-token";

export const runtime = "nodejs";
const pairingLeaseMs = 5 * 60 * 1000;
const laptopHeartbeatMaxAgeMs = 45 * 1000;
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
    if (!pairingId) return NextResponse.json({ error: "A pairing ID is required." }, { status: 400 });

    const now = new Date();
    const supabase = createAdminClient();

    if (mobileCloseToken) {
      if (!isPairingToken(mobileCloseToken)) {
        return NextResponse.json({ error: "The mobile pairing credential is invalid." }, { status: 401 });
      }
      const { data, error } = await supabase
        .from("vehicle_camera_pairings")
        .update({ expires_at: new Date(now.getTime() + pairingLeaseMs).toISOString() })
        .eq("id", pairingId)
        .eq("mobile_close_token_hash", hashPairingToken(mobileCloseToken))
        .not("joined_at", "is", null)
        .is("closed_at", null)
        .gt("expires_at", now.toISOString())
        .gt("laptop_heartbeat_at", new Date(now.getTime() - laptopHeartbeatMaxAgeMs).toISOString())
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "The laptop is offline or the pairing expired. Create a new pairing." }, { status: 410 });
      return NextResponse.json({ expiresAt: new Date(now.getTime() + pairingLeaseMs).toISOString() });
    }

    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const { data: profile } = await userClient.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "government") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { data: pairing, error: pairingError } = await supabase
      .from("vehicle_camera_pairings")
      .select("id, joined_at")
      .eq("id", pairingId)
      .eq("operator_id", user.id)
      .is("closed_at", null)
      .gt("expires_at", now.toISOString())
      .maybeSingle();
    if (pairingError) throw pairingError;
    if (!pairing) return NextResponse.json({ error: "The pairing expired or was closed." }, { status: 410 });

    const update: { laptop_heartbeat_at: string; expires_at?: string } = {
      laptop_heartbeat_at: now.toISOString(),
    };
    if (pairing.joined_at) update.expires_at = new Date(now.getTime() + pairingLeaseMs).toISOString();
    const { data, error } = await supabase
      .from("vehicle_camera_pairings")
      .update(update)
      .eq("id", pairingId)
      .eq("operator_id", user.id)
      .is("closed_at", null)
      .gt("expires_at", now.toISOString())
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "The pairing expired or was closed." }, { status: 410 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Mobile pairing heartbeat failed:", error);
    if (missingMigration(error)) return NextResponse.json({ error: migrationRequired }, { status: 503 });
    return NextResponse.json({ error: "The mobile pairing could not be renewed." }, { status: 500 });
  }
}
