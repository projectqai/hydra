import { useEffect, useRef, useState } from "react";

import { RTCPeerConnection, RTCSessionDescription } from "./rtc";
import type { ConnectionState } from "./types";

// When bundled behind a proxy that serves frontend + backend, camera URLs
// may be relative (e.g., "/whep/camera1"). Resolve them using the origin.
// On native, there's no origin concept so we assume localhost.
function resolveUrl(url: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  return new URL(url, origin).href;
}

type UseWHEPConnectionOptions = {
  url: string;
  maxRetries?: number;
  retryDelayMs?: number;
};

type ConnectionStatus = {
  state: ConnectionState;
  error: string | null;
};

type UseWHEPConnectionReturn = {
  stream: MediaStream | null;
  connectionState: ConnectionState;
  error: string | null;
  retry: () => void;
};

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

export function useWHEPConnection({
  url,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: UseWHEPConnectionOptions): UseWHEPConnectionReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle", error: null });
  const [retryTrigger, setRetryTrigger] = useState(0);

  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let pc: RTCPeerConnection | null = null;
    let abortController: AbortController | null = null;
    let mounted = true;

    const cleanupPC = () => {
      if (pc) {
        pc.getSenders().forEach((sender) => sender.track?.stop());
        pc.getReceivers().forEach((receiver) => receiver.track?.stop());
        pc.ontrack = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
        pc = null;
      }
    };

    const cleanup = () => {
      clearTimeout(retryTimeoutRef.current);
      abortController?.abort();
      abortController = null;
      cleanupPC();
    };

    const scheduleRetry = () => {
      retryCountRef.current += 1;
      const delay = retryDelayMs * retryCountRef.current;
      retryTimeoutRef.current = setTimeout(() => {
        if (mounted) connect(true);
      }, delay);
    };

    const handleFailure = (message: string) => {
      if (!mounted) return;
      cleanupPC();
      if (retryCountRef.current < maxRetries) {
        scheduleRetry();
      } else {
        setStatus({ state: "failed", error: message });
      }
    };

    const connect = async (isRetry = false) => {
      if (!mounted) return;

      cleanup();
      abortController = new AbortController();
      setStatus({ state: isRetry ? "reconnecting" : "connecting", error: null });

      try {
        pc = new RTCPeerConnection({
          iceServers: [],
          iceCandidatePoolSize: 0,
        });

        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });

        pc.ontrack = (event: RTCTrackEvent) => {
          if (!mounted) return;
          const incomingStream = event.streams[0];
          if (incomingStream?.getVideoTracks().length) {
            setStream(incomingStream);
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (!mounted || !pc) return;

          switch (pc.iceConnectionState) {
            case "connected":
            case "completed":
              setStatus({ state: "connected", error: null });
              retryCountRef.current = 0;
              break;
            case "failed":
              handleFailure("Connection lost");
              break;
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const response = await fetch(resolveUrl(url), {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: offer.sdp,
          signal: abortController.signal,
        });

        if (!response.ok) {
          handleFailure(`WHEP error: ${response.status}`);
          return;
        }

        if (!mounted) return;

        const answerSdp = await response.text();
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: "answer", sdp: answerSdp }),
        );
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        handleFailure(err instanceof Error ? err.message : "Connection failed");
      }
    };

    connect();

    return () => {
      mounted = false;
      cleanup();
      setStream(null);
    };
  }, [url, maxRetries, retryDelayMs, retryTrigger]);

  const retry = () => {
    retryCountRef.current = 0;
    setRetryTrigger((n) => n + 1);
  };

  return { stream, connectionState: status.state, error: status.error, retry };
}
