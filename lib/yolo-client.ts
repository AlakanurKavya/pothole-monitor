import "server-only";
import type { YoloDetection } from "@/lib/types";

const YOLO_API_URL = (process.env.YOLO_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const healthTimeoutMs = 5000;

export class YoloRequestError extends Error {
  constructor(public readonly status: number) {
    super(`YOLO request failed (${status}).`);
    this.name = "YoloRequestError";
  }
}

export async function yoloHealth(): Promise<{ ok: boolean; mode?: string; model_loaded?: boolean }> {
  try {
    const res = await fetch(`${YOLO_API_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(healthTimeoutMs),
    });
    if (!res.ok) return { ok: false, mode: res.status === 503 ? "unavailable" : "disconnected" };

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      return { ok: false, mode: "invalid_response" };
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return { ok: false, mode: "invalid_response" };
    }

    const health = payload as { status?: unknown; mode?: unknown; model_loaded?: unknown };
    if (typeof health.status !== "string" || typeof health.model_loaded !== "boolean") {
      return { ok: false, mode: "invalid_response" };
    }
    const modelLoaded = health.model_loaded;
    return {
      ok: health.status === "ok" && modelLoaded,
      mode: typeof health.mode === "string" ? health.mode : undefined,
      model_loaded: modelLoaded,
    };
  } catch {
    return { ok: false, mode: "disconnected" };
  }
}

export async function detectImage(
  file: Blob,
  filename: string,
  lat?: number | null,
  lng?: number | null,
  signal?: AbortSignal,
): Promise<YoloDetection[]> {
  const body = new FormData();
  body.append("file", file, filename);
  if (lat != null) body.append("lat", String(lat));
  if (lng != null) body.append("lng", String(lng));
  const res = await fetch(`${YOLO_API_URL}/detect/image`, {
    method: "POST",
    body,
    signal,
  });
  if (!res.ok) {
    throw new YoloRequestError(res.status);
  }
  const json = await res.json();
  return json.detections ?? [];
}

export async function detectVideo(
  file: Blob,
  filename: string,
  gpsTrack?: { lat: number; lng: number }[] | null,
): Promise<YoloDetection[]> {
  const body = new FormData();
  body.append("file", file, filename);
  if (gpsTrack) body.append("gps_track", JSON.stringify(gpsTrack));
  const res = await fetch(`${YOLO_API_URL}/detect/video`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    throw new YoloRequestError(res.status);
  }
  const json = await res.json();
  return json.detections ?? [];
}
