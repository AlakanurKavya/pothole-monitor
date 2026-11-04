import { createClient } from "@/lib/supabase/server";
import { MapFilters } from "@/components/MapFilters";
import { signedImageMap } from "@/lib/signed";
import type { AiDetection, PotholeLocation } from "@/lib/types";

export default async function MapPage() {
  const supabase = await createClient();
  const [{ data: locations }, { data: detections }] = await Promise.all([
    supabase.from("pothole_locations").select("*"),
    supabase.from("ai_detections").select("*"),
  ]);
  const dets = (detections ?? []) as AiDetection[];
  const imageUrls = await signedImageMap(dets.map((d) => d.frame_image_path));

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Geospatial operations</p>
        <h2 className="text-3xl font-semibold">Pothole map</h2>
      </header>
      <MapFilters
        locations={(locations ?? []) as PotholeLocation[]}
        detections={dets}
        imageUrls={imageUrls}
      />
    </div>
  );
}
