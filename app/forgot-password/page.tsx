"use client";

import { useRef, useState } from "react";
import { AuthCard, Field } from "@/components/AuthCard";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const requestInProgress = useRef(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (requestInProgress.current) return;

    setMessage(null);
    setError(null);

    const normalizedEmail = email.trim();
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    requestInProgress.current = true;
    setSending(true);

    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });

      if (resetError) {
        if (resetError.status === 429 || /email.*rate limit|rate limit.*email/i.test(resetError.message)) {
          setError("Supabase is rate-limiting reset emails. Wait at least 60 seconds before retrying. Its built-in email sender allows only 2 Auth emails per project per hour, so you may need to wait for that limit to reset or configure custom SMTP in Supabase. No new link was sent.");
        } else {
          setError(resetError.message);
        }
      } else {
        setMessage("If that email belongs to an account, a reset link has been sent. Open it in this same browser and use the same site address you used here.");
      }
    } catch {
      setError("Could not request a reset email. Please try again.");
    } finally {
      requestInProgress.current = false;
      setSending(false);
    }
  }

  return (
    <AuthCard title="Reset your password">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" type="email" value={email} onChange={setEmail} />
        {message ? <p className="text-emerald-700 text-sm">{message}</p> : null}
        {error ? <p className="text-rose-700 text-sm">{error}</p> : null}
        <button disabled={sending} className="w-full bg-[#0e1c33] text-white py-2 rounded font-semibold disabled:opacity-60">
          {sending ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="text-sm mt-4">
        <a className="text-blue-700 underline" href="/login">Back to sign in</a>
      </p>
    </AuthCard>
  );
}