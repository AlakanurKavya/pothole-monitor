import type { VerificationStatus, MaintenanceStatus, SeverityLevel, PriorityLevel } from "@/lib/types";

const verificationClass: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900 border border-amber-300",
  verified: "bg-emerald-100 text-emerald-900 border border-emerald-300",
  corrected: "bg-sky-100 text-sky-900 border border-sky-300",
  rejected: "bg-rose-100 text-rose-900 border border-rose-300",
};

const verificationLabel: Record<string, string> = {
  pending: "AI DETECTED",
  verified: "GOVERNMENT VERIFIED",
  corrected: "GOVERNMENT CORRECTED",
  rejected: "REJECTED",
};

export function VerificationBadge({ status }: { status: VerificationStatus | string }) {
  return <span className={`badge ${verificationClass[status] ?? "bg-slate-200"}`}>{verificationLabel[status] ?? status}</span>;
}

export function SeverityBadge({ value }: { value: SeverityLevel | string | null }) {
  if (!value) return <span className="badge bg-slate-200 text-slate-700">UNASSIGNED</span>;
  const map: Record<string, string> = {
    high: "bg-red-700 text-white",
    medium: "bg-orange-500 text-white",
    low: "bg-slate-600 text-white",
  };
  return <span className={`badge ${map[value]}`}>{value} severity</span>;
}

export function MaintenanceBadge({ value }: { value: MaintenanceStatus | string }) {
  const map: Record<string, string> = {
    reported: "bg-slate-200 text-slate-800",
    verified: "bg-indigo-100 text-indigo-900",
    assigned: "bg-blue-100 text-blue-900",
    under_repair: "bg-yellow-100 text-yellow-900",
    repaired: "bg-green-100 text-green-900",
  };
  return <span className={`badge ${map[value] ?? "bg-slate-200"}`}>{String(value).replace("_", " ")}</span>;
}

export function PriorityBadge({ value }: { value: PriorityLevel | string }) {
  const map: Record<string, string> = {
    high: "bg-[#8b1e1e] text-white",
    medium: "bg-[#b45309] text-white",
    low: "bg-[#334155] text-white",
  };
  return <span className={`badge ${map[value] ?? "bg-slate-700 text-white"}`}>{value} priority</span>;
}
