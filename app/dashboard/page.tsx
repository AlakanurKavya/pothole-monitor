import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { yoloHealth } from "@/lib/yolo-client";
import { YoloHealthStatus } from "@/components/YoloHealthStatus";
import { MaintenanceBadge, PriorityBadge, SeverityBadge, VerificationBadge } from "@/components/StatusBadge";
import { displayPriority } from "@/lib/media";
import type { PotholeLocation } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const [
    { count: publicReports },
    { count: vehicleDetections },
    { count: publicDetections },
    { count: detectionCount },
    { count: pendingDetections },
    { count: rejectedDetections },
    { data: locations },
    { data: recent },
    health,
  ] = await Promise.all([
    supabase.from("citizen_reports").select("*", { count: "exact", head: true }),
    supabase.from("ai_detections").select("*", { count: "exact", head: true }).eq("source", "vehicle"),
    supabase.from("ai_detections").select("*", { count: "exact", head: true }).eq("source", "public"),
    supabase.from("ai_detections").select("*", { count: "exact", head: true }),
    supabase.from("ai_detections").select("*", { count: "exact", head: true }).eq("verification_status", "pending"),
    supabase.from("ai_detections").select("*", { count: "exact", head: true }).eq("verification_status", "rejected"),
    supabase.from("pothole_locations").select("*").order("updated_at", { ascending: false }),
    supabase
      .from("ai_detections")
      .select("id, created_at, source, confidence, verification_status, pothole_locations(*)")
      .order("created_at", { ascending: false })
      .limit(12),
    yoloHealth(),
  ]);

  const locs = (locations ?? []) as PotholeLocation[];
  const verified = locs.filter((l) => l.verification_status === "verified" || l.verification_status === "corrected").length;
  const high = locs.filter((l) => l.severity === "high").length;
  const medium = locs.filter((l) => l.severity === "medium").length;
  const low = locs.filter((l) => l.severity === "low").length;
  const highPriority = locs.filter((l) => l.computed_priority === "high").length;
  const maintenance = {
    reported: locs.filter((l) => l.maintenance_status === "reported").length,
    verified: locs.filter((l) => l.maintenance_status === "verified").length,
    assigned: locs.filter((l) => l.maintenance_status === "assigned").length,
    under_repair: locs.filter((l) => l.maintenance_status === "under_repair").length,
    repaired: locs.filter((l) => l.maintenance_status === "repaired").length,
  };
  const hasPotholes = locs.length > 0;
  const hasDetections = (recent ?? []).length > 0;

  const byLocation = Object.entries(
    locs.reduce<Record<string, number>>((acc, loc) => {
      const key = loc.address || `${loc.latitude.toFixed(3)}, ${loc.longitude.toFixed(3)}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  ).slice(0, 6);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Operations centre</p>
        <h2 className="text-3xl font-semibold">National road condition dashboard</h2>
        <p className="text-slate-600 mt-1">
          AI detections are advisory until a government official verifies, rejects, or corrects them.
        </p>
        <YoloHealthStatus initialHealth={health} />
      </header>
      <section className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card label="Total reports" value={String((publicReports ?? 0) + (vehicleDetections ?? 0))} />
        <Card label="Vehicle detections" value={String(vehicleDetections ?? 0)} />
        <Card label="Public reports" value={String(publicReports ?? 0)} />
        <Card label="Public detections" value={String(publicDetections ?? 0)} />
        <Card label="Verified potholes" value={String(verified)} />
        <Card label="False detections" value={String(rejectedDetections ?? 0)} />
        <Card label="Pending verification" value={String(pendingDetections ?? 0)} />
        <Card label="High-priority potholes" value={String(highPriority)} />
        <Card label="Under repair" value={String(maintenance.under_repair)} />
        <Card label="Repaired potholes" value={String(maintenance.repaired)} />
        <Card label="AI detections" value={String(detectionCount ?? 0)} />
        <Card label="Severity mix" value={`${high} / ${medium} / ${low} (H/M/L)`} />
        <Link href="/dashboard/map" className="rounded-lg border bg-white p-4 shadow-sm hover:border-[#c9a227]">
          <p className="text-xs uppercase tracking-wide text-slate-500">Map</p>
          <p className="text-lg font-semibold mt-2">Open geospatial view</p>
        </Link>
      </section>
      <section className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white border rounded-lg p-5">
          <h3 className="font-semibold mb-3">Potholes by location</h3>
          {hasPotholes ? (
            <ul className="divide-y text-sm">
              {byLocation.map(([name, n]) => (
                <li key={name} className="py-2 flex justify-between gap-4">
                  <span>{name}</span>
                  <span className="font-semibold">{n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">No pothole reports available.</p>
          )}
        </div>
        <div className="bg-white border rounded-lg p-5">
          <h3 className="font-semibold mb-3">Maintenance status</h3>
          <ul className="text-sm space-y-2">
            {Object.entries(maintenance).map(([k, v]) => (
              <li key={k} className="flex justify-between">
                <MaintenanceBadge value={k} />
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="bg-white border rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b">
          <h3 className="font-semibold">Recent AI detections</h3>
        </div>
        {hasDetections ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="p-3">Pothole</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">AI confidence</th>
                  <th className="p-3">Verification</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {(recent ?? []).map((row) => {
                  const locRaw = (row as { pothole_locations?: PotholeLocation | PotholeLocation[] | null })
                    .pothole_locations;
                  const location = Array.isArray(locRaw) ? locRaw[0] : locRaw;
                  return (
                    <tr key={row.id} className="border-t">
                      <td className="p-3 font-medium">{location?.public_id ?? "Ungrouped"}</td>
                      <td className="p-3 font-semibold">{row.source === "public" ? "PUBLIC" : "VEHICLE"}</td>
                      <td className="p-3">{(Number(row.confidence) * 100).toFixed(0)}%</td>
                      <td className="p-3">
                        <VerificationBadge status={row.verification_status ?? location?.verification_status ?? "pending"} />
                      </td>
                      <td className="p-3">
                        {location ? (
                          <PriorityBadge
                            value={displayPriority(location.computed_priority, location.priority_override).toLowerCase()}
                          />
                        ) : null}
                      </td>
                      <td className="p-3">
                        <Link className="underline" href={`/dashboard/verify/${row.id}`}>
                          Review
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5 text-sm text-slate-600">No AI detections available.</div>
        )}
      </section>
      <section className="bg-white border rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b">
          <h3 className="font-semibold">Official pothole register</h3>
        </div>
        {hasPotholes ? (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="p-3">ID</th>
                <th className="p-3">Location</th>
                <th className="p-3">Reports</th>
                <th className="p-3">Vehicle</th>
                <th className="p-3">Severity</th>
                <th className="p-3">Verification</th>
                <th className="p-3">Maintenance</th>
              </tr>
            </thead>
            <tbody>
              {locs.map((loc) => (
                <tr key={loc.id} className="border-t">
                  <td className="p-3">
                    <Link className="font-semibold underline" href={`/dashboard/potholes/${loc.id}`}>
                      {loc.public_id}
                    </Link>
                  </td>
                  <td className="p-3">{loc.address || `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`}</td>
                  <td className="p-3">{loc.public_report_count}</td>
                  <td className="p-3">{loc.vehicle_detection_count}</td>
                  <td className="p-3">
                    <SeverityBadge value={loc.severity} />
                  </td>
                  <td className="p-3">
                    <VerificationBadge status={loc.verification_status} />
                  </td>
                  <td className="p-3">
                    <MaintenanceBadge value={loc.maintenance_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-5 text-sm text-slate-600">No potholes have been reported yet.</div>
        )}
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-2xl font-semibold mt-2">{value}</p>
    </div>
  );
}
