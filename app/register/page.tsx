"use client";

import { useState } from "react";
import { AuthCard, Field } from "@/components/AuthCard";
import { createClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setSubmitting(true);

    try {
      const supabase = createClient();
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (signUpError) {
        setError("Unable to create an account. Please check your details and try again.");
        return;
      }

      setMessage("If registration can proceed, check your email to confirm your account, then sign in.");
      setFullName("");
      setEmail("");
      setPassword("");
    } catch {
      setError("Unable to create an account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Create a public account">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Full name" type="text" value={fullName} onChange={setFullName} />
        <Field label="Email" type="email" value={email} onChange={setEmail} />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
        {message ? <p className="text-emerald-700 text-sm">{message}</p> : null}
        {error ? <p className="text-rose-700 text-sm">{error}</p> : null}
        <button disabled={submitting} className="w-full bg-[#0e1c33] text-white py-2 rounded font-semibold disabled:opacity-60">
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="text-sm mt-4">
        <a className="text-blue-700 underline" href="/login">Back to sign in</a>
      </p>
    </AuthCard>
  );
}
