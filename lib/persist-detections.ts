import type { SupabaseClient } from "@supabase/supabase-js";
import { assignLocation } from "@/lib/grouping";
import type { YoloDetection } from "@/lib/types";

export async function persistDetections(
  supabase: SupabaseClient,
  detections: YoloDetection[],
  opts: {
    source: "public" | "vehicle";
    publicReportId?: string;
    vehicleUploadId?: string;
    fallbackLat?: number | null;
    fallbackLng?: number | null;
    ownerId: string;
  },
) {
  let publicLocationId: string | null | undefined;
  for (const detection of detections) {
    const lat = detection.lat ?? opts.fallbackLat ?? null;
    const lng = detection.lng ?? opts.fallbackLng ?? null;
    const bytes = Buffer.from(detection.frame_image_b64, "base64");
    const framePath = `${opts.ownerId}/frames/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage.from("pothole-images").upload(framePath, bytes, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (uploadError) throw uploadError;
    let locationId: string | null;
    if (opts.source === "public") {
      if (publicLocationId === undefined) {
        publicLocationId = await assignLocation(supabase, lat, lng, opts.source);
      }
      locationId = publicLocationId;
    } else {
      locationId = await assignLocation(supabase, lat, lng, opts.source);
    }
    const { data: inserted, error: insertError } = await supabase.from("ai_detections").upsert({
      source: opts.source,
      vehicle_upload_id: opts.vehicleUploadId ?? null,
      public_report_id: opts.publicReportId ?? null,
      pothole_location_id: locationId,
      frame_image_path: framePath,
      bbox: detection.bbox,
      confidence: detection.confidence,
      frame_number: detection.frame_number,
      video_timestamp: detection.timestamp,
      captured_at: detection.captured_at ?? null,
      latitude: lat,
      longitude: lng,
      frame_hash: detection.frame_hash ?? null,
      detection_index: detection.detection_index ?? null,
    }, {
      onConflict: "vehicle_upload_id,frame_hash,detection_index",
      ignoreDuplicates: true,
    }).select("id");
    if (insertError) throw insertError;
    if (!inserted?.length) {
      const { error: removeError } = await supabase.storage.from("pothole-images").remove([framePath]);
      if (removeError) throw removeError;
    }
  }
}
