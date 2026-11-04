import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VerificationForm } from "@/components/VerificationForm";
import { signedOrDemoUrl } from "@/lib/media";
import { signedImageMap } from "@/lib/signed";
import type { AiDetection, BBox, PotholeLocation, VerificationRecord } from "@/lib/types";

export default async function VerifyPage({ params }: { params: Promise<{ detectionId: string }> }) {
  const { detectionId } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_detections")
    .select("*, pothole_locations(*)")
    .eq("id", detectionId)
    .maybeSingle();
  if (!data) notFound();

  const locRaw = data.pothole_locations as PotholeLocation | PotholeLocation[] | null;
  const location = Array.isArray(locRaw) ? locRaw[0] : locRaw;
  const detection = data as AiDetection;
  const urls = await signedImageMap([detection.frame_image_path]);
  const imageUrl = signedOrDemoUrl(detection.frame_image_path, urls[detection.frame_image_path]);

  const { data: history } = await supabase
    .from("verification_records")
    .select("*")
    .eq("ai_detection_id", detectionId)
    .order("created_at", { ascending: false });
  const latestCorrected =
    ((history ?? []) as VerificationRecord[]).find((h) => h.corrected_bbox)?.corrected_bbox ?? null;

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Official review</p>
        <h2 className="text-3xl font-semibold">
          Detection {detection.id.slice(0, 8)} {location ? `· ${location.public_id}` : ""}
        </h2>
        <p className="text-sm text-slate-600">
          Source {detection.source} · AI confidence {(detection.confidence * 100).toFixed(0)}% (not used as severity) ·{" "}
          {detection.latitude}, {detection.longitude}
        </p>
      </header>
      <VerificationForm
        detection={detection}
        location={location ?? null}
        imageUrl={imageUrl}
        latestCorrected={latestCorrected as BBox | null}
      />
    </div>
  );
}
