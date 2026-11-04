import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0e1c33] text-white">
      <header className="border-b border-white/10 px-8 py-5">
        <div>
          <p className="text-[11px] tracking-[0.25em] uppercase text-[#c9a227]">
            Government of the Public Works Department
          </p>
          <h1 className="text-xl md:text-2xl font-semibold mt-1">
            AI-Driven Autonomous Pothole Detection and Road Condition Monitoring System
          </h1>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-16 grid md:grid-cols-3 gap-6">
        <Card href="/login" title="Government dashboard" body="Verify AI detections, assign severity, and manage maintenance progress." />
        <Card href="/vehicle" title="Government vehicle monitoring" body="Sign in to enter a Vehicle ID and generate a temporary QR code. The phone opens a separate camera pairing page." />
        <Card href="/report" title="Public pothole report" body="Capture a pothole photo and GPS from any device; no login or registration is required." />
      </main>
    </div>
  );
}

function Card({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="bg-white/5 border border-white/10 rounded-lg p-6 hover:bg-white/10">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-white/70 mt-2">{body}</p>
    </Link>
  );
}
