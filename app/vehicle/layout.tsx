import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getSessionProfile } from "@/lib/auth";

export default async function VehicleLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await getSessionProfile();
  if (!profile) redirect("/login?error=profile_missing");
  if (profile.role !== "government") {
    redirect("/login?error=government_access");
  }
  return <AppShell profile={profile}>{children}</AppShell>;
}
