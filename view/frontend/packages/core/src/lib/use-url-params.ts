import { useLocalSearchParams, useRouter } from "expo-router";

export type AwareUrlParams = {
  entityId?: string;
  tab?: string;
  lat?: string;
  lng?: string;
  alt?: string;
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

  return { params, updateParams };
}
