"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCard, Field } from "@/components/AuthCard";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<"checking" | "ready" | "missing">("checking");
  const displayedError = error ?? (recoveryStatus === "missing"
    ? "This recovery session has expired. Request a new password reset link."
    : null);

  useEffect(() => {
    const callbackError = new URLSearchParams(window.location.search).get("error");
    if (callbackError === "expired") {
      setError("This recovery link has expired. Request a new password reset link.");
    } else if (callbackError === "missing_code") {
      setError("The recovery link is missing its code. Request a new password reset link.");
    } else if (callbackError === "invalid") {
      setError("This recovery link is invalid. Request a new password reset link.");
    } else if (callbackError === "exchange_failed") {
      setError("We could not verify this recovery link. Request a new password reset link.");
    } else if (callbackError === "verifier_missing") {
      setError("This reset link was opened in a different browser or its recovery cookie is missing. Request a new link here and open it in this same browser, using the same site address.");
    } else {
      const supabase = createClient();
      let active = true;
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (!active) return;
        if (event === "PASSWORD_RECOVERY" || event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          console.info("[auth/reset-password] auth state", {
            event,
            sessionPresent: Boolean(session),
          });
          setRecoveryStatus(session ? "ready" : "missing");
        }
      });

      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (!active) return;
        console.info("[auth/reset-password] initial session check", { sessionPresent: Boolean(session) });
        setRecoveryStatus(session ? "ready" : "missing");
      }).catch(() => {
        if (active) setRecoveryStatus("missing");
      });

      return () => {
        active = false;
        subscription.unsubscribe();
      };
    }
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    if (recoveryStatus !== "ready") {
      setError(recoveryStatus === "checking"
        ? "Please wait while we verify your recovery session."
        : "This recovery session has expired. Request a new password reset link.");
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("This recovery session has expired. Request a new password reset link.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      await supabase.auth.signOut();
      router.replace("/login?password_reset=success");
    } catch {
      setError("Could not update the password. Please request a new recovery link and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="New password" type="password" value={password} onChange={setPassword} />
        <Field label="Confirm new password" type="password" value={confirmPassword} onChange={setConfirmPassword} />
        {displayedError ? <p className="text-rose-700 text-sm">{displayedError}</p> : null}
        <button disabled={saving || recoveryStatus !== "ready"} className="w-full bg-[#0e1c33] text-white py-2 rounded font-semibold disabled:opacity-60">
          {saving ? "Updating…" : "Update password"}
        </button>
      </form>
      <p className="text-sm mt-4">
        <a className="text-blue-700 underline" href="/login">Back to sign in</a>
      </p>
    </AuthCard>
  );
}