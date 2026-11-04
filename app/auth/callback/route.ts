import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  console.info("[auth/callback] reached");
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const isRecoveryToken = type === "recovery" && Boolean(tokenHash);
  console.info("[auth/callback] recovery credentials present", {
    codePresent: Boolean(code),
    recoveryTokenPresent: isRecoveryToken,
  });

  const callbackError = url.searchParams.get("error_code") ?? url.searchParams.get("error");
  if (callbackError) {
    const status = /expired/i.test(callbackError) ? "expired" : "invalid";
    return NextResponse.redirect(new URL(`/reset-password?error=${status}`, url.origin));
  }

  if (!code && !isRecoveryToken) {
    return NextResponse.redirect(new URL("/reset-password?error=missing_code", url.origin));
  }

  const destination = url.searchParams.get("next") === "/reset-password" ? "/reset-password" : "/";
  const response = NextResponse.redirect(new URL(destination, url.origin));
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as never),
          );
        },
      },
    },
  );

  const { data, error } = isRecoveryToken
    ? await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash! })
    : await supabase.auth.exchangeCodeForSession(code!);
  if (error) {
    console.error("[auth/callback] code exchange failed", { errorCode: error.code ?? "unknown" });
    const status = error.code === "pkce_code_verifier_not_found"
      ? "verifier_missing"
      : /expired/i.test(`${error.code ?? ""} ${error.message}`)
        ? "expired"
        : "exchange_failed";
    response.headers.set("Location", new URL(`/reset-password?error=${status}`, url.origin).toString());
    return response;
  }

  console.info("[auth/callback] code exchange succeeded", {
    sessionPresent: Boolean(data.session),
    userPresent: Boolean(data.user),
  });
  return response;
}
