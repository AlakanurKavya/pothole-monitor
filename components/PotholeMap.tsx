"use client";

import { useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AiDetection, PotholeLocation } from "@/lib/types";
import { MaintenanceBadge, PriorityBadge, SeverityBadge, VerificationBadge } from "@/components/StatusBadge";
import { displayPriority, signedOrDemoUrl } from "@/lib/media";
import Link from "next/link";

const icon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export function PotholeMap({
  locations,
  detections,
  imageUrls,
}: {
  locations: PotholeLocation[];
  detections: AiDetection[];
  imageUrls: Record<string, string>;
}) {
  const center = useMemo<[number, number]>(() => {
    if (!locations.length) return [0, 0];
    return [locations[0].latitude, locations[0].longitude];
  }, [locations]);

  if (!locations.length) {
    return <div className="h-[540px] grid place-items-center border bg-white rounded text-sm text-slate-600">No pothole locations available.</div>;
  }

  return (
    <MapContainer center={center} zoom={12} className="h-[540px] w-full rounded border border-slate-300" scrollWheelZoom>
      <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {locations.map((loc) => {
        const related = detections.filter((d) => d.pothole_location_id === loc.id);
        const imgPath = related[0]?.frame_image_path;
        const img = imgPath ? signedOrDemoUrl(imgPath, imageUrls[imgPath]) : "";
        const conf = related[0]?.confidence;
        return (
          <Marker key={loc.id} position={[loc.latitude, loc.longitude]} icon={icon}>
            <Popup>
              <div className="w-56 space-y-1 text-sm">
                <p className="font-bold">{loc.public_id}</p>
                {img ? <img src={img} alt="" className="h-24 w-full object-cover rounded" /> : null}
                <p>{loc.address || `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`}</p>
                <VerificationBadge status={loc.verification_status} />
                <SeverityBadge value={loc.severity} />
                <PriorityBadge value={displayPriority(loc.computed_priority, loc.priority_override).toLowerCase()} />
                <MaintenanceBadge value={loc.maintenance_status} />
                <p>
                  Reports {loc.public_report_count} · Vehicle {loc.vehicle_detection_count}
                </p>
                {conf != null ? <p>AI confidence {(conf * 100).toFixed(0)}% (informational)</p> : null}
                <Link className="text-[#163056] underline" href={`/dashboard/potholes/${loc.id}`}>
                  Open record
                </Link>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
