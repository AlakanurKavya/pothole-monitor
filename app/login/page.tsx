"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureGovernmentUser } from "@/app/actions/government";
import { createClient } from "@/lib/supabase/client";
import { AuthCard, Field } from "@/components/AuthCard";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("password_reset") === "success") {
      setNotice("Password updated. You can now sign in with your new password.");
      return;
    }

    const accessError = params.get("error");
    if (accessError === "profile_missing") {
      setError("Your account profile is missing. Please contact the administrator.");
    } else if (accessError === "government_access") {
      setError("Your account does not have government access. Please contact the administrator.");
    } else if (accessError === "access_check_failed") {
      setError("Could not verify this account's access. Please try again.");
    } else if (accessError === "auth_configuration") {
      setError("Government sign-in is not configured. Set the Supabase project URL and anon key on the server, then restart the app.");
    } else if (accessError === "auth_check_failed") {
      setError("Could not contact Supabase to verify your session. Check the project URL and network, then try again.");
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const supabase = createClient();
      const normalizedEmail = email.trim();
      let authData: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>> | null = null;
      const signInAttempt = async () => supabase.auth.signInWithPassword({ email: normalizedEmail, password });

      authData = await signInAttempt();

      if (authData.error) {
        const code = authData.error.code?.toLowerCase();
        const message = authData.error.message.toLowerCase();
        const shouldAutoCreate = code === "invalid_credentials" || code === "user_not_found" || (!code && message.includes("invalid"));

        if (code === "email_not_confirmed" || (!code && message.includes("email not confirmed"))) {
          setError("Your email is not confirmed. Please check your email and confirm your account before logging in.");
          return;
        }

        if (shouldAutoCreate) {
          const bootstrap = await ensureGovernmentUser(normalizedEmail, password);
          if (!bootstrap.ok) {
            setError(bootstrap.error || "Unable to find or create the government account for this email.");
            return;
          }

          authData = await signInAttempt();
        }

        if (authData.error) {
          const codeAfterRetry = authData.error.code?.toLowerCase();
          if (codeAfterRetry === "invalid_credentials" || codeAfterRetry === "user_not_found") {
            setError("Invalid email or password.");
          } else {
            setError(authData.error.message || "Unable to sign in. Please try again.");
          }
          return;
        }
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authData.data.user.id)
        .maybeSingle();

      if (profileError) {
        console.error("Government profile lookup failed:", profileError.code);
        await supabase.auth.signOut();
        setError("Sign-in succeeded, but the government profile could not be verified. Confirm the profiles table and authenticated SELECT policy are installed.");
        return;
      }

      if (!profile) {
        await supabase.auth.signOut();
        setError("Your account profile is missing. Please contact the administrator.");
        return;
      }

      const requestedPath = new URLSearchParams(window.location.search).get("next");
      const wantsVehicle = requestedPath === "/vehicle";
      const wantsDashboard = requestedPath === "/dashboard" || requestedPath?.startsWith("/dashboard/");

      if (profile.role === "vehicle_operator") {
        await supabase.auth.signOut();
        setError("Vehicle operators do not sign in. A government administrator must create a temporary mobile camera pairing.");
        return;
      }

      if ((wantsDashboard || wantsVehicle) && profile.role !== "government") {
        await supabase.auth.signOut();
        setError("Only government administrators can access protected dashboards.");
        return;
      }

      const destination = profile.role === "government" ? "/vehicle" : "/report";

      router.replace(destination);
      router.refresh();
    } catch (caught) {
      console.error("Government sign-in failed:", caught);
      setError(caught instanceof Error && caught.message.includes("Supabase is not configured")
        ? "Government sign-in is not configured. Set the Supabase project URL and anon key, then restart the app."
        : "Could not connect to Supabase. Check the project URL and network, then try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Official access">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" type="email" value={email} onChange={setEmail} />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
        {notice ? <p className="text-emerald-700 text-sm">{notice}</p> : null}
        {error ? <p className="text-rose-700 text-sm">{error}</p> : null}
        <button disabled={submitting} className="w-full bg-[#0e1c33] text-white py-2 rounded font-semibold disabled:opacity-60">
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="text-sm mt-3">
        <a className="text-blue-700 underline" href="/forgot-password">Forgot password?</a>
      </p>
      <p className="text-sm mt-2">
        <a className="text-blue-700 underline" href="/register">Create a public account</a>
      </p>
      <p className="text-sm mt-4 text-slate-600">
        Government administrators manage reports and vehicle monitoring. Mobile operators scan a temporary pairing QR code and do not sign in. Public pothole reports remain available without signing in.
      </p>
    </AuthCard>
  );
}
