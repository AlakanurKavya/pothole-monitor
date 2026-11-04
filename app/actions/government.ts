"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { BBox, MaintenanceStatus, PriorityLevel, SeverityLevel, VerificationStatus } from "@/lib/types";

export async function ensureGovernmentUser(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  const allowlist = (process.env.GOVERNMENT_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (!allowlist.includes(normalizedEmail)) {
    return { ok: false, error: "This email is not configured for government access." };
  }

  const admin = createAdminClient();
  const { data: userPage, error: lookupError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

  if (lookupError) {
    return { ok: false, error: lookupError.message };
  }

  const existingUser = userPage.users.find((user) => user.email?.toLowerCase() === normalizedEmail) ?? null;
  const userId = existingUser?.id ?? null;
  const profileId = userId ?? null;
  if (!profileId) {
    const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: normalizedEmail.split("@")[0] || "Government user",
      },
    });

    if (createError) {
      return { ok: false, error: createError.message || "Unable to create the government account." };
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: createdUser.user.id,
      full_name: createdUser.user.user_metadata?.full_name ?? normalizedEmail.split("@")[0],
      role: "government",
    }, { onConflict: "id" });

    if (profileError) {
      return { ok: false, error: profileError.message || "Unable to assign the government role." };
    }

    return { ok: true };
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: profileId,
    full_name: existingUser?.user_metadata?.full_name ?? normalizedEmail.split("@")[0],
    role: "government",
  }, { onConflict: "id" });

  if (profileError) {
    return { ok: false, error: profileError.message || "Unable to restore the government access record." };
  }

  return { ok: true };
}

export async function submitVerification(input: {
  detectionId: string;
  locationId: string | null;
  action: Exclude<VerificationStatus, "pending">;
  originalBbox: BBox;
  correctedBbox?: BBox | null;
  notes?: string;
  severity?: SeverityLevel | null;
  maintenance?: MaintenanceStatus | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "government") return { error: "Forbidden" };

  const { error: verifyError } = await supabase.from("verification_records").insert({
    ai_detection_id: input.detectionId,
    pothole_location_id: input.locationId,
    verified_by: user.id,
    action: input.action,
    original_bbox: input.originalBbox,
    corrected_bbox: input.action === "corrected" ? input.correctedBbox : null,
    notes: input.notes ?? null,
  });
  if (verifyError) return { error: verifyError.message };

  const admin = createAdminClient();
  const { error: detectionError } = await admin
    .from("ai_detections")
    .update({ verification_status: input.action })
    .eq("id", input.detectionId);
  if (detectionError) return { error: detectionError.message };

  if (input.locationId) {
    const patch: Record<string, unknown> = {
      verification_status: input.action,
      updated_at: new Date().toISOString(),
    };
    if (input.severity) patch.severity = input.severity;
    if (input.maintenance) patch.maintenance_status = input.maintenance;
    if (input.action === "rejected") {
      patch.verification_status = "rejected";
    }
    const { error } = await supabase.from("pothole_locations").update(patch).eq("id", input.locationId);
    if (error) return { error: error.message };

    if (input.maintenance) {
      await supabase.from("maintenance_records").insert({
        pothole_location_id: input.locationId,
        status: input.maintenance,
        updated_by: user.id,
        notes: input.notes ?? null,
      });
    }
    await supabase.rpc("recompute_pothole_priority", { loc_id: input.locationId });
  }

  return { ok: true };
}

export async function updateLocationControls(input: {
  locationId: string;
  severity?: SeverityLevel | null;
  maintenance?: MaintenanceStatus | null;
  priorityOverride?: PriorityLevel | null;
  address?: string | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "government") return { error: "Forbidden" };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.severity !== undefined) patch.severity = input.severity;
  if (input.maintenance !== undefined) patch.maintenance_status = input.maintenance;
  if (input.priorityOverride !== undefined) patch.priority_override = input.priorityOverride;
  if (input.address !== undefined) patch.address = input.address;

  const { error } = await supabase.from("pothole_locations").update(patch).eq("id", input.locationId);
  if (error) return { error: error.message };

  if (input.maintenance) {
    await supabase.from("maintenance_records").insert({
      pothole_location_id: input.locationId,
      status: input.maintenance,
      updated_by: user.id,
    });
  }
  await supabase.rpc("recompute_pothole_priority", { loc_id: input.locationId });
  return { ok: true };
}
