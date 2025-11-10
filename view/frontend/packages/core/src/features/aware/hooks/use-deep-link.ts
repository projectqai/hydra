import { useEffect, useRef } from "react";
import { toast } from "sonner-native";

import { type AwareUrlParams, useUrlParams } from "../../../lib/use-url-params";
import { useEntityStore } from "../store/entity-store";
import { mapEngineActions } from "../store/map-engine-store";
import { useSelectionStore } from "../store/selection-store";
import { useTabStore } from "../store/tab-store";

function getParamsKey(params: AwareUrlParams): string {
  const { entityId, lat, lng, alt, zoom, tab } = params;
  return `${entityId ?? ""}-${lat ?? ""}-${lng ?? ""}-${alt ?? ""}-${zoom ?? ""}-${tab ?? ""}`;
}

type ValidationResult = {
  isValid: boolean;
  error?: string;
};

function validateParams(params: AwareUrlParams): ValidationResult {
  const { entityId, lat, lng, alt, zoom } = params;

  const hasPartialCoords = (lat && !lng) || (!lat && lng);
  if (hasPartialCoords) return { isValid: false, error: "Both lat and lng are required" };

  if (lat && lng) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) return { isValid: false, error: "Invalid coordinates" };
    if (latNum < -90 || latNum > 90)
      return { isValid: false, error: "Latitude must be between -90 and 90" };
    if (lngNum < -180 || lngNum > 180)
      return { isValid: false, error: "Longitude must be between -180 and 180" };
    if (alt && isNaN(parseFloat(alt))) return { isValid: false, error: "Invalid altitude" };
  }

  if (zoom) {
    const zoomNum = parseFloat(zoom);
    if (isNaN(zoomNum) || zoomNum < 0 || zoomNum > 22)
      return { isValid: false, error: "Zoom must be between 0 and 22" };
  }

  if (entityId !== undefined && entityId.trim() === "")
    return { isValid: false, error: "Entity ID cannot be empty" };

  return { isValid: true };
}

export function useDeepLink(mapReady: boolean) {
  const { params, clearParams } = useUrlParams();
  const processedKeyRef = useRef<string | null>(null);
  const initialLoadRef = useRef(true);
  const entities = useEntityStore((s) => s.entities);
  const isConnected = useEntityStore((s) => s.isConnected);
  const fetchEntity = useEntityStore((s) => s.fetchEntity);

  useEffect(() => {
    if (!mapReady || !isConnected) return;

    const { entityId, lat, lng, alt, zoom, tab } = params;

    const hasDeepLinkParams = entityId !== undefined || lat || lng;
    if (!hasDeepLinkParams) {
      initialLoadRef.current = false;
      return;
    }

    const paramsKey = getParamsKey(params);
    if (processedKeyRef.current === paramsKey) return;

    if (!initialLoadRef.current && !lat && !lng && !zoom) {
      processedKeyRef.current = paramsKey;
      return;
    }
    initialLoadRef.current = false;

    const validation = validateParams(params);
    if (!validation.isValid) {
      if (validation.error) {
        toast.error(validation.error);
      }
      clearParams(["lat", "lng", "alt", "zoom"]);
      processedKeyRef.current = paramsKey;
      return;
    }

    processedKeyRef.current = paramsKey;

    if (lat && lng && !entityId) {
      useSelectionStore.getState().select(null);
      mapEngineActions.flyTo(
        parseFloat(lat),
        parseFloat(lng),
        alt ? parseFloat(alt) : undefined,
        undefined,
        zoom ? parseFloat(zoom) : undefined,
      );
      return;
    }

    if (entityId) {
      handleEntityDeepLink(entityId, tab, zoom);
    }

    async function handleEntityDeepLink(id: string, tab?: string, zoom?: string) {
      let entity = entities.get(id);

      if (!entity) {
        const fetched = await fetchEntity(id);
        entity = fetched ?? undefined;
      }

      if (!entity) {
        toast.error("Entity not found");
        return;
      }

      if (tab) {
        useTabStore.setState({ initialTab: tab });
      }

      useSelectionStore.getState().select(id);

      if (entity.geo) {
        const targetZoom = zoom ? parseFloat(zoom) : 14;
        mapEngineActions.flyTo(
          entity.geo.latitude,
          entity.geo.longitude,
          entity.geo.altitude ?? undefined,
          undefined,
          targetZoom,
        );
      }
    }
  }, [mapReady, isConnected, params, entities, fetchEntity, clearParams]);
}
