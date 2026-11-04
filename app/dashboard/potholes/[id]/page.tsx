import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LocationControls } from "@/components/LocationControls";
import { MaintenanceBadge, PriorityBadge, SeverityBadge, VerificationBadge } from "@/components/StatusBadge";
import { displayPriority, signedOrDemoUrl } from "@/lib/media";
import { signedImageMap } from "@/lib/signed";
import type { AiDetection, PotholeLocation, VerificationRecord } from "@/lib/types";

export default async function PotholeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: location } = await supabase.from("pothole_locations").select("*").eq("id", id).maybeSingle();
  if (!location) notFound();
  const loc = location as PotholeLocation;
  const [{ data: dets }, { data: verifications }, { data: maintenance }] = await Promise.all([
    supabase.from("ai_detections").select("*").eq("pothole_location_id", id).order("created_at", { ascending: false }),
    supabase.from("verification_records").select("*").eq("pothole_location_id", id).order("created_at", { ascending: false }),
    supabase.from("maintenance_records").select("*").eq("pothole_location_id", id).order("created_at", { ascending: false }),
  ]);
  const detections = (dets ?? []) as AiDetection[];
  const urls = await signedImageMap(detections.map((d) => d.frame_image_path));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap gap-3 items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Official pothole file</p>
          <h2 className="text-3xl font-semibold">{loc.public_id}</h2>
          <p className="text-slate-600">
            {loc.address || "No address recorded"} · {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <VerificationBadge status={loc.verification_status} />
          <SeverityBadge value={loc.severity} />
          <PriorityBadge value={displayPriority(loc.computed_priority, loc.priority_override).toLowerCase()} />
          <MaintenanceBadge value={loc.maintenance_status} />
        </div>
      </header>
      <p className="text-sm bg-white border rounded p-3">
        Grouped evidence: <strong>{loc.public_report_count}</strong> public reports and{" "}
        <strong>{loc.vehicle_detection_count}</strong> vehicle detections within ~40 metres. YOLO confidence is stored
        with each detection but is not used as danger or severity.
      </p>
      <LocationControls location={loc} />
      <section className="bg-white border rounded-lg p-5">
        <h3 className="font-semibold mb-3">Linked detections</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {detections.map((d) => {
            const src = signedOrDemoUrl(d.frame_image_path, urls[d.frame_image_path]);
            return (
              <article key={d.id} className="border rounded p-3 text-sm space-y-2">
                {src ? <img src={src} alt="" className="h-40 w-full object-cover rounded" /> : <div className="h-40 bg-slate-100 grid place-items-center">No image</div>}
                <p>Source {d.source} · conf {(d.confidence * 100).toFixed(0)}%</p>
                <p>
                  AI box x={d.bbox.x.toFixed(2)} y={d.bbox.y.toFixed(2)} w={d.bbox.w.toFixed(2)} h={d.bbox.h.toFixed(2)}
                </p>
                <Link className="underline" href={`/dashboard/verify/${d.id}`}>
                  Verify this detection
                </Link>
              </article>
            );
          })}
        </div>
      </section>
      <section className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-lg p-5 text-sm">
          <h3 className="font-semibold mb-2">Verification audit trail</h3>
          <ul className="space-y-2">
            {((verifications ?? []) as VerificationRecord[]).map((v) => (
              <li key={v.id} className="border-b pb-2">
                {v.action} · {new Date(v.created_at).toLocaleString()}
                {v.notes ? <p>{v.notes}</p> : null}
              </li>
            ))}
            {!verifications?.length ? <li>No government verification yet.</li> : null}
          </ul>
        </div>
        <div className="bg-white border rounded-lg p-5 text-sm">
          <h3 className="font-semibold mb-2">Maintenance history</h3>
          <ul className="space-y-2">
            {(maintenance ?? []).map((m: { id: string; status: string; created_at: string }) => (
              <li key={m.id}>
                {m.status} · {new Date(m.created_at).toLocaleString()}
              </li>
            ))}
            {!maintenance?.length ? <li>No maintenance updates yet.</li> : null}
          </ul>
        </div>
      </section>
    </div>
  );
}
