import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const migrationRequired = "Apply supabase/migrations/009_live_vehicle_monitoring.sql in Supabase before using live monitoring.";

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
  return { user, role: profile.role };
}

export async function GET() {
  const operator = await getGovernmentUser();
  if (!operator) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const supabase = createAdminClient();
    let query = supabase
      .from("vehicle_uploads")
      .select("id, vehicle_id, processing_status, monitoring_started_at, monitoring_ended_at, frame_interval_ms, confidence_threshold")
      .not("monitoring_started_at", "is", null)
      .order("monitoring_started_at", { ascending: false })
      .limit(20);
    if (operator.role !== "government") query = query.eq("operator_id", operator.user.id);
    const { data: sessions, error } = await query;
    if (error) throw error;

    const sessionIds = (sessions ?? []).map((session) => session.id);
    const { data: detections, error: detectionsError } = sessionIds.length
      ? await supabase.from("ai_detections").select("vehicle_upload_id").in("vehicle_upload_id", sessionIds)
      : { data: [], error: null };
    if (detectionsError) throw detectionsError;

    const countBySession = new Map<string, number>();
    for (const detection of detections ?? []) {
      if (detection.vehicle_upload_id) {
        countBySession.set(detection.vehicle_upload_id, (countBySession.get(detection.vehicle_upload_id) ?? 0) + 1);
      }
    }
    return NextResponse.json({
      sessions: (sessions ?? []).map((session) => ({
        ...session,
        candidate_count: countBySession.get(session.id) ?? 0,
      })),
    });
  } catch (error) {
    console.error("Vehicle session history failed:", error);
    if (missingMigration(error)) return NextResponse.json({ error: migrationRequired }, { status: 503 });
    return NextResponse.json({ error: "Monitoring history could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const operator = await getGovernmentUser();
  if (!operator) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = await request.json();
    const pairingId = typeof body.pairingId === "string" ? body.pairingId : "";
    const frameIntervalMs = Number(body.frameIntervalMs);
    const confidenceThreshold = Number(body.confidenceThreshold);
    if (!pairingId || ![1000, 1500, 2000].includes(frameIntervalMs) ||
        !Number.isFinite(confidenceThreshold) || confidenceThreshold < 0.25 || confidenceThreshold > 0.95) {
      return NextResponse.json({ error: "Pairing or monitoring settings are invalid." }, { status: 400 });
    }

    const supabase = createAdminClient();
    const now = new Date().toISOString();
    const { data: pairing, error: pairingError } = await supabase
      .from("vehicle_camera_pairings")
      .select("id, operator_id, vehicle_id, joined_at, closed_at, expires_at")
      .eq("id", pairingId)
      .eq("operator_id", operator.user.id)
      .not("joined_at", "is", null)
      .is("closed_at", null)
      .gt("expires_at", now)
      .maybeSingle();
    if (pairingError) throw pairingError;
    if (!pairing) return NextResponse.json({ error: "The paired phone is disconnected or expired." }, { status: 409 });

    const { data, error } = await supabase
      .from("vehicle_uploads")
      .insert({
        operator_id: operator.user.id,
        vehicle_id: pairing.vehicle_id,
        storage_path: null,
        processing_status: "processing",
        monitoring_started_at: now,
        frame_interval_ms: frameIntervalMs,
        confidence_threshold: confidenceThreshold,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("Camera session could not be created.");

    const { data: linkedPairing, error: linkError } = await supabase
      .from("vehicle_camera_pairings")
      .update({ monitoring_session_id: data.id })
      .eq("id", pairingId)
      .eq("operator_id", operator.user.id)
      .is("closed_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (linkError || !linkedPairing) {
      await supabase
        .from("vehicle_uploads")
        .update({ processing_status: "failed", monitoring_ended_at: new Date().toISOString() })
        .eq("id", data.id)
        .eq("operator_id", operator.user.id);
      if (linkError) throw linkError;
      return NextResponse.json({ error: "The pairing closed before monitoring could start." }, { status: 409 });
    }
    return NextResponse.json({ sessionId: data.id });
  } catch (error) {
    console.error("Vehicle session creation failed:", error);
    if (missingMigration(error)) return NextResponse.json({ error: migrationRequired }, { status: 503 });
    return NextResponse.json({ error: "Camera session could not be started." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const operator = await getGovernmentUser();
  if (!operator) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const { sessionId } = await request.json();
    if (typeof sessionId !== "string") {
      return NextResponse.json({ error: "A camera session is required." }, { status: 400 });
    }
    const supabase = createAdminClient();
    let query = supabase
      .from("vehicle_uploads")
      .update({ processing_status: "completed", monitoring_ended_at: new Date().toISOString() })
      .eq("id", sessionId);
    if (operator.role !== "government") query = query.eq("operator_id", operator.user.id);
    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Vehicle session stop failed:", error);
    if (missingMigration(error)) return NextResponse.json({ error: migrationRequired }, { status: 503 });
    return NextResponse.json({ error: "Camera session could not be stopped." }, { status: 500 });
  }
}