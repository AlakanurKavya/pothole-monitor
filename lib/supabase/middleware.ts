import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isDashboardPath = path === "/dashboard" || path.startsWith("/dashboard/");
  const isVehiclePath = path === "/vehicle" || path.startsWith("/vehicle/") ||
    path === "/vehicle-upload" || path.startsWith("/vehicle-upload/");
  const needsAuth = isDashboardPath || isVehiclePath;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (needsAuth) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/login";
      redirect.searchParams.set("error", "auth_configuration");
      return NextResponse.redirect(redirect);
    }
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options as never),
        );
      },
    },
  });

  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    if (needsAuth) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/login";
      redirect.searchParams.set("error", "auth_check_failed");
      return NextResponse.redirect(redirect);
    }
    return response;
  }

  if (!user && needsAuth) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", path);
    return NextResponse.redirect(redirect);
  }

  if (user && (isDashboardPath || isVehiclePath)) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const isGovernmentUser = profile?.role === "government";

    if (isDashboardPath && (!profile || error || !isGovernmentUser)) {
      const redirect = new URL("/login", request.url);
      redirect.searchParams.set(
        "error",
        error ? "access_check_failed" : profile ? "government_access" : "profile_missing",
      );
      return NextResponse.redirect(redirect);
    }

    if (isVehiclePath && (!profile || error || !isGovernmentUser)) {
      const redirect = new URL("/login", request.url);
      redirect.searchParams.set(
        "error",
        error ? "access_check_failed" : profile ? "government_access" : "profile_missing",
      );
      return NextResponse.redirect(redirect);
    }
  }

  return response;
}
