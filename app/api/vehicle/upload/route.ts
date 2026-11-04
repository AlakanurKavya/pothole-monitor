import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.role !== "government") {
      return NextResponse.json({ error: "Vehicle monitoring access is required." }, { status: 403 });
    }

    const form = await request.formData();
    const fileField = form.get("file");
    const sessionId = String(form.get("sessionId") ?? "").trim();
    const recordingStartedAt = String(form.get("recordingStartedAt") ?? "").trim();
    const recordingEndedAt = String(form.get("recordingEndedAt") ?? "").trim();
    const durationSeconds = Number(form.get("durationSeconds") ?? 0);
    const gpsSamplesRaw = String(form.get("gpsSamples") ?? "[]").trim();

    if (!(fileField instanceof File) || !fileField.size || !sessionId ||
        !fileField.type.startsWith("video/") || fileField.size > 100 * 1024 * 1024) {
      return NextResponse.json({ error: "A valid recorded video and active session are required." }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: session, error: sessionError } = await supabase
      .from("vehicle_uploads")
      .select("id, vehicle_id")
      .eq("id", sessionId)
      .eq("operator_id", user.id)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return NextResponse.json({ error: "Camera session was not found." }, { status: 404 });

    let gpsSamples: Array<{ timestamp: string; lat: number; lng: number }> = [];
    if (gpsSamplesRaw && gpsSamplesRaw !== "[]") {
      try {
        const parsed = JSON.parse(gpsSamplesRaw);
        if (Array.isArray(parsed)) {
          gpsSamples = parsed.filter(
            (item) => item && typeof item.timestamp === "string" && Number.isFinite(item.lat) && Number.isFinite(item.lng),
          );
        }
      } catch {
        return NextResponse.json({ error: "GPS samples are invalid." }, { status: 400 });
      }
    }

    if (recordingStartedAt && !Date.parse(recordingStartedAt)) {
      return NextResponse.json({ error: "Recording start time is invalid." }, { status: 400 });
    }
    if (recordingEndedAt && !Date.parse(recordingEndedAt)) {
      return NextResponse.json({ error: "Recording end time is invalid." }, { status: 400 });
    }

    const safeName = fileField.name
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(-120) || `vehicle-recording-${Date.now()}.webm`;
    const storagePath = `vehicle-recordings/${sessionId}/${Date.now()}-${safeName}`;
    const bytes = Buffer.from(await fileField.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from("pothole-images")
      .upload(storagePath, bytes, {
        contentType: fileField.type || "video/webm",
        upsert: false,
      });

    if (uploadError) {
      console.error("Vehicle recording upload failed:", uploadError);
      return NextResponse.json({ error: "Vehicle video upload failed." }, { status: 502 });
    }

    const basicUpdate = {
      storage_path: storagePath,
      gps_track: gpsSamples.length ? gpsSamples : null,
      uploaded_at: new Date().toISOString(),
      processing_status: "completed",
      processing_error: null,
    };
    const metadataUpdate = {
      ...basicUpdate,
      file_name: safeName,
      mime_type: fileField.type || "video/webm",
      file_size_bytes: bytes.length,
      recorded_started_at: recordingStartedAt || null,
      recorded_ended_at: recordingEndedAt || null,
      duration_seconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      gps_samples: gpsSamples.length ? gpsSamples : null,
    };

    const { error: updateError } = await supabase
      .from("vehicle_uploads")
      .update(metadataUpdate)
      .eq("id", sessionId)
      .eq("operator_id", user.id);

    if (updateError) {
      const { error: fallbackError } = await supabase
        .from("vehicle_uploads")
        .update(basicUpdate)
        .eq("id", sessionId)
        .eq("operator_id", user.id);

      if (fallbackError) {
        console.error("Vehicle recording metadata update failed:", fallbackError);
        await supabase.storage.from("pothole-images").remove([storagePath]);
        return NextResponse.json({ error: "Vehicle recording metadata could not be saved." }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      storagePath,
      fileName: safeName,
      fileSizeBytes: bytes.length,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      uploadedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Vehicle video upload route failed:", error);
    return NextResponse.json({ error: "The recorded video could not be uploaded." }, { status: 500 });
  }
}
