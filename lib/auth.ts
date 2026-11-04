import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export async function getSessionProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null as Profile | null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, vehicle_id")
    .eq("id", user.id)
    .maybeSingle();

  return { supabase, user, profile: profile as Profile | null };
}

export function homeForRole(role?: string | null) {
  if (role === "government") return "/dashboard";
  if (role === "public") return "/report";
  return "/login?error=government_access";
}
