"use client";

import { useState } from "react";
import { updateLocationControls } from "@/app/actions/government";
import type { MaintenanceStatus, PotholeLocation, PriorityLevel, SeverityLevel } from "@/lib/types";

export function LocationControls({ location }: { location: PotholeLocation }) {
  const [severity, setSeverity] = useState<SeverityLevel | "">(location.severity ?? "");
  const [maintenance, setMaintenance] = useState<MaintenanceStatus>(location.maintenance_status);
  const [priority, setPriority] = useState<PriorityLevel | "">(location.priority_override ?? "");
  const [address, setAddress] = useState(location.address ?? "");
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    const result = await updateLocationControls({
      locationId: location.id,
      severity: severity || null,
      maintenance,
      priorityOverride: priority || null,
      address,
    });
    setMsg(result.error ?? "Saved official record");
  }

  return (
    <div className="bg-white border rounded-lg p-5 grid md:grid-cols-2 gap-4">
      <label className="text-sm">
        Address / location
        <input className="mt-1 w-full border rounded px-2 py-2" value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="text-sm">
        Severity
        <select className="mt-1 w-full border rounded px-2 py-2" value={severity} onChange={(e) => setSeverity(e.target.value as SeverityLevel)}>
          <option value="">Unassigned</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label className="text-sm">
        Maintenance
        <select
          className="mt-1 w-full border rounded px-2 py-2"
          value={maintenance}
          onChange={(e) => setMaintenance(e.target.value as MaintenanceStatus)}
        >
          <option value="reported">Reported</option>
          <option value="verified">Verified</option>
          <option value="assigned">Assigned</option>
          <option value="under_repair">Under Repair</option>
          <option value="repaired">Repaired</option>
        </select>
      </label>
      <label className="text-sm">
        Government priority override
        <select className="mt-1 w-full border rounded px-2 py-2" value={priority} onChange={(e) => setPriority(e.target.value as PriorityLevel)}>
          <option value="">Use computed priority ({location.computed_priority})</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <div className="md:col-span-2">
        <button onClick={save} className="bg-[#0e1c33] text-white px-4 py-2 rounded font-semibold">
          Update official record
        </button>
        {msg ? <span className="ml-3 text-sm">{msg}</span> : null}
      </div>
    </div>
  );
}
