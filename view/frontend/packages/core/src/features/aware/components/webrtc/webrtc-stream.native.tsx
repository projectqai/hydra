import { View } from "react-native";
import { type MediaStream as NativeMediaStream, RTCView } from "react-native-webrtc";

import { ConnectionOverlay } from "./connection-overlay";
import { useWHEPConnection } from "./use-whep-connection";

type WebRTCStreamProps = {
  url: string;
  objectFit?: "contain" | "cover";
};

export function WebRTCStream({ url, objectFit = "cover" }: WebRTCStreamProps) {
  const { stream, connectionState, error, retry } = useWHEPConnection({ url });

  const streamURL = (stream as NativeMediaStream | null)?.toURL() ?? null;

  return (
    <View className="relative h-full w-full bg-black/20">
      {streamURL && (
        <RTCView
          streamURL={streamURL}
          objectFit={objectFit}
          style={{ width: "100%", height: "100%" }}
        />
      )}
      <ConnectionOverlay state={connectionState} error={error} onRetry={retry} />
    </View>
  );
}
