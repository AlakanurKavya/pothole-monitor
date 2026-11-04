import { ReportForm } from "@/components/ReportForm";

export default function ReportPage() {
  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Public reporting</p>
        <h2 className="text-3xl font-semibold">Report a pothole</h2>
        <p className="text-slate-600 max-w-2xl">
          Photo or video → browser location detection → YOLOv8 analysis → saved GPS report → government dashboard.
          Only government officials can verify or change the official record.
        </p>
      </header>
      <ReportForm />
    </div>
  );
}
