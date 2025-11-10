import { useEffect } from "react";

import { mapEngineActions } from "../store/map-engine-store";
import { useMapStore } from "../store/map-store";
import { useOverlayStore } from "../store/overlay-store";
import { useSelectionStore } from "../store/selection-store";

export function useMapSync(mapReady: boolean) {
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const isFollowing = useSelectionStore((s) => s.isFollowing);

  useEffect(() => {
    if (!mapReady) return;
    mapEngineActions.selectEntity(selectedEntityId);
  }, [mapReady, selectedEntityId]);

  useEffect(() => {
    if (!mapReady) return;
    if (isFollowing && selectedEntityId) {
      mapEngineActions.trackEntity(selectedEntityId);
    } else {
      mapEngineActions.trackEntity(null);
    }
  }, [mapReady, isFollowing, selectedEntityId]);

  useEffect(() => {
    if (!mapReady) return;
    const { layer, sceneMode } = useMapStore.getState();
    const { tracks, sensors, visualization } = useOverlayStore.getState();
    mapEngineActions.setBaseLayer(layer);
    mapEngineActions.setSceneMode(sceneMode);
    mapEngineActions.setEntityVisibility(JSON.stringify(tracks), JSON.stringify(sensors));
    mapEngineActions.setCoverageVisible(visualization.coverage);
  }, [mapReady]);
}
