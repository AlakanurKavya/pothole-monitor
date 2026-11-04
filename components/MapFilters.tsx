"use client";

import { useMemo, useState } from "react";
import { PotholeMapClient } from "@/components/PotholeMapClient";
import type { AiDetection, PotholeLocation } from "@/lib/types";

export function MapFilters({
  locations,
  detections,
  imageUrls,
}: {
  locations: PotholeLocation[];
  detections: AiDetection[];
  imageUrls: Record<string, string>;
}) {
  const [severity, setSeverity] = useState("all");
  const [verification, setVerification] = useState("verified");
  const [source, setSource] = useState("all");
  const [maintenance, setMaintenance] = useState("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return locations.filter((loc) => {
      if (severity !== "all" && loc.severity !== severity) return false;
      if (verification !== "all" && loc.verification_status !== verification) return false;
      if (maintenance !== "all" && loc.maintenance_status !== maintenance) return false;
      if (query) {
        const hay = `${loc.public_id} ${loc.address ?? ""} ${loc.latitude} ${loc.longitude}`.toLowerCase();
        if (!hay.includes(query.toLowerCase())) return false;
      }
      if (source !== "all") {
        const related = detections.filter((d) => d.pothole_location_id === loc.id);
        if (!related.some((d) => d.source === source)) return false;
      }
      return true;
    });
  }, [locations, detections, severity, verification, maintenance, query, source]);

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-5 gap-3 bg-white border rounded-lg p-4">
        <Select label="Severity" value={severity} onChange={setSeverity} options={["all", "high", "medium", "low"]} />
        <Select
          label="Verification"
          value={verification}
          onChange={setVerification}
          options={["all", "pending", "verified", "corrected", "rejected"]}
        />
        <Select label="Source" value={source} onChange={setSource} options={["all", "public", "vehicle"]} />
        <Select
          label="Maintenance"
          value={maintenance}
          onChange={setMaintenance}
          options={["all", "reported", "verified", "assigned", "under_repair", "repaired"]}
        />
        <label className="text-sm">
          <span className="block text-xs uppercase tracking-wide text-slate-500">Location</span>
          <input
            className="mt-1 w-full border rounded px-2 py-2"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ID or address"
          />
        </label>
      </div>
      {filtered.length ? (
        <PotholeMapClient locations={filtered} detections={detections} imageUrls={imageUrls} />
      ) : (
        <div className="rounded border border-dashed bg-white p-6 text-sm text-slate-600">No pothole locations available.</div>
      )}
      {filtered.length ? (
        <p className="text-sm text-slate-600">{filtered.length} pothole location(s) shown. Default view highlights government-verified records.</p>
      ) : null}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="text-sm">
      <span className="block text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <select className="mt-1 w-full border rounded px-2 py-2" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
