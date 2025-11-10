import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";

import { ConnectionOverlay } from "./connection-overlay";
import type { ConnectionState, StreamComponentProps } from "./types";

function resolveUrl(url: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  return new URL(url, origin).href;
}

export function HLSStream({ url, objectFit = "cover" }: StreamComponentProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const resolvedUrl = resolveUrl(url);
    setConnectionState("connecting");
    setError(null);

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = resolvedUrl;
      video.addEventListener("loadeddata", () => setConnectionState("connected"));
      video.addEventListener("error", () => {
        setConnectionState("failed");
        setError("Video playback failed");
      });
      video.play().catch(() => {});
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });

      hlsRef.current = hls;
      hls.loadSource(resolvedUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setConnectionState("connected");
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setConnectionState("failed");
          setError(data.details || "HLS playback failed");
        }
      });
    } else {
      setConnectionState("failed");
      setError("HLS not supported in this browser");
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [url, retryKey]);

  const handleRetry = () => {
    setRetryKey((k) => k + 1);
  };

  return (
    <div className="relative h-full w-full bg-black/20">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "100%", height: "100%", objectFit }}
      />
      <ConnectionOverlay state={connectionState} error={error} onRetry={handleRetry} />
    </div>
  );
}
