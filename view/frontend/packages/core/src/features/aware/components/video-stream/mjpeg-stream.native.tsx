import { useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

import { ConnectionOverlay } from "./connection-overlay";
import type { ConnectionState, StreamComponentProps } from "./types";

export function MJPEGStream({ url, objectFit = "cover" }: StreamComponentProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
      <style>
        * { margin: 0; padding: 0; }
        body { background: transparent; overflow: hidden; }
        img { width: 100%; height: 100vh; object-fit: ${objectFit}; }
      </style>
    </head>
    <body>
      <img src="${url}" onload="window.ReactNativeWebView.postMessage('loaded')" onerror="window.ReactNativeWebView.postMessage('error')" />
    </body>
    </html>
  `;

  return (
    <View className="relative h-full w-full bg-black/20">
      <WebView
        key={key}
        source={{ html }}
        style={{ flex: 1, backgroundColor: "transparent" }}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled={true}
        cacheEnabled={false}
        cacheMode="LOAD_NO_CACHE"
        onMessage={(event) => {
          if (event.nativeEvent.data === "loaded") {
            setConnectionState("connected");
            setError(null);
          } else if (event.nativeEvent.data === "error") {
            setConnectionState("failed");
            setError("Failed to load MJPEG stream");
          }
        }}
        onError={() => {
          setConnectionState("failed");
          setError("WebView error");
        }}
      />
      <ConnectionOverlay
        state={connectionState}
        error={error}
        onRetry={() => {
          setConnectionState("connecting");
          setError(null);
          setKey((k) => k + 1);
        }}
      />
    </View>
  );
}
