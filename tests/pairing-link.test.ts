import assert from "node:assert/strict";
import test from "node:test";
import {
  createMobilePairingUrl,
  isPairingToken,
  readPairingTokenFromHash,
  validatePublicAppUrl,
} from "../lib/pairing-link.ts";
import { hashPairingToken, isPairingExpired } from "../lib/pairing-token.ts";

const token = "Abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

test("accepts a public HTTPS origin and rejects missing, insecure, and local origins", () => {
  assert.deepEqual(validatePublicAppUrl("https://camera.example.com"), {
    ok: true,
    origin: "https://camera.example.com",
  });
  assert.equal((validatePublicAppUrl(undefined) as any).code, "PUBLIC_APP_URL_MISSING");
  assert.equal((validatePublicAppUrl("http://camera.example.com") as any).code, "PUBLIC_APP_URL_HTTPS_REQUIRED");
  assert.equal((validatePublicAppUrl("https://localhost:3000") as any).code, "PUBLIC_APP_URL_NOT_PUBLIC");
  assert.equal((validatePublicAppUrl("https://192.168.1.20") as any).code, "PUBLIC_APP_URL_NOT_PUBLIC");
});

test("creates a mobile HTTPS URL with a named token fragment", () => {
  const mobileUrl = createMobilePairingUrl("https://camera.example.com", token);
  const parsed = new URL(mobileUrl);
  assert.equal(parsed.origin, "https://camera.example.com");
  assert.equal(parsed.pathname, "/vehicle-camera");
  assert.equal(parsed.hash, `#token=${token}`);
});

test("reads named tokens, supports the previous fragment format, and diagnoses missing tokens", () => {
  assert.equal(readPairingTokenFromHash(`#token=${token}`), token);
  assert.equal(readPairingTokenFromHash(`#${token}`), token);
  assert.equal(readPairingTokenFromHash(""), null);
  assert.equal(readPairingTokenFromHash("#token="), null);
  assert.equal(readPairingTokenFromHash("#other=value"), null);
});

test("rejects malformed pairing token formats", () => {
  assert.equal(isPairingToken(token), true);
  assert.equal(isPairingToken("short"), false);
  assert.equal(isPairingToken(`${token}=`), false);
});

test("hashes the exact token deterministically and expires closed or elapsed pairings", () => {
  assert.equal(hashPairingToken(token), "5eeb0a18a403856dad72d780cf618c52f5d3b74136a70278ed76792ee8aec689");
  assert.equal(isPairingExpired("2030-01-01T00:00:00.000Z", null, Date.parse("2029-01-01T00:00:00.000Z")), false);
  assert.equal(isPairingExpired("2020-01-01T00:00:00.000Z", null, Date.now()), true);
  assert.equal(isPairingExpired("2030-01-01T00:00:00.000Z", "2029-01-01T00:00:00.000Z", Date.now()), true);
});
