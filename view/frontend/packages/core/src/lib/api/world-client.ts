import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { WorldService } from "@projectqai/proto/world";
import { fetch } from "expo/fetch";
import Constants from "expo-constants";
import { Platform } from "react-native";

function getBaseUrl() {
  if (Constants.expoConfig?.extra?.PUBLIC_HYDRA_API_URL) {
    return Constants.expoConfig.extra.PUBLIC_HYDRA_API_URL;
  }
  // Native: always use localhost (engine runs on device)
  if (Platform.OS !== "web") {
    return "http://localhost:50051";
  }
  // Web: use current origin
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:50051";
}

const baseUrl = getBaseUrl();

const transport = createConnectTransport({
  baseUrl,
  useBinaryFormat: true,
  fetch: fetch as unknown as typeof globalThis.fetch,
});

export const worldClient = createClient(WorldService, transport);
