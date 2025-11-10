import { Image } from "expo-image";
import { useState } from "react";
import { View } from "react-native";

import { ConnectionOverlay } from "./connection-overlay";
import type { ConnectionState, StreamComponentProps } from "./types";

function isValidImageSrc(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:image/") ||
    src.startsWith("/")
  );
}

export function ImageStream({ url, objectFit = "cover" }: StreamComponentProps) {
  const [key, setKey] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    isValidImageSrc(url) ? "connecting" : "failed",
  );
  const [error, setError] = useState<string | null>(
    isValidImageSrc(url) ? null : "Invalid image source",
  );

  return (
    <View className="relative size-full bg-black/20">
      {isValidImageSrc(url) && (
        <Image
          key={key}
          source={{ uri: url }}
          onLoad={() => {
            setConnectionState("connected");
            setError(null);
          }}
          onError={() => {
            setConnectionState("failed");
            setError("Failed to load image");
          }}
          contentFit={objectFit}
          style={{ width: "100%", height: "100%" }}
        />
      )}
      <ConnectionOverlay
        state={connectionState}
        error={error}
        onRetry={() => {
          if (isValidImageSrc(url)) {
            setConnectionState("connecting");
            setError(null);
            setKey((k) => k + 1);
          }
        }}
      />
    </View>
  );
}
