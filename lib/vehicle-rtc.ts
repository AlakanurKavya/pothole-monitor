export const vehicleRtcConfiguration: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export function waitForIceGatheringComplete(peer: RTCPeerConnection) {
  if (typeof window === "undefined") return Promise.resolve();
  if (peer.iceGatheringState === "complete") return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(finish, 10000);
    function finish() {
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", checkState);
      resolve();
    }
    function checkState() {
      if (peer.iceGatheringState === "complete") finish();
    }
    peer.addEventListener("icegatheringstatechange", checkState);
  });
}
