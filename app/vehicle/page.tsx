import { VehicleCameraDashboard } from "@/components/VehicleCameraDashboard";

export default function VehiclePage() {
  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Field capture</p>
        <h2 className="text-3xl font-semibold">Vehicle monitoring dashboard</h2>
        <p className="text-slate-600">
          Government administrators pair a phone here. The QR opens a separate mobile page; the laptop camera is never requested.
        </p>
      </header>
      <VehicleCameraDashboard />
    </div>
  );
}
