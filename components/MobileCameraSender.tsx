"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { vehicleRtcConfiguration, waitForIceGatheringComplete } from "@/lib/vehicle-rtc";

type Pairing = { pairingId: string; vehicleId: string; signalTopic: string; mobileCloseToken: string };
type SignalMessage = { kind: "ready" | "offer" | "answer" | "close"; sdp?: RTCSessionDescriptionInit };
type GpsSample = { type: "sample"; capturedAt: string; fixCapturedAt: string; latitude: number; longitude: number; accuracy: number | null };
type GpsStatus = "requesting" | "connected" | "permission_denied" | "unavailable" | "stopped";
type GpsMessage = GpsSample | { type: "status"; status: GpsStatus };

export function MobileCameraSender({ token }: { token: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const gpsChannelRef = useRef<RTCDataChannel | null>(null);
  const signalChannelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const gpsWatchRef = useRef<number | null>(null);
  const gpsSampleTimerRef = useRef<number | null>(null);
  const readyTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const redeemedRef = useRef(false);
  const latestGpsRef = useRef<GpsSample | null>(null);
  const latestGpsStatusRef = useRef<GpsStatus>("requesting");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [pairingStatus, setPairingStatus] = useState("Checking pairing link…");
  const [cameraStatus, setCameraStatus] = useState("Camera not started");
  const [gpsStatus, setGpsStatus] = useState("GPS not connected");
  const [error, setError] = useState<string | null>(null);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [joining, setJoining] = useState(false);

  function getSecureContextError(): string | null {
    if (typeof window === "undefined") return "This page must be opened in a browser.";
    if (!window.isSecureContext || window.location.protocol !== "https:") {
      return "This mobile camera page must be opened over HTTPS from a trusted tunnel. Plain HTTP on 10.10.34.26 is not allowed for camera access.";
    }
    if (!("mediaDevices" in navigator) || !navigator.mediaDevices?.getUserMedia) {
      return "This browser does not support camera capture. Use a modern mobile browser with rear-camera access enabled.";
    }
    if (!("RTCPeerConnection" in window)) {
      return "This browser does not support WebRTC. Use a current Android or iPhone browser.";
    }
    return null;
  }

  async function redeemPairing() {
    if (!token) {
      setPairingStatus("Pairing link is missing or expired.");
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const response = await fetch("/api/vehicle/pairing/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Pairing could not be completed.");
      setPairing(payload);
      setPairingStatus(`Paired with vehicle ${payload.vehicleId}. Start the rear camera when ready.`);
      window.history.replaceState(null, "", window.location.pathname);
    } catch (joinError) {
      setPairingStatus(joinError instanceof Error ? joinError.message : "Pairing link is invalid or expired.");
      setError(joinError instanceof Error ? joinError.message : "Pairing link is invalid or expired.");
    } finally {
      setJoining(false);
    }
  }

  async function sendSignal(message: SignalMessage) {
    const channel = signalChannelRef.current;
    if (!channel) return;
    const result = await channel.send({ type: "broadcast", event: "signal", payload: message });
    if (result !== "ok") throw new Error("Secure signalling is temporarily unavailable.");
  }

  async function renewPairing(pairingInfo: Pairing) {
    try {
      const response = await fetch("/api/vehicle/pairing/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingId: pairingInfo.pairingId, mobileCloseToken: pairingInfo.mobileCloseToken }),
      });
      const payload = await response.json();
      if (response.status === 410) {
        setError(payload.error ?? "Pairing expired. Scan a new QR code.");
        await stopCamera();
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Pairing heartbeat failed.");
    } catch (heartbeatError) {
      setPairingStatus("Signalling lease renewal failed; retrying…");
      setError(heartbeatError instanceof Error ? heartbeatError.message : "Pairing heartbeat failed.");
    }
  }

  async function handleSignal(message: SignalMessage) {
    if (message.kind === "close") {
      await stopCamera(false);
      return;
    }
    const peer = peerRef.current;
    if (!peer || message.kind !== "offer" || !message.sdp) return;
    try {
      if (readyTimerRef.current !== null) window.clearInterval(readyTimerRef.current);
      readyTimerRef.current = null;
      await peer.setRemoteDescription(message.sdp);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGatheringComplete(peer);
      await sendSignal({ kind: "answer", sdp: peer.localDescription ?? undefined });
      setPairingStatus("Connecting to the vehicle dashboard…");
    } catch (signalError) {
      setError(signalError instanceof Error ? signalError.message : "WebRTC negotiation failed.");
    }
  }

  function sendGps(sample: GpsSample) {
    latestGpsRef.current = sample;
    const dataChannel = gpsChannelRef.current;
    if (dataChannel?.readyState === "open") dataChannel.send(JSON.stringify(sample));
  }

  function sendGpsStatus(status: GpsStatus) {
    latestGpsStatusRef.current = status;
    const dataChannel = gpsChannelRef.current;
    if (dataChannel?.readyState === "open") dataChannel.send(JSON.stringify({ type: "status", status }));
  }

  function startGps() {
    setGpsStatus("Requesting GPS permission…");
    sendGpsStatus("requesting");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsStatus("GPS is unavailable in this browser.");
      sendGpsStatus("unavailable");
      return;
    }
    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const sample = {
          type: "sample" as const,
          capturedAt: new Date().toISOString(),
          fixCapturedAt: new Date(position.timestamp).toISOString(),
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        };
        sendGps(sample);
        sendGpsStatus("connected");
        setGpsStatus(`Connected · ${sample.latitude.toFixed(5)}, ${sample.longitude.toFixed(5)}`);
      },
      (gpsError) => {
        latestGpsRef.current = null;
        const status = gpsError.code === gpsError.PERMISSION_DENIED ? "permission_denied" : "unavailable";
        sendGpsStatus(status);
        setGpsStatus(gpsError.code === gpsError.PERMISSION_DENIED ? "Permission denied" : "GPS signal unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    if (gpsSampleTimerRef.current !== null) window.clearInterval(gpsSampleTimerRef.current);
    gpsSampleTimerRef.current = window.setInterval(() => {
      const sample = latestGpsRef.current;
      if (!sample) return;
      if (Date.now() - Date.parse(sample.fixCapturedAt) > 15_000) {
        latestGpsRef.current = null;
        setGpsStatus("GPS fix is stale");
        sendGpsStatus("unavailable");
        return;
      }
      sendGps({ ...sample, capturedAt: new Date().toISOString() });
    }, 1000);
  }

  async function startCamera() {
    if (!pairing) return;
    const secureContextError = getSecureContextError();
    if (secureContextError) {
      setCameraStatus("HTTPS required");
      setError(secureContextError);
      return;
    }

    setError(null);
    setCameraStatus("Requesting rear camera permission…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setCameraStatus("Rear camera disconnected");
          setPairingStatus("Reconnecting to the vehicle dashboard…");
          void stopCamera();
        };
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const peer = new RTCPeerConnection(vehicleRtcConfiguration);
      peerRef.current = peer;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.ondatachannel = (event) => {
        gpsChannelRef.current = event.channel;
        event.channel.onopen = () => {
          event.channel.send(JSON.stringify({ type: "status", status: latestGpsStatusRef.current }));
          if (latestGpsRef.current) event.channel.send(JSON.stringify(latestGpsRef.current));
        };
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          setPairingStatus("Connected to the vehicle dashboard.");
          setCameraStatus("Streaming rear camera live");
        } else if (peer.connectionState === "disconnected") {
          setPairingStatus("Reconnecting to the vehicle dashboard…");
        } else if (peer.connectionState === "failed") {
          setPairingStatus("Connection failed. Check both devices’ network access and try again.");
        }
      };

      const supabase = createClient();
      const channel = supabase.channel(pairing.signalTopic, { config: { private: true } });
      signalChannelRef.current = channel;
      channel.on("broadcast", { event: "signal" }, ({ payload }) => {
        void handleSignal(payload as SignalMessage);
      });
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setPairingStatus("Waiting for the laptop dashboard…");
          void sendSignal({ kind: "ready" }).catch((signalError) => {
            setError(signalError instanceof Error ? signalError.message : "Secure signalling failed.");
          });
          if (readyTimerRef.current !== null) window.clearInterval(readyTimerRef.current);
          readyTimerRef.current = window.setInterval(() => {
            void sendSignal({ kind: "ready" }).catch(() => undefined);
          }, 1500);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setPairingStatus("Signalling disconnected. Reconnecting…");
        }
      });

      setCameraStatus("Rear camera connected");
      setCameraStarted(true);
      startGps();
      void renewPairing(pairing);
      if (heartbeatTimerRef.current !== null) window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = window.setInterval(() => void renewPairing(pairing), 20_000);
    } catch (cameraError) {
      const message = cameraError instanceof Error ? cameraError.message : "Camera access failed.";
      setCameraStatus(cameraError instanceof DOMException && cameraError.name === "NotAllowedError" ? "Camera permission denied" : "Rear camera unavailable");
      setError(cameraError instanceof DOMException && cameraError.name === "NotAllowedError"
        ? "Allow rear-camera access and open this page over HTTPS on a supported phone browser."
        : message);
      if (typeof navigator !== "undefined" && navigator.geolocation && gpsWatchRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
      }
      gpsWatchRef.current = null;
      if (gpsSampleTimerRef.current !== null) window.clearInterval(gpsSampleTimerRef.current);
      gpsSampleTimerRef.current = null;
      if (heartbeatTimerRef.current !== null) window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
      peerRef.current?.close();
      peerRef.current = null;
      const channel = signalChannelRef.current;
      signalChannelRef.current = null;
      if (channel) await createClient().removeChannel(channel);
      streamRef.current?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      streamRef.current = null;
    }
  }

  async function stopCamera(notifyLaptop = true) {
    if (readyTimerRef.current !== null) window.clearInterval(readyTimerRef.current);
    readyTimerRef.current = null;
    if (heartbeatTimerRef.current !== null) window.clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = null;
    if (notifyLaptop) {
      try {
        await sendSignal({ kind: "close" });
      } catch {
        setError("The close signal could not be delivered; the server-side pairing is being closed.");
      }
    }
    if (typeof navigator !== "undefined" && navigator.geolocation && gpsWatchRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
    }
    gpsWatchRef.current = null;
    if (gpsSampleTimerRef.current !== null) window.clearInterval(gpsSampleTimerRef.current);
    gpsSampleTimerRef.current = null;
    gpsChannelRef.current?.close();
    gpsChannelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const channel = signalChannelRef.current;
    signalChannelRef.current = null;
    if (channel) {
      try {
        await createClient().removeChannel(channel);
      } catch {
        setError("Signalling channel cleanup failed; the pairing lease will expire automatically.");
      }
    }
    const activePairing = pairing;
    if (activePairing) {
      try {
        const response = await fetch("/api/vehicle/pairing/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pairingId: activePairing.pairingId,
            mobileCloseToken: activePairing.mobileCloseToken,
          }),
        });
        const payload = await response.json();
        if (!response.ok && response.status !== 410) throw new Error(payload.error ?? "Server pairing close failed.");
      } catch (closeError) {
        setError(closeError instanceof Error ? closeError.message : "The server pairing could not be closed.");
      }
    }
    setPairing(null);
    setCameraStarted(false);
    setCameraStatus("Camera stopped");
    setGpsStatus("GPS stopped");
    setPairingStatus("Disconnected from the vehicle dashboard.");
  }

  useEffect(() => {
    if (!token || redeemedRef.current) return;
    redeemedRef.current = true;
    void redeemPairing();
  }, [token]);

  useEffect(() => () => {
    if (readyTimerRef.current !== null) window.clearInterval(readyTimerRef.current);
    if (heartbeatTimerRef.current !== null) window.clearInterval(heartbeatTimerRef.current);
    if (gpsWatchRef.current !== null) navigator.geolocation?.clearWatch(gpsWatchRef.current);
    if (gpsSampleTimerRef.current !== null) window.clearInterval(gpsSampleTimerRef.current);
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    const channel = signalChannelRef.current;
    if (channel) void createClient().removeChannel(channel);
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-5 bg-slate-950 px-4 py-6 text-white">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.18em] text-emerald-300">Vehicle camera sender</p>
        <h1 className="text-2xl font-semibold">Live road camera</h1>
        <p className="text-sm text-slate-300">Vehicle: {pairing?.vehicleId ?? "Pairing…"}</p>
      </header>
      <div className="relative overflow-hidden rounded-lg border border-slate-700 bg-black">
        <video ref={videoRef} muted playsInline autoPlay className="max-h-[65svh] min-h-64 w-full object-contain" aria-label="Mobile rear camera preview" />
        {!cameraStarted ? (
          <div className="absolute inset-0 grid place-items-center text-center text-slate-300">
            <p className="px-6">Rear-camera preview appears after you start the camera.</p>
          </div>
        ) : null}
      </div>
      <section className="grid gap-2 sm:grid-cols-2">
        <p className="rounded border border-slate-700 p-3 text-sm"><strong>Camera:</strong> {cameraStatus}</p>
        <p className="rounded border border-slate-700 p-3 text-sm"><strong>Connection:</strong> {pairingStatus}</p>
        <p className="rounded border border-slate-700 p-3 text-sm sm:col-span-2"><strong>GPS:</strong> {gpsStatus}</p>
      </section>
      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
      {!pairing && error && token ? (
        <button type="button" disabled={joining} onClick={() => void redeemPairing()} className="min-h-12 w-full rounded border border-slate-500 px-4 py-3 font-semibold disabled:opacity-50">
          {joining ? "Pairing…" : "Retry Pairing"}
        </button>
      ) : null}
      <div className="flex gap-3">
        <button type="button" disabled={!pairing || cameraStarted} onClick={() => void startCamera()} className="min-h-12 flex-1 rounded bg-emerald-500 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50">Start Camera</button>
        <button type="button" disabled={!pairing} onClick={() => void stopCamera()} className="min-h-12 flex-1 rounded border border-slate-500 px-4 py-3 font-semibold disabled:opacity-50">Stop Camera</button>
      </div>
    </main>
  );
}
