import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { yoloHealth } from "@/lib/yolo-client";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "government") {
    return NextResponse.json({ error: "Vehicle monitoring access is required." }, { status: 403 });
  }

  const health = await yoloHealth();
  if (!health.ok) {
    return NextResponse.json({
      error: health.mode === "unavailable"
        ? "YOLO service unavailable: the model is not loaded."
        : health.mode === "invalid_response"
          ? "YOLO service returned an invalid health response."
        : "YOLO service unavailable: FastAPI could not be reached.",
      code: "YOLO_SERVICE_UNAVAILABLE",
      mode: health.mode ?? "disconnected",
    }, { status: 503 });
  }
  return NextResponse.json({ ok: true, mode: health.mode, modelLoaded: health.model_loaded });
}
