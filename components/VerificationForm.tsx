"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BoundingBoxEditor } from "@/components/BoundingBoxEditor";
import { VerificationBadge } from "@/components/StatusBadge";
import { submitVerification } from "@/app/actions/government";
import type { AiDetection, BBox, MaintenanceStatus, PotholeLocation, SeverityLevel } from "@/lib/types";

export function VerificationForm({
  detection,
  location,
  imageUrl,
  latestCorrected,
}: {
  detection: AiDetection;
  location: PotholeLocation | null;
  imageUrl: string;
  latestCorrected: BBox | null;
}) {
  const router = useRouter();
  const aiBox = detection.bbox;
  const [mode, setMode] = useState<"verified" | "rejected" | "corrected">("verified");
  const [box, setBox] = useState<BBox>(latestCorrected ?? aiBox);
  const [severity, setSeverity] = useState<SeverityLevel>(location?.severity ?? "medium");
  const [maintenance, setMaintenance] = useState<MaintenanceStatus>(location?.maintenance_status ?? "verified");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const result = await submitVerification({
      detectionId: detection.id,
      locationId: location?.id ?? detection.pothole_location_id,
      action: mode,
      originalBbox: aiBox,
      correctedBbox: mode === "corrected" ? box : null,
      notes,
      severity: mode === "rejected" ? location?.severity ?? null : severity,
      maintenance: mode === "rejected" ? location?.maintenance_status ?? null : maintenance,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <div className="bg-white border rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <VerificationBadge status={detection.verification_status ?? "pending"} />
          <span className="text-sm text-slate-600">Original AI bounding box is retained. Corrections are stored separately.</span>
        </div>
        {imageUrl ? (
          <BoundingBoxEditor
            imageUrl={imageUrl}
            aiBox={aiBox}
            value={box}
            onChange={setBox}
            editable={mode === "corrected"}
            overlayBox={latestCorrected}
          />
        ) : (
          <p className="text-sm">No frame image available for this demo record. Upload live media to review pixels.</p>
        )}
      </div>
      <aside className="bg-white border rounded-lg p-4 space-y-4 h-fit">
        <h3 className="font-semibold">Government verification</h3>
        <label className="flex gap-2 text-sm">
          <input type="radio" checked={mode === "verified"} onChange={() => setMode("verified")} />
          A. Correct Detection
        </label>
        <label className="flex gap-2 text-sm">
          <input type="radio" checked={mode === "rejected"} onChange={() => setMode("rejected")} />
          B. False Detection / Reject
        </label>
        <label className="flex gap-2 text-sm">
          <input type="radio" checked={mode === "corrected"} onChange={() => setMode("corrected")} />
          C. Modify Detection
        </label>
        {mode === "corrected" ? (
          <p className="text-xs text-slate-600">Drag the amber box or its handle to adjust the government-corrected bounding box.</p>
        ) : null}
        {mode !== "rejected" ? (
          <>
            <label className="block text-sm">
              Severity
              <select
                className="mt-1 w-full border rounded px-2 py-2"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as SeverityLevel)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="block text-sm">
              Maintenance status
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
          </>
        ) : null}
        <label className="block text-sm">
          Notes
          <textarea className="mt-1 w-full border rounded px-2 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error ? <p className="text-rose-700 text-sm">{error}</p> : null}
        <button disabled={saving} onClick={save} className="w-full bg-[#0e1c33] text-white py-2 rounded font-semibold">
          {saving ? "Saving…" : "Record official decision"}
        </button>
      </aside>
    </div>
  );
}
