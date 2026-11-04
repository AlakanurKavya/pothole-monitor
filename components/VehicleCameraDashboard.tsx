"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@/lib/supabase/client";
import { vehicleRtcConfiguration, waitForIceGatheringComplete } from "@/lib/vehicle-rtc";

type PairingStatus = "disconnected" | "waiting" | "connected";
type PairingInfo = {
  pairingId: string;
  vehicleId: string;
  signalTopic: string | null;
  status?: PairingStatus;
  mobileUrl?: string;
  expiresAt: string;
};
type SignalMessage = { kind: "ready" | "offer" | "answer" | "close"; sdp?: RTCSessionDescriptionInit };
type GpsSample = { type: "sample"; capturedAt: string; fixCapturedAt: string; latitude: number; longitude: number; accuracy: number | null };
type GpsStatus = "disconnected" | "requesting" | "connected" | "permission_denied" | "unavailable" | "stopped";
type SessionHistoryItem = {
  id: string;
  vehicle_id: string;
  processing_status: string;
  monitoring_started_at: string;
  monitoring_ended_at: string | null;
  frame_interval_ms: number;
  confidence_threshold: number;
  candidate_count: number;
};

export function VehicleCameraDashboard() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const signalChannelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const pollingRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const laptopHeartbeatTimerRef = useRef<number | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const frameRequestRef = useRef<AbortController | null>(null);
  const frameBusyRef = useRef(false);
  const offerSentRef = useRef(false);
  const pairingRef = useRef<PairingInfo | null>(null);
  const creatingPairingRef = useRef(false);
  const sessionRef = useRef<string | null>(null);
  const monitoringRef = useRef(false);
  const startedAtRef = useRef(0);
  const frameNumberRef = useRef(0);
  const gpsSamplesRef = useRef<GpsSample[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [pairingStatus, setPairingStatus] = useState<PairingStatus>("disconnected");
  const [creatingPairing, setCreatingPairing] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("Not connected");
  const [gpsSample, setGpsSample] = useState<GpsSample | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("disconnected");
  const [streamReceived, setStreamReceived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [frameIntervalMs, setFrameIntervalMs] = useState(1500);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [monitoring, setMonitoring] = useState(false);
  const [monitoringStatus, setMonitoringStatus] = useState("Not started");
  const [frameCount, setFrameCount] = useState(0);
  const [candidateCount, setCandidateCount] = useState(0);
  const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/vehicle/session", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(response.status === 401
          ? "Sign in as a government administrator to view session history."
          : payload.error ?? "History could not be loaded.");
      }
      setSessions(payload.sessions ?? []);
      setHistoryError(null);
    } catch (historyLoadError) {
      setHistoryError(historyLoadError instanceof Error ? historyLoadError.message : "History could not be loaded.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function captureAndProcess() {
    const video = videoRef.current;
    const sessionId = sessionRef.current;
    const peer = peerRef.current;
    if (!monitoringRef.current || !video || !sessionId || !peer || peer.connectionState !== "connected" ||
        frameBusyRef.current || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;

    const capturedAt = new Date();
    const nearestGps = gpsSamplesRef.current.reduce<GpsSample | null>((nearest, sample) => {
      if (!nearest || Math.abs(Date.parse(sample.capturedAt) - capturedAt.getTime()) <
          Math.abs(Date.parse(nearest.capturedAt) - capturedAt.getTime())) return sample;
      return nearest;
    }, null);
    const matchedGps = nearestGps &&
      Math.abs(Date.parse(nearestGps.capturedAt) - capturedAt.getTime()) <= 10_000 &&
      capturedAt.getTime() - Date.parse(nearestGps.fixCapturedAt) <= 15_000
      ? nearestGps
      : null;

    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      setMonitoringStatus("Could not capture a mobile video frame.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    frameBusyRef.current = true;
    const frameNumber = frameNumberRef.current++;
    setFrameCount((count) => count + 1);
    if (!matchedGps) {
      setMonitoringStatus("Waiting for a fresh phone GPS sample; this frame was discarded before inference.");
      frameBusyRef.current = false;
      return;
    }

    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.65));
      if (!blob) throw new Error("Could not encode the mobile camera frame.");
      if (!monitoringRef.current || sessionRef.current !== sessionId) return;
      const form = new FormData();
      form.append("file", blob, `mobile-vehicle-${frameNumber}.jpg`);
      form.append("sessionId", sessionId);
      form.append("capturedAt", capturedAt.toISOString());
      form.append("frameNumber", String(frameNumber));
      form.append("videoTimestamp", String((capturedAt.getTime() - startedAtRef.current) / 1000));
      form.append("latitude", String(matchedGps.latitude));
      form.append("longitude", String(matchedGps.longitude));

      const controller = new AbortController();
      frameRequestRef.current = controller;
      setMonitoringStatus("Sending frame to YOLOv8…");
      const response = await fetch("/api/vehicle/frame", { method: "POST", body: form, signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Mobile frame processing failed.");
      if (payload.positive) setCandidateCount((count) => count + Number(payload.count ?? 0));
      setMonitoringStatus(payload.positive
        ? `${payload.count} positive candidate${payload.count === 1 ? "" : "s"} saved.`
        : payload.duplicate ? "Duplicate frame skipped." : "Frame checked; no candidate met the threshold.");
    } catch (frameError) {
      if (!(frameError instanceof DOMException && frameError.name === "AbortError")) {
        setMonitoringStatus(frameError instanceof Error ? frameError.message : "Frame processing failed; retrying next interval.");
        if (frameError instanceof Error && /disconnected|expired|stopped|closed/i.test(frameError.message)) {
          await stopMonitoring();
        }
      }
    } finally {
      frameRequestRef.current = null;
      frameBusyRef.current = false;
    }
  }

  async function startMonitoring() {
    const pairingInfo = pairingRef.current;
    if (!pairingInfo || !streamReceived || peerRef.current?.connectionState !== "connected") {
      setError("Connect the phone and wait for its live video before starting monitoring.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setMonitoringStatus("Checking YOLOv8 service…");
      const healthResponse = await fetch("/api/vehicle/yolo-health", { cache: "no-store" });
      const healthPayload = await healthResponse.json();
      if (!healthResponse.ok) throw new Error(healthPayload.error ?? "YOLO service unavailable.");

      const response = await fetch("/api/vehicle/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingId: pairingInfo.pairingId, frameIntervalMs, confidenceThreshold }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Monitoring session could not be started.");
      sessionRef.current = payload.sessionId;
      monitoringRef.current = true;
      startedAtRef.current = Date.now();
      frameNumberRef.current = 0;
      setFrameCount(0);
      setCandidateCount(0);
      setMonitoring(true);
      setMonitoringStatus(`Monitoring mobile stream every ${(frameIntervalMs / 1000).toFixed(1)} seconds.`);
      void captureAndProcess();
      frameTimerRef.current = window.setInterval(() => void captureAndProcess(), frameIntervalMs);
    } catch (startError) {
      const message = startError instanceof Error ? startError.message : "Monitoring session could not be started.";
      setError(message);
      setMonitoringStatus(message);
    } finally {
      setBusy(false);
    }
  }

  async function stopMonitoring() {
    monitoringRef.current = false;
    if (frameTimerRef.current !== null) window.clearInterval(frameTimerRef.current);
    frameTimerRef.current = null;
    frameRequestRef.current?.abort();
    frameRequestRef.current = null;
    const sessionId = sessionRef.current;
    sessionRef.current = null;
    setMonitoring(false);
    if (!sessionId) {
      setMonitoringStatus("Not started");
      return;
    }
    try {
      const response = await fetch("/api/vehicle/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Monitoring session could not be stopped.");
      setMonitoringStatus("Monitoring stopped.");
      await refreshHistory();
    } catch (stopError) {
      setMonitoringStatus(stopError instanceof Error ? stopError.message : "Monitoring stopped locally; session update failed.");
    }
  }

  function showGpsMessage(message: string) {
    try {
      const gpsMessage = JSON.parse(message) as GpsSample | { type: "status"; status: GpsStatus };
      if (gpsMessage.type === "status") {
        setGpsStatus(gpsMessage.status);
        return;
      }
      const sample = gpsMessage;
      if (!Number.isFinite(sample.latitude) || sample.latitude < -90 || sample.latitude > 90 ||
          !Number.isFinite(sample.longitude) || sample.longitude < -180 || sample.longitude > 180 ||
          !Number.isFinite(Date.parse(sample.capturedAt)) || !Number.isFinite(Date.parse(sample.fixCapturedAt)) ||
          Date.now() - Date.parse(sample.fixCapturedAt) > 15_000) {
        setGpsStatus("unavailable");
        return;
      }
      gpsSamplesRef.current = [...gpsSamplesRef.current.slice(-119), sample];
      setGpsStatus("connected");
      setGpsSample(sample);
    } catch {
      setError("The paired phone sent an unreadable GPS sample.");
    }
  }

  async function sendSignal(message: SignalMessage) {
    const channel = signalChannelRef.current;
    if (!channel) throw new Error("Signalling channel is not connected.");
    const result = await channel.send({ type: "broadcast", event: "signal", payload: message });
    if (result !== "ok") throw new Error("Secure signalling is temporarily unavailable.");
  }

  async function restartConnection(peer: RTCPeerConnection) {
    if (peerRef.current !== peer || !signalChannelRef.current) return;
    try {
      peer.restartIce();
      const offer = await peer.createOffer({ iceRestart: true });
      await peer.setLocalDescription(offer);
      await waitForIceGatheringComplete(peer);
      await sendSignal({ kind: "offer", sdp: peer.localDescription ?? undefined });
    } catch (restartError) {
      setPairingStatus("disconnected");
      setError(restartError instanceof Error ? restartError.message : "Could not reconnect to the mobile camera.");
    }
  }

  async function handleSignal(message: SignalMessage) {
    if (message.kind === "close") {
      await disconnectMobileCamera(false);
      return;
    }
    if (message.kind === "ready") {
      if (offerSentRef.current) return;
      offerSentRef.current = true;
      const peer = new RTCPeerConnection(vehicleRtcConfiguration);
      peerRef.current = peer;
      peer.addTransceiver("video", { direction: "recvonly" });
      const gpsChannel = peer.createDataChannel("gps", { ordered: true });
      gpsChannel.onmessage = (event) => showGpsMessage(String(event.data));
      peer.ontrack = (event) => {
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        event.track.onended = () => {
          setStreamReceived(false);
          setCameraStatus("Mobile camera track ended");
          setMonitoringStatus(monitoringRef.current ? "Stream lost; waiting for reconnection." : "Mobile stream disconnected.");
          if (monitoringRef.current) void stopMonitoring();
        };
        if (videoRef.current) {
          videoRef.current.srcObject = remoteStream;
          void videoRef.current.play().catch(() => undefined);
        }
        setCameraStatus("Receiving mobile camera stream");
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
          restartTimerRef.current = null;
          setPairingStatus("connected");
          setCameraStatus("Mobile stream connected");
          if (monitoringRef.current) setMonitoringStatus("Mobile stream reconnected; frame processing resumed.");
        } else if (peer.connectionState === "disconnected") {
          setPairingStatus("waiting");
          setCameraStatus("Reconnecting to mobile camera…");
          if (monitoringRef.current) setMonitoringStatus("Stream interrupted; waiting for reconnection.");
          if (restartTimerRef.current === null) {
            restartTimerRef.current = window.setTimeout(() => {
              restartTimerRef.current = null;
              if (peer.connectionState === "disconnected") void restartConnection(peer);
            }, 3500);
          }
        } else if (peer.connectionState === "failed") {
          setPairingStatus("waiting");
          if (restartTimerRef.current === null) {
            restartTimerRef.current = window.setTimeout(() => {
              restartTimerRef.current = null;
              if (peer.connectionState === "failed") void restartConnection(peer);
            }, 1000);
          }
        } else if (peer.connectionState === "closed") {
          setPairingStatus("disconnected");
          setCameraStatus("Mobile camera disconnected");
        }
      };

      try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await waitForIceGatheringComplete(peer);
        await sendSignal({ kind: "offer", sdp: peer.localDescription ?? undefined });
      } catch (signalError) {
        offerSentRef.current = false;
        setError(signalError instanceof Error ? signalError.message : "Could not establish the WebRTC offer.");
      }
      return;
    }

    if (message.kind === "answer" && message.sdp && peerRef.current) {
      try {
        await peerRef.current.setRemoteDescription(message.sdp);
      } catch (signalError) {
        setError(signalError instanceof Error ? signalError.message : "Could not apply the mobile answer.");
      }
    }
  }

  async function listenForPhone(signalTopic: string) {
    if (signalChannelRef.current) return;
    const supabase = createClient();
    const channel = supabase.channel(signalTopic, { config: { private: true } });
    signalChannelRef.current = channel;
    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      void handleSignal(payload as SignalMessage);
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setPairingStatus(peerRef.current?.connectionState === "connected" ? "connected" : "waiting");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setPairingStatus("disconnected");
        setError("Secure signalling disconnected. Check the Supabase Realtime connection.");
      }
    });
  }

  async function renewLaptopHeartbeat(pairingId: string) {
    try {
      const response = await fetch("/api/vehicle/pairing/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingId }),
      });
      const payload = await response.json();
      if (response.status === 410) {
        setError(payload.error ?? "The pairing expired. Create a fresh QR code.");
        await disconnectMobileCamera(false);
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Laptop pairing heartbeat failed.");
    } catch (heartbeatError) {
      setError(heartbeatError instanceof Error ? heartbeatError.message : "Laptop pairing heartbeat failed.");
    }
  }

  async function pollPairing(pairingId: string) {
    try {
      const response = await fetch(`/api/vehicle/pairing?id=${encodeURIComponent(pairingId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 410) {
        if (pollingRef.current !== null) window.clearInterval(pollingRef.current);
        pollingRef.current = null;
        setPairingStatus("disconnected");
        setError(payload.error ?? "Pairing expired.");
        await disconnectMobileCamera();
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Pairing status is temporarily unavailable.");
      const info = payload as PairingInfo;
      const currentInfo = { ...info, mobileUrl: pairingRef.current?.mobileUrl };
      pairingRef.current = currentInfo;
      setPairing(currentInfo);
      if (info.status === "connected" && info.signalTopic) {
        await listenForPhone(info.signalTopic);
      }
    } catch (pollError) {
      setPairingStatus("waiting");
      setError(pollError instanceof Error ? pollError.message : "Pairing status is temporarily unavailable. Retrying…");
    }
  }

  async function connectMobileCamera() {
    const normalizedVehicleId = vehicleId.trim();
    if (!normalizedVehicleId || normalizedVehicleId.length > 100) {
      setError("Enter a valid vehicle ID (1 to 100 characters) to create a pairing link.");
      return;
    }
    if (creatingPairingRef.current || pairingRef.current) return;
    creatingPairingRef.current = true;
    setCreatingPairing(true);
    setError(null);
    setStreamReceived(false);
    setGpsSample(null);
    setGpsStatus("disconnected");
    gpsSamplesRef.current = [];
    offerSentRef.current = false;
    setCameraStatus("Waiting for mobile camera");
    setPairingStatus("waiting");
    try {
      const response = await fetch("/api/vehicle/pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId: normalizedVehicleId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not create camera pairing.");
      if (typeof payload.mobileUrl !== "string") {
        throw new Error("The pairing API did not return a mobile camera URL.");
      }
      const mobileLink = new URL(payload.mobileUrl);
      if (mobileLink.protocol !== "https:" || !mobileLink.hash.startsWith("#token=")) {
        throw new Error("The pairing API returned an invalid mobile HTTPS link.");
      }
      const pairingInfo: PairingInfo = {
        pairingId: payload.pairingId,
        vehicleId: normalizedVehicleId,
        signalTopic: null,
        mobileUrl: mobileLink.toString(),
        expiresAt: payload.expiresAt,
      };
      pairingRef.current = pairingInfo;
      setPairing(pairingInfo);
      setPairingStatus("waiting");
      if (pollingRef.current !== null) window.clearInterval(pollingRef.current);
      pollingRef.current = window.setInterval(() => void pollPairing(payload.pairingId), 5000);
      if (laptopHeartbeatTimerRef.current !== null) window.clearInterval(laptopHeartbeatTimerRef.current);
      void renewLaptopHeartbeat(payload.pairingId);
      laptopHeartbeatTimerRef.current = window.setInterval(() => void renewLaptopHeartbeat(payload.pairingId), 15_000);
      await pollPairing(payload.pairingId);
    } catch (connectError) {
      setPairingStatus("disconnected");
      setCameraStatus("Not connected");
      setError(connectError instanceof Error ? connectError.message : "Camera pairing could not be created.");
    } finally {
      creatingPairingRef.current = false;
      setCreatingPairing(false);
    }
  }

  async function disconnectMobileCamera(notifyPhone = true) {
    await stopMonitoring();
    if (pollingRef.current !== null) window.clearInterval(pollingRef.current);
    pollingRef.current = null;
    if (laptopHeartbeatTimerRef.current !== null) window.clearInterval(laptopHeartbeatTimerRef.current);
    laptopHeartbeatTimerRef.current = null;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
    if (notifyPhone) {
      try {
        await sendSignal({ kind: "close" });
      } catch {
        setError("The close signal could not be delivered; the server-side pairing will still be revoked.");
      }
    }
    const peer = peerRef.current;
    peerRef.current = null;
    peer?.close();
    const channel = signalChannelRef.current;
    signalChannelRef.current = null;
    if (channel) {
      try {
        await createClient().removeChannel(channel);
      } catch {
        setError("Signalling cleanup failed; the pairing is still being closed server-side.");
      }
    }
    const pairingId = pairingRef.current?.pairingId;
    if (pairingId) {
      try {
        const response = await fetch("/api/vehicle/pairing", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pairingId }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Server pairing close failed.");
      } catch (closeError) {
        setError(closeError instanceof Error ? closeError.message : "The server pairing could not be closed.");
      }
    }
    pairingRef.current = null;
    setPairing(null);
    setPairingStatus("disconnected");
    setCameraStatus("Not connected");
    setGpsSample(null);
    setGpsStatus("disconnected");
    gpsSamplesRef.current = [];
    setStreamReceived(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  useEffect(() => {
    void refreshHistory();
    return () => {
      if (pollingRef.current !== null) window.clearInterval(pollingRef.current);
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      if (laptopHeartbeatTimerRef.current !== null) window.clearInterval(laptopHeartbeatTimerRef.current);
      monitoringRef.current = false;
      if (frameTimerRef.current !== null) window.clearInterval(frameTimerRef.current);
      frameRequestRef.current?.abort();
      const sessionId = sessionRef.current;
      if (sessionId) {
        void fetch("/api/vehicle/session", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
      }
      const pairingId = pairingRef.current?.pairingId;
      if (pairingId) {
        void fetch("/api/vehicle/pairing", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pairingId }),
        });
      }
      peerRef.current?.close();
      const channel = signalChannelRef.current;
      if (channel) void createClient().removeChannel(channel);
    };
  }, []);

  const mobileUrl = pairing?.mobileUrl;

  return (
    <div className="space-y-6">
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              onPlaying={() => setStreamReceived(true)}
              className="aspect-video w-full object-contain"
              aria-label="Incoming mobile road camera stream"
            />
            {!streamReceived ? (
              <div className="absolute inset-0 grid place-items-center text-center text-slate-300">
                <div>
                  <p className="text-lg font-medium">Mobile camera preview</p>
                  <p className="mt-1 text-sm text-slate-400">Connect a phone to receive its live rear-camera stream.</p>
                </div>
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <p className="rounded border bg-white p-3 text-sm"><strong>Connection:</strong> {pairingStatus}</p>
            <p className="rounded border bg-white p-3 text-sm"><strong>Camera:</strong> {cameraStatus}</p>
            <p className="rounded border bg-white p-3 text-sm"><strong>GPS:</strong> {gpsStatus === "permission_denied" ? "Phone permission denied" : gpsStatus === "unavailable" ? "Phone GPS unavailable" : gpsStatus === "disconnected" ? "Waiting for paired phone" : gpsSample ? `${gpsSample.latitude.toFixed(5)}, ${gpsSample.longitude.toFixed(5)}` : gpsStatus === "requesting" ? "Requesting on phone" : "Waiting for phone GPS"}</p>
          </div>
        </div>

        <aside className="space-y-4 rounded-lg border bg-white p-5">
          <h3 className="font-semibold">Mobile camera pairing</h3>
          <label className="block text-sm">
            Vehicle ID
            <input
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
              disabled={creatingPairing || Boolean(pairing)}
              placeholder="Enter the vehicle identifier"
              maxLength={100}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={creatingPairing || Boolean(pairing) || !vehicleId.trim()} onClick={() => void connectMobileCamera()} className="rounded bg-[#0e1c33] px-4 py-3 font-semibold text-white disabled:opacity-50">
              {creatingPairing ? "Generating QR..." : "Generate QR Code"}
            </button>
            <button type="button" disabled={!pairing} onClick={() => void disconnectMobileCamera()} className="rounded border border-slate-400 bg-white px-4 py-3 font-semibold disabled:opacity-50">
              Revoke Pairing
            </button>
          </div>
          <div className="space-y-3 border-t pt-4">
            <h4 className="text-sm font-semibold">Monitoring settings</h4>
            <label className="block text-sm">
              Frame interval
              <select
                value={frameIntervalMs}
                onChange={(event) => setFrameIntervalMs(Number(event.target.value))}
                disabled={monitoring}
                className="mt-1 w-full rounded border px-3 py-2"
              >
                <option value={1000}>Every 1 second</option>
                <option value={1500}>Every 1.5 seconds</option>
                <option value={2000}>Every 2 seconds</option>
              </select>
            </label>
            <label className="block text-sm">
              Confidence threshold: {confidenceThreshold.toFixed(2)}
              <input
                type="range"
                min="0.25"
                max="0.95"
                step="0.05"
                value={confidenceThreshold}
                onChange={(event) => setConfidenceThreshold(Number(event.target.value))}
                disabled={monitoring}
                className="mt-2 w-full accent-[#0e1c33]"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy || monitoring || !streamReceived || pairingStatus !== "connected"}
                onClick={() => void startMonitoring()}
                className="rounded bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-50"
              >
                Start Monitoring
              </button>
              <button
                type="button"
                disabled={!monitoring}
                onClick={() => void stopMonitoring()}
                className="rounded border border-slate-400 bg-white px-4 py-3 font-semibold disabled:opacity-50"
              >
                Stop Monitoring
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><strong>Session:</strong> {monitoring ? "Active" : "Not active"}</p>
              <p><strong>Frames:</strong> {frameCount}</p>
              <p><strong>Positive candidates:</strong> {candidateCount}</p>
              <p><strong>Processing:</strong> {monitoringStatus}</p>
            </div>
          </div>
          {pairing && mobileUrl ? (
            <div className="space-y-3 border-t pt-4">
              <p className="text-sm font-medium">Scan with the phone that will send the camera.</p>
              <div className="inline-block rounded bg-white p-3"><QRCodeSVG value={mobileUrl} size={192} level="H" /></div>
              <p className="text-sm"><strong>Vehicle ID:</strong> {pairing.vehicleId}</p>
              <p className="text-sm"><strong>Pairing status:</strong> {pairingStatus}</p>
              <p className="text-xs text-slate-600">Expires {new Date(pairing.expiresAt).toLocaleString()}.</p>
              <a className="block break-all text-sm underline" href={mobileUrl}>{mobileUrl}</a>
            </div>
          ) : null}
          <p role="status" aria-live="polite" className="text-sm text-slate-700">
            {error ?? (streamReceived ? "The laptop is receiving live video from the paired phone." : "The laptop camera is never activated.")}
          </p>
          {/(sign in|unauthorized|forbidden)/i.test(`${error ?? ""} ${historyError ?? ""}`) ? (
            <p className="text-sm text-slate-600">
              Sign in with a government administrator account to pair a camera. <a className="underline" href="/login?next=%2Fvehicle">Sign in</a>
            </p>
          ) : null}
          <div className="border-t pt-3 text-sm text-slate-600">
            <p>Frames are extracted only from the connected mobile WebRTC stream.</p>
            <p className="mt-2">Open this dashboard at an HTTPS address reachable from the phone. A localhost or 127.0.0.1 QR link only works on the laptop.</p>
          </div>
          {gpsSample ? <p className="text-xs text-slate-500">Phone GPS sample: {new Date(gpsSample.capturedAt).toLocaleTimeString()} · ±{gpsSample.accuracy ?? "?"} m</p> : null}
        </aside>
      </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-lg font-semibold">Previous monitoring sessions</h3>
              <p className="text-sm text-slate-600">Session history is limited to your vehicle account.</p>
            </div>
            {historyError ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-rose-700">
                <p>{historyError}</p>
                <button type="button" disabled={historyLoading} onClick={() => void refreshHistory()} className="underline disabled:opacity-50">
                  {historyLoading ? "Checking…" : "Retry status"}
                </button>
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Started</th>
                    <th className="px-4 py-3">Vehicle</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Frame interval</th>
                    <th className="px-4 py-3">Threshold</th>
                    <th className="px-4 py-3">Candidates</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sessions.map((session) => (
                    <tr key={session.id}>
                      <td className="whitespace-nowrap px-4 py-3">{new Date(session.monitoring_started_at).toLocaleString()}</td>
                      <td className="px-4 py-3">{session.vehicle_id}</td>
                      <td className="px-4 py-3">{session.monitoring_ended_at ? "Completed" : "In progress"}</td>
                      <td className="px-4 py-3">{(session.frame_interval_ms / 1000).toFixed(1)} s</td>
                      <td className="px-4 py-3">{Number(session.confidence_threshold).toFixed(2)}</td>
                      <td className="px-4 py-3">{session.candidate_count}</td>
                    </tr>
                  ))}
                  {!sessions.length ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No monitoring sessions yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
    </div>
  );
}
