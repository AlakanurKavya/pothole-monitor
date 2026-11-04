"use client";

import { useEffect, useState } from "react";
import { MobileCameraSender } from "@/components/MobileCameraSender";
import { readPairingTokenFromHash } from "@/lib/pairing-link";

export default function VehicleCameraPage() {
  const [token, setToken] = useState<string | null>(null);
  const [linkRead, setLinkRead] = useState(false);
  const [secureContextError, setSecureContextError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      setLinkRead(true);
      return;
    }

    if (!window.isSecureContext || window.location.protocol !== "https:") {
      setSecureContextError(
        "This page must be opened over HTTPS from a mobile browser. Use a trusted tunnel such as ngrok or Cloudflare Tunnel, not plain HTTP on 10.10.34.26.",
      );
      setLinkRead(true);
      return;
    }

    const pairingToken = readPairingTokenFromHash(window.location.hash);
    setToken(pairingToken);
    setLinkRead(true);
  }, []);

  if (!linkRead) {
    return <main className="grid min-h-screen place-items-center bg-slate-950 px-5 text-center text-white">Opening secure camera pairing…</main>;
  }
  if (secureContextError) {
    return <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-center text-white"><div className="max-w-xl space-y-3 rounded-lg border border-rose-500/60 bg-slate-900 p-6"><p className="text-sm uppercase tracking-[0.18em] text-rose-300">HTTPS required</p><h1 className="text-2xl font-semibold">Secure mobile camera access is required</h1><p className="text-sm text-slate-300">{secureContextError}</p><p className="text-sm text-slate-300">Open the HTTPS tunnel URL generated for this app, then scan the QR code again.</p></div></main>;
  }
  if (!token) {
    return <main className="grid min-h-screen place-items-center bg-slate-950 px-5 text-center text-white">Pairing token is missing or malformed. Scan a fresh QR code; its URL must include a #token= fragment.</main>;
  }

  return <MobileCameraSender token={token} />;
}
