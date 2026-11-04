import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createMobilePairingUrl, validatePublicAppUrl } from "@/lib/pairing-link";
import { hashPairingToken, isPairingExpired } from "@/lib/pairing-token";

export const runtime = "nodejs";
const pairingLifetimeMs = 5 * 60 * 1000;
const migrationRequired = "Apply Supabase migrations 009 and 010 in order before using mobile camera pairing.";

function missingMigration(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "42P01" || error.code === "42703" || error.code === "PGRST205");
}

async function getGovernmentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "government") return null;
  return user;
}

export async function POST(request: Request) {
  const user = await getGovernmentUser();
  if (!user) return NextResponse.json({ error: "Sign in with a government administrator account to pair a camera." }, { status: 401 });

  try {
    const body = await request.json();
    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId.trim() : "";
    if (!vehicleId || vehicleId.length > 100) {
      return NextResponse.json({ error: "A valid vehicle ID is required." }, { status: 400 });
    }

    const publicUrl = validatePublicAppUrl(process.env.NEXT_PUBLIC_APP_URL ?? "");
    if (!publicUrl.ok) {
      return NextResponse.json({ error: publicUrl.message, code: publicUrl.code }, { status: 503 });
    }

    const token = randomBytes(32).toString("base64url");
    const signalTopic = `vehicle-pair:${randomBytes(32).toString("hex")}`;
    const now = Date.now();
    const expiresAt = new Date(now + pairingLifetimeMs).toISOString();
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("vehicle_camera_pairings")
      .insert({
        operator_id: user.id,
        vehicle_id: vehicleId,
        token_hash: hashPairingToken(token),
        signal_topic: signalTopic,
        laptop_heartbeat_at: new Date(now).toISOString(),
        expires_at: expiresAt,
      })
      .select("id, expires_at")
      .single();
    if (error || !data) throw error ?? new Error("Pairing could not be created.");

    return NextResponse.json({
      pairingId: data.id,
      mobileUrl: createMobilePairingUrl(publicUrl.origin, token),
      expiresAt: data.expires_at,
    });
  } catch (error) {
    console.error("Vehicle camera pairing creation failed:", error);
    if (missingMigration(error)) return NextResponse.json({ error: migrationRequired }, { status: 503 });
    return NextResponse.json({ error: "Camera pairing could not be created." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const user = await getGovernmentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const pairingId = new URL(request.url).searchParams.get("id");
  if (!pairingId) return NextResponse.json({ error: "A pairing ID is required." }, { status: 400 });

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("vehicle_camera_pairings")
      .select("id, vehicle_id, signal_topic, expires_at, joined_at, closed_at")
      .eq("id", pairingId)
      .eq("operator_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data || isPairingExpired(data.expires_at, data.closed_at)) {
      return NextResponse.json({ error: "Pairing expired or closed.", status: "disconnected" }, { status: 410 });
    }
    return NextResponse.json({
      pairingId: data.id,
      vehicleId: data.vehicle_id,
      signalTopic: data.joined_at ? data.signal_topic : null,
      status: data.joined_at ? "connected" : "waiting",
      expiresAt: data.expires_at,
    });
  } catch (error) {
    console.error("Vehicle camera pairing status failed:", error);
    if (missingMigration(error)) return NextResponse.json({ error: migrationRequired }, { status: 503 });
    return NextResponse.json({ error: "Pairing status could not be loaded." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getGovernmentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const body = await request.json();
    if (typeof body.pairingId !== "string") {
      return NextResponse.json({ error: "A pairing ID is required." }, { status: 400 });
    }
    const supabase = createAdminClient();
    const now = new Date().toISOString();
    const { data: pairing, error } = await supabase
      .from("vehicle_camera_pairings")
      .update({
        closed_at: now,
        expires_at: now,
        token_hash: null,
        mobile_close_token_hash: null,
      })
      .eq("id", body.pairingId)
      .eq("operator_id", user.id)
      .select("monitoring_session_id")
      .maybeSingle();
    if (error) throw error;
    if (!pairing) return NextResponse.json({ error: "Pairing not found." }, { status: 404 });
    if (pairing.monitoring_session_id) {
      const { error: sessionError } = await supabase
        .from("vehicle_uploads")
        .update({ processing_status: "completed", monitoring_ended_at: now })
        .eq("id", pairing.monitoring_session_id)
        .eq("operator_id", user.id);
      if (sessionError) throw sessionError;
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Vehicle camera pairing close failed:", error);
    if (missingMigration(error)) return NextResponse.json({ error: migrationRequired }, { status: 503 });
    return NextResponse.json({ error: "Pairing could not be closed." }, { status: 500 });
  }
}
