export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 shadow-sm rounded-lg p-8">
        <p className="text-[10px] tracking-[0.2em] uppercase text-[#c9a227] font-bold">Road Condition Monitoring</p>
        <h1 className="text-2xl font-semibold mt-2 mb-6">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="mt-1 w-full border border-slate-300 rounded px-3 py-2"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </label>
  );
}
