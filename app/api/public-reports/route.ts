import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { persistDetections } from "@/lib/persist-detections";
import { detectImage, detectVideo, yoloHealth } from "@/lib/yolo-client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let createdReportId: string | null = null;
  let uploadedStoragePath: string | null = null;
  let adminClient: ReturnType<typeof createAdminClient> | null = null;
  let file: File;
  let latitude: number;
  let longitude: number;

  try {
    const form = await request.formData();
    const submittedFile = form.get("file");
    latitude = Number(form.get("latitude"));
    longitude = Number(form.get("longitude"));
    if (!(submittedFile instanceof File) || !submittedFile.size) {
      return NextResponse.json({ error: "An image or video is required." }, { status: 400 });
    }
    file = submittedFile;
  } catch {
    return NextResponse.json({ error: "Invalid report submission." }, { status: 400 });
  }

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return NextResponse.json({ error: "Valid latitude and longitude are required." }, { status: 400 });
  }
  if (!(file.type.startsWith("image/") || file.type.startsWith("video/")) || file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "Use an image or video smaller than 25 MB." }, { status: 400 });
  }

  const missingBackendConfig = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (missingBackendConfig) {
    return NextResponse.json({ error: "The Supabase backend is not configured; the report was not saved." }, { status: 503 });
  }

  try {
    const supabase = createAdminClient();
    adminClient = supabase;
    const reportId = randomUUID();
    const reportCode = `R${randomUUID().slice(0, 8).toUpperCase()}`;
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100) || "evidence";
    const storagePath = `anonymous/${reportId}-${safeName}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage.from("pothole-images").upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw uploadError;
    uploadedStoragePath = storagePath;

    let reporterId: string | null = null;
    if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      const userClient = await createClient();
      const { data: { user } } = await userClient.auth.getUser();
      reporterId = user?.id ?? null;
    }

    const { data: report, error: reportError } = await supabase
      .from("citizen_reports")
      .insert({
        id: reportId,
        reporter_id: reporterId,
        report_code: reportCode,
        storage_path: storagePath,
        latitude,
        longitude,
        source: "public",
        processing_status: "processing",
      })
      .select("id")
      .single();
    if (reportError || !report) throw reportError ?? new Error("Report was not saved.");
    createdReportId = report.id;

    const health = await yoloHealth();
    if (!health.ok) {
      const { error: statusError } = await supabase
        .from("citizen_reports")
        .update({ processing_status: "ai_disconnected" })
        .eq("id", report.id);
      if (statusError) throw statusError;
      return NextResponse.json({
        success: true,
        reportId: report.id,
        status: "ai_disconnected",
        count: 0,
        detail: "The report was saved, but AI processing is unavailable and no detections were created. It is not queued for automatic retry.",
      });
    }

    const detections = file.type.startsWith("image/")
      ? await detectImage(file, safeName, latitude, longitude)
      : await detectVideo(file, safeName, [{ lat: latitude, lng: longitude }]);
    const capturedAt = new Date().toISOString();
    await persistDetections(supabase, detections.map((detection) => ({ ...detection, captured_at: capturedAt })), {
      source: "public",
      publicReportId: report.id,
      fallbackLat: latitude,
      fallbackLng: longitude,
      ownerId: "anonymous",
    });
    const { error: updateError } = await supabase
      .from("citizen_reports")
      .update({ processing_status: "completed", processing_error: null })
      .eq("id", report.id);
    if (updateError) throw updateError;

    return NextResponse.json({ success: true, reportId: report.id, status: "completed", count: detections.length });
  } catch (error) {
    console.error("Public report processing failed:", error);
    if (createdReportId && adminClient) {
      const { error: statusError } = await adminClient
        .from("citizen_reports")
        .update({ processing_status: "failed", processing_error: "Report processing failed." })
        .eq("id", createdReportId);
      if (statusError) console.error("Public report failure status could not be saved:", statusError.code);
    } else if (uploadedStoragePath && adminClient) {
      const { error: cleanupError } = await adminClient.storage.from("pothole-images").remove([uploadedStoragePath]);
      if (cleanupError) console.error("Unlinked public report evidence could not be removed:", cleanupError.message);
    }
    return NextResponse.json({
      error: "The report could not be processed. Check the server logs.",
      detail: error instanceof Error ? error.message : "The report could not be processed.",
    }, { status: 500 });
  }
}