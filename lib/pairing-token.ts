import { createHash } from "node:crypto";

export function isPairingToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function hashPairingToken(token: string): string {
  if (!isPairingToken(token)) throw new Error("Pairing token format is invalid.");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isPairingExpired(expiresAt: string, closedAt: string | null, now = Date.now()): boolean {
  const expiry = Date.parse(expiresAt);
  return Boolean(closedAt) || !Number.isFinite(expiry) || expiry <= now;
}
