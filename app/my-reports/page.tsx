import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import type { PublicReport } from "@/lib/types";

export default async function MyReportsPage() {
  const { user } = await getSessionProfile();
  if (!user) {
    return (
      <div className="space-y-2">
        <h2 className="text-3xl font-semibold">My submitted reports</h2>
        <p className="text-slate-600">Anonymous reports are not associated with an account.</p>
      </div>
    );
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("citizen_reports")
    .select("*")
    .eq("reporter_id", user.id)
    .order("reported_at", { ascending: false });
  const reports = (data ?? []) as PublicReport[];

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-3xl font-semibold">My submitted reports</h2>
        <p className="text-slate-600">Read-only. Processing status is informational; official verification happens on the government dashboard.</p>
      </header>
      {error ? <p role="alert" className="text-sm text-rose-700">Report history could not be loaded. Confirm the citizen report history migration is applied.</p> : null}
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="p-3">Report ID</th>
              <th className="p-3">When</th>
              <th className="p-3">GPS</th>
              <th className="p-3">AI processing</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-medium">{r.report_code}</td>
                <td className="p-3">{new Date(r.reported_at).toLocaleString()}</td>
                <td className="p-3">
                  {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}
                </td>
                <td className="p-3 uppercase">{r.processing_status.replace("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
