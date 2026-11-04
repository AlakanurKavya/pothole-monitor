"use client";

import { useEffect, useState } from "react";

type HealthStatus = { ok: boolean; mode?: string; model_loaded?: boolean };

export function YoloHealthStatus({ initialHealth }: { initialHealth: HealthStatus }) {
  const [health, setHealth] = useState(initialHealth);

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;

    async function refreshHealth() {
      try {
        const response = await fetch("/api/vehicle/yolo-health", { cache: "no-store" });
        const payload = await response.json();
        if (!disposed) {
          if (!response.ok) {
            setHealth({ ok: false, mode: typeof payload.mode === "string" ? payload.mode : "disconnected" });
          } else {
            setHealth({
              ok: payload.ok === true && payload.modelLoaded === true,
              mode: typeof payload.mode === "string" ? payload.mode : undefined,
              model_loaded: payload.modelLoaded === true,
            });
          }
        }
      } catch {
        if (!disposed) setHealth({ ok: false, mode: "disconnected" });
      } finally {
        if (!disposed) timer = window.setTimeout(() => void refreshHealth(), 10000);
      }
    }

    timer = window.setTimeout(() => void refreshHealth(), 10000);
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const message = health.ok
    ? `YOLOv8 API connected (${health.mode ?? "unknown"} mode).`
    : health.mode === "unavailable"
      ? "YOLOv8 model is unavailable. FastAPI is reachable, but the trained model is not loaded."
      : health.mode === "invalid_response"
        ? "YOLOv8 API returned an invalid health response."
        : "YOLOv8 API is not connected. Uploads are still stored; detections remain pending with status AI disconnected.";

  return (
    <p className={`mt-3 rounded border px-3 py-2 text-sm ${health.ok ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
      {message}
    </p>
  );
}