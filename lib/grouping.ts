import type { SupabaseClient } from "@supabase/supabase-js";
import type { DetectionSource } from "@/lib/types";

export async function assignLocation(
  supabase: SupabaseClient,
  lat: number | null | undefined,
  lng: number | null | undefined,
  source: DetectionSource,
  address?: string | null,
) {
  if (lat == null || lng == null) return null;
  const { data, error } = await supabase.rpc("assign_or_create_pothole_location", {
    in_lat: lat,
    in_lng: lng,
    in_source: source,
    in_address: address ?? null,
    radius_m: 40,
  });
  if (error) throw error;
  return data as string | null;
}
