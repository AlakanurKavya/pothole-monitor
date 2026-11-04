"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { Profile } from "@/lib/types";

export function AppShell({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  const links =
    profile.role === "government"
      ? [
          ["/vehicle", "Vehicle monitoring"],
          ["/dashboard", "Operations dashboard"],
          ["/dashboard/map", "Geospatial map"],
        ]
      : [
            ["/report", "Report a pothole"],
            ["/my-reports", "My reports"],
          ];

  return (
    <div className="min-h-screen grid md:grid-cols-[260px_1fr]">
      <aside className="bg-[#0e1c33] text-white p-6 flex flex-col gap-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#c9a227]">
            Public Works Department
          </p>
          <h1 className="mt-2 text-lg font-semibold leading-snug">
            Road Condition Monitoring System
          </h1>
        </div>
        <nav className="flex flex-col gap-1 text-sm">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="rounded px-3 py-2 hover:bg-white/10">
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto text-xs text-white/70">
          <p>{profile.full_name || "Signed in"}</p>
          <p className="uppercase tracking-wide mt-1">{profile.role.replace("_", " ")}</p>
          <SignOut />
        </div>
      </aside>
      <main className="p-4 md:p-8">{children}</main>
    </div>
  );
}

function SignOut() {
  const router = useRouter();
  async function out() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <button className="mt-3 underline" onClick={out} type="button">
      Sign out
    </button>
  );
}
