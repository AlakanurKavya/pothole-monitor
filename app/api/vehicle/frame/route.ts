import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { persistDetections } from "@/lib/persist-detections";
import { detectImage, YoloRequestError } from "@/lib/yolo-client";
import type { YoloDetection } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let frame: File;
  let sessionId: string;
  let latitude: number | null;
  let longitude: number | null;
  let capturedAt: string;
  let frameNumber: number;
  let videoTimestamp: number;

  try {
    const form = await request.formData();
    const submittedFrame = form.get("file");
    sessionId = String(form.get("sessionId") ?? "");
    const lat = form.get("latitude");
    const lng = form.get("longitude");
    latitude = lat === null || lat === "" ? null : Number(lat);
    longitude = lng === null || lng === "" ? null : Number(lng);
    capturedAt = String(form.get("capturedAt") ?? "");
    frameNumber = Number(form.get("frameNumber"));
    videoTimestamp = Number(form.get("videoTimestamp"));
    if (!(submittedFrame instanceof File) || !submittedFrame.size || !sessionId) {
      return NextResponse.json({ error: "A camera frame and session are required." }, { status: 400 });
    }
    frame = submittedFrame;
  } catch {
    return NextResponse.json({ error: "Invalid camera frame." }, { status: 400 });
  }

  if (!frame.type.startsWith("image/") || frame.size > 2 * 1024 * 1024 ||
      (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) ||
      ((latitude === null) !== (longitude === null)) || !Number.isFinite(Date.parse(capturedAt)) ||
      !Number.isInteger(frameNumber) || frameNumber < 0 || !Number.isFinite(videoTimestamp) || videoTimestamp < 0) {
    return NextResponse.json({ error: "Camera frame metadata is invalid." }, { status: 400 });
  }

  try {
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const { data: profile } = await userClient.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "government") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const supabase = createAdminClient();
    const { data: session, error: sessionError } = await supabase
      .from("vehicle_uploads")
      .select("id, operator_id, processing_status, confidence_threshold")
      .eq("id", sessionId)
      .eq("operator_id", user.id)
      .maybeSingle();
    if (sessionError || !session || session.processing_status !== "processing") {
      return NextResponse.json({ error: "Camera session was not found." }, { status: 404 });
    }

    const { data: pairing, error: pairingError } = await supabase
      .from("vehicle_camera_pairings")
      .select("id")
      .eq("monitoring_session_id", sessionId)
      .eq("operator_id", user.id)
      .not("joined_at", "is", null)
      .is("closed_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (pairingError) throw pairingError;
    if (!pairing) return NextResponse.json({ error: "The paired mobile camera is disconnected or expired." }, { status: 409 });

    const frameBytes = Buffer.from(await frame.arrayBuffer());
    const frameHash = createHash("sha256").update(frameBytes).digest("hex");
    const { data: duplicate, error: duplicateError } = await supabase
      .from("ai_detections")
      .select("id")
      .eq("vehicle_upload_id", sessionId)
      .eq("frame_hash", frameHash)
      .limit(1)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) return NextResponse.json({ count: 0, positive: false, duplicate: true });

    const detections = await detectImage(frame, `vehicle-frame-${frameNumber}.jpg`, latitude, longitude, request.signal);
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });

    const { data: activeSession, error: activeSessionError } = await supabase
      .from("vehicle_uploads")
      .select("processing_status")
      .eq("id", sessionId)
      .eq("operator_id", user.id)
      .maybeSingle();
    if (activeSessionError) throw activeSessionError;
    if (activeSession?.processing_status !== "processing") {
      return NextResponse.json({ error: "Monitoring has stopped." }, { status: 409 });
    }

    const { data: activePairing, error: activePairingError } = await supabase
      .from("vehicle_camera_pairings")
      .select("id")
      .eq("id", pairing.id)
      .eq("monitoring_session_id", sessionId)
      .is("closed_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (activePairingError) throw activePairingError;
    if (!activePairing) return NextResponse.json({ error: "The mobile pairing closed during frame processing." }, { status: 409 });

    const threshold = Number(session.confidence_threshold);
    const candidates = detections.filter((detection) =>
      detection.class_name?.toLowerCase() === "pothole" && detection.confidence >= threshold,
    );
    if (!candidates.length) return NextResponse.json({ count: 0, positive: false });

    const timestampedDetections: YoloDetection[] = candidates.map((detection, detectionIndex) => ({
      ...detection,
      frame_number: frameNumber,
      timestamp: videoTimestamp,
      captured_at: new Date(capturedAt).toISOString(),
      lat: latitude,
      lng: longitude,
      frame_hash: frameHash,
      detection_index: detectionIndex,
    }));
    await persistDetections(supabase, timestampedDetections, {
      source: "vehicle",
      vehicleUploadId: sessionId,
      fallbackLat: latitude,
      fallbackLng: longitude,
      ownerId: "vehicle",
    });
    return NextResponse.json({ count: timestampedDetections.length, positive: true });
  } catch (error) {
    console.error("Vehicle frame processing failed:", error);
    if (error instanceof YoloRequestError && error.status === 503) {
      return NextResponse.json({ error: "YOLO service unavailable: the model is not loaded.", code: "YOLO_SERVICE_UNAVAILABLE" }, { status: 503 });
    }
    return NextResponse.json({ error: "Camera frame processing failed." }, { status: 502 });
  }
}