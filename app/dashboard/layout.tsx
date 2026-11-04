import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await getSessionProfile();
  if (!profile) redirect("/login?error=profile_missing");
  if (profile.role !== "government") redirect("/login?error=government_access");
  return <AppShell profile={profile}>{children}</AppShell>;
}
