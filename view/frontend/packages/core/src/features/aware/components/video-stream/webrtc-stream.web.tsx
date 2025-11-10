import { useEffect, useRef, useState } from "react";

import { ConnectionOverlay } from "./connection-overlay";
import type { ConnectionState } from "./types";
import { useWHEPConnection } from "./use-whep-connection";

type WebRTCStreamProps = {
  url: string;
  objectFit?: "contain" | "cover";
};

const VIDEO_TIMEOUT_MS = 10000;

export function WebRTCStream({ url, objectFit = "cover" }: WebRTCStreamProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { stream, connectionState, error, retry } = useWHEPConnection({ url });
  const [hasVideo, setHasVideo] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    setHasVideo(false);
    setTimedOut(false);

    const handleLoadedData = () => setHasVideo(true);
    video.addEventListener("loadeddata", handleLoadedData);

    const timeout = setTimeout(() => {
      if (!video.videoWidth) setTimedOut(true);
    }, VIDEO_TIMEOUT_MS);

    return () => {
      video.srcObject = null;
      video.removeEventListener("loadeddata", handleLoadedData);
      clearTimeout(timeout);
    };
  }, [stream]);

  const effectiveState: ConnectionState = timedOut && !hasVideo ? "failed" : connectionState;
  const effectiveError = timedOut && !hasVideo ? "No video received" : error;

  const handleRetry = () => {
    setTimedOut(false);
    setHasVideo(false);
    retry();
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
      <ConnectionOverlay state={effectiveState} error={effectiveError} onRetry={handleRetry} />
    </div>
  );
}
