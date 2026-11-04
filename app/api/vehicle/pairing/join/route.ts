import { createHash, randomBytes } from "node:crypto";
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
    const token = typeof body.token === "string" ? body.token : "";
    if (!isPairingToken(token)) {
      return NextResponse.json({ error: "The pairing link is invalid or expired." }, { status: 410 });
    }

    const now = new Date();
    const mobileCloseToken = randomBytes(32).toString("base64url");
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("vehicle_camera_pairings")
      .update({
        token_hash: null,
        mobile_close_token_hash: hashPairingToken(mobileCloseToken),
        joined_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      })
      .eq("token_hash", hashPairingToken(token))
      .is("joined_at", null)
      .is("closed_at", null)
      .gt("expires_at", now.toISOString())
      .select("id, vehicle_id, signal_topic, expires_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "The pairing link is invalid, expired, or already used." }, { status: 410 });

    return NextResponse.json({
      pairingId: data.id,
      vehicleId: data.vehicle_id,
      signalTopic: data.signal_topic,
      mobileCloseToken,
      expiresAt: data.expires_at,
    });
  } catch (error) {
    console.error("Mobile camera pairing join failed:", error);
    if (missingMigration(error)) return NextResponse.json({ error: migrationRequired }, { status: 503 });
    return NextResponse.json({ error: "Camera pairing could not be completed." }, { status: 500 });
  }
}
