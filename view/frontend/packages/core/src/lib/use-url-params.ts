import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { useLocalSearchParams, useRouter } from "expo-router";
import { toast } from "sonner-native";

export type AwareUrlParams = {
  entityId?: string;
  tab?: string;
  lat?: string;
  lng?: string;
  alt?: string;
  zoom?: string;
  heading?: string;
  pitch?: string;
};

export function useUrlParams() {
  const router = useRouter();
  const params = useLocalSearchParams<AwareUrlParams>();

  const updateParams = (updates: Partial<AwareUrlParams>) => {
    const newParams: Record<string, string | string[] | undefined> = { ...params };
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        newParams[key] = undefined;
      } else {
        newParams[key] = value;
      }
    }
    router.setParams(newParams);
  };

  const clearParams = (keys: (keyof AwareUrlParams)[]) => {
    const newParams: Record<string, string | string[] | undefined> = { ...params };
    for (const key of keys) {
      newParams[key] = undefined;
    }
    router.setParams(newParams);
  };

  return { params, updateParams, clearParams };
}

export function getShareableEntityUrl(
  entityId: string,
  options?: { tab?: string; zoom?: number },
): string {
  const tabParam = options?.tab ? `&tab=${encodeURIComponent(options.tab)}` : "";
  const zoomParam =
    options?.zoom !== undefined ? `&zoom=${Math.round(options.zoom * 10) / 10}` : "";

  if (process.env.EXPO_OS === "web" && typeof window !== "undefined") {
    return `${window.location.origin}/aware?entityId=${encodeURIComponent(entityId)}${tabParam}${zoomParam}`;
  }

  const scheme = Constants.expoConfig?.extra?.SCHEME ?? "hydra";
  return `${scheme}://aware?entityId=${encodeURIComponent(entityId)}${tabParam}${zoomParam}`;
}

export function getShareableLocationUrl(
  lat: number,
  lng: number,
  options?: { alt?: number; zoom?: number },
): string {
  const altParam = options?.alt !== undefined ? `&alt=${Math.round(options.alt)}` : "";
  const zoomParam =
    options?.zoom !== undefined ? `&zoom=${Math.round(options.zoom * 10) / 10}` : "";

  // Round coordinates to 5 decimal places (~1m precision)
  const latRounded = Math.round(lat * 100000) / 100000;
  const lngRounded = Math.round(lng * 100000) / 100000;

  if (process.env.EXPO_OS === "web" && typeof window !== "undefined") {
    return `${window.location.origin}/aware?lat=${latRounded}&lng=${lngRounded}${altParam}${zoomParam}`;
  }

  const scheme = Constants.expoConfig?.extra?.SCHEME ?? "hydra";
  return `${scheme}://aware?lat=${latRounded}&lng=${lngRounded}${altParam}${zoomParam}`;
}

export async function copyShareableLink(url: string) {
  await Clipboard.setStringAsync(url);
  toast("Link copied to clipboard");
}
