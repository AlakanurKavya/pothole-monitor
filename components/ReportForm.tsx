"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const LocationMap = dynamic(
  async () => {
    const { MapContainer, TileLayer, useMap, useMapEvents } = await import("react-leaflet");

    function MapPicker({ lat, lng, onSelect }: { lat: number | null; lng: number | null; onSelect: (lat: number, lng: number) => void }) {
      const center: [number, number] = lat != null && lng != null ? [lat, lng] : [28.6139, 77.209];

      function MapController() {
        const map = useMap();
        useEffect(() => {
          map.setView(center, map.getZoom());
        }, [center, map]);
        return null;
      }

      function MapClickHandler() {
        useMapEvents({
          click(event) {
            onSelect(event.latlng.lat, event.latlng.lng);
          },
        });
        return null;
      }

      return (
        <div className="h-64 w-full overflow-hidden rounded-md border border-slate-200">
          <MapContainer center={center} zoom={14} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapController />
            <MapClickHandler />
          </MapContainer>
        </div>
      );
    }

    return MapPicker;
  },
  { ssr: false },
);

export function ReportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [geoMsg, setGeoMsg] = useState("Detecting your location…");
  const [status, setStatus] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  const applyLocation = (nextLat: number, nextLng: number) => {
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
    setLat(nextLat);
    setLng(nextLng);
    setGeoMsg("Location detected.");
  };

  const requestCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoMsg("Location access is not available on this browser. Use the map or type a fallback location.");
      return;
    }

    setGeoMsg("Requesting browser location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyLocation(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setGeoMsg("Location permission denied. Use the map to choose the pothole location or type a fallback value.");
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  };

  useEffect(() => {
    requestCurrentLocation();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setStatus("Please attach a pothole photo or video first.");
      return;
    }

    const validLat = Number.isFinite(lat) && lat !== null && lat >= -90 && lat <= 90;
    const validLng = Number.isFinite(lng) && lng !== null && lng >= -180 && lng <= 180;
    if (!validLat || !validLng) {
      setStatus("Location is required. Please allow browser access, select a point on the map, or enter a fallback location.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("latitude", String(lat));
    formData.append("longitude", String(lng));

    try {
      setStatus("Sending report to the AI backend…");
      const res = await fetch("/api/public-reports", {
        method: "POST",
        body: formData,
      });

      const rawText = await res.text();
      let payload: any = {};
      if (rawText) {
        try {
          payload = JSON.parse(rawText);
        } catch {
          payload = { rawText };
        }
      }

      if (!res.ok) {
        const errorDetail =
          payload?.detail ||
          payload?.error ||
          payload?.message ||
          (typeof payload?.rawText === "string" ? payload.rawText : "") ||
          "Public report request failed.";

        console.warn("Public report request failed", { status: res.status, detail: errorDetail });
        setStatus(errorDetail);
        return;
      }

      const fallbackMessage = payload?.detail ||
        "Report saved, but AI processing is unavailable and no detections were created. It is not queued for automatic retry.";

      setStatus(payload.status === "ai_disconnected"
        ? fallbackMessage
        : `Report submitted successfully. AI detections: ${payload.count ?? 0}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown network error";
      console.error("Public report request failed", { message });
      setStatus("Could not submit the report. Check the web server and try again.");
    }
  }

  return (
    <form onSubmit={submit} className="bg-white border rounded-lg p-6 space-y-4 max-w-xl">
      <label className="block text-sm">
        Pothole photo or video
        <input
          className="mt-1 w-full"
          type="file"
          accept="image/*,video/*"
          capture="environment"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          required
        />
      </label>

      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        <p className="font-medium">Location status</p>
        <p className="mt-1">{geoMsg}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={requestCurrentLocation} className="rounded bg-[#0e1c33] px-3 py-2 text-white text-xs font-semibold">
            Use My Current Location
          </button>
          <button type="button" onClick={() => setMapOpen((v) => !v)} className="rounded border border-slate-300 bg-white px-3 py-2 text-slate-700 text-xs font-semibold">
            {mapOpen ? "Hide Map" : "Select Location on Map"}
          </button>
        </div>
      </div>

      {mapOpen ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">Click on the map to choose the pothole location.</p>
          <LocationMap
            lat={lat}
            lng={lng}
            onSelect={(nextLat, nextLng) => {
              applyLocation(nextLat, nextLng);
              setMapOpen(false);
            }}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          Latitude (optional fallback)
          <input
            className="mt-1 w-full border rounded px-3 py-2"
            type="number"
            step="any"
            value={lat ?? ""}
            onChange={(e) => {
              const value = e.target.value === "" ? null : Number(e.target.value);
              setLat(value);
              if (value !== null) setGeoMsg("Location set manually.");
            }}
            placeholder="Auto-filled if available"
          />
        </label>
        <label className="text-sm">
          Longitude (optional fallback)
          <input
            className="mt-1 w-full border rounded px-3 py-2"
            type="number"
            step="any"
            value={lng ?? ""}
            onChange={(e) => {
              const value = e.target.value === "" ? null : Number(e.target.value);
              setLng(value);
              if (value !== null) setGeoMsg("Location set manually.");
            }}
            placeholder="Auto-filled if available"
          />
        </label>
      </div>

      <button className="bg-[#0e1c33] text-white px-4 py-2 rounded font-semibold">Submit report</button>
      {status ? <p className="text-sm text-slate-700">{status}</p> : null}
    </form>
  );
}
