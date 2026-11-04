export type PublicAppUrlIssue =
  | "PUBLIC_APP_URL_MISSING"
  | "PUBLIC_APP_URL_INVALID"
  | "PUBLIC_APP_URL_HTTPS_REQUIRED"
  | "PUBLIC_APP_URL_NOT_PUBLIC";

export type PublicAppUrlValidation =
  | { ok: true; origin: string }
  | { ok: false; code: PublicAppUrlIssue; message: string };

export function isPairingToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function validatePublicAppUrl(value: undefined): { ok: false; code: PublicAppUrlIssue; message: string };
export function validatePublicAppUrl(value: string): PublicAppUrlValidation;
export function validatePublicAppUrl(value: string | undefined): PublicAppUrlValidation {
  const configured = value?.trim();
  if (!configured) {
    return {
      ok: false,
      code: "PUBLIC_APP_URL_MISSING",
      message: "Set NEXT_PUBLIC_APP_URL to a phone-reachable HTTPS origin before creating a pairing.",
    };
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return {
      ok: false,
      code: "PUBLIC_APP_URL_INVALID",
      message: "NEXT_PUBLIC_APP_URL must be a valid HTTPS origin without a path, query, or fragment.",
    };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      code: "PUBLIC_APP_URL_HTTPS_REQUIRED",
      message: "NEXT_PUBLIC_APP_URL must use HTTPS because the mobile page requests camera and GPS access.",
    };
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    return {
      ok: false,
      code: "PUBLIC_APP_URL_INVALID",
      message: "NEXT_PUBLIC_APP_URL must be an origin only, without credentials, path, query, or fragment.",
    };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const octets = hostname.split(".").map(Number);
  const isIpv4 = octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255);
  const isPrivateIpv4 = isIpv4 && (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
      hostname === "::1" || hostname === "0.0.0.0" || isPrivateIpv4) {
    return {
      ok: false,
      code: "PUBLIC_APP_URL_NOT_PUBLIC",
      message: "NEXT_PUBLIC_APP_URL must be a publicly reachable HTTPS hostname, not localhost or a private LAN address.",
    };
  }

  return { ok: true, origin: url.origin };
}

export function createMobilePairingUrl(origin: string, token: string): string {
  if (!isPairingToken(token)) throw new Error("Pairing token format is invalid.");
  const validation = validatePublicAppUrl(origin);
  if (!validation.ok) throw new Error(validation.message);
  const url = new URL("/vehicle-camera", validation.origin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export function readPairingTokenFromHash(fragment: string): string | null {
  const value = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!value) return null;

  const token = new URLSearchParams(value).get("token");
  if (token && isPairingToken(token)) return token;

  // Accept unexpired QR links created by the previous bare-fragment format.
  return !value.includes("=") && isPairingToken(value) ? value : null;
}
