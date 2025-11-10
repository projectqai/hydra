import { KeyboardProvider } from "@hydra/ui/keyboard";
import { PanelProvider, ResizablePanel, usePanelContext } from "@hydra/ui/panels";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { View } from "react-native";

import { useDeepLink } from "./hooks/use-deep-link";
import { useEscapeHandler } from "./hooks/use-escape-handler";
import { CollapsedStats, LeftPanelContent } from "./left-panel-content";
import { MapControls } from "./map-controls";
import { MapSearch } from "./map-search";
import MapView from "./map-view";
import { PIPProvider } from "./pip-context";
import { PIPPlayer } from "./pip-player";
import { CollapsedInfo, RightPanelContent } from "./right-panel-content";
import { selectDetectionEntityIds, selectLastChange, useEntityStore } from "./store/entity-store";
import {
  setCurrentView,
  useFlyToTarget,
  useMapRef,
  useZoomCommand,
} from "./store/map-engine-store";
import { useMapStore } from "./store/map-store";
import { useOverlayStore } from "./store/overlay-store";
import { useSelectionStore } from "./store/selection-store";
import { buildDelta } from "./utils/transform-entities";

type AwareScreenProps = {
  headerActions?: ReactNode;
};

function AwareScreenContent({ headerActions }: AwareScreenProps) {
  const viewedEntityId = useSelectionStore((s) => s.viewedEntityId);
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const isFollowing = useSelectionStore((s) => s.isFollowing);
  const entities = useEntityStore((s) => s.entities);
  const lastChange = useEntityStore(selectLastChange);
  const detectionEntityIds = useEntityStore(selectDetectionEntityIds);
  const baseLayer = useMapStore((s) => s.layer);
  const tracks = useOverlayStore((s) => s.tracks);
  const sensors = useOverlayStore((s) => s.sensors);
  const visualization = useOverlayStore((s) => s.visualization);
  const mapRef = useMapRef();
  const flyToTarget = useFlyToTarget();
  const zoomCommand = useZoomCommand();
  const { collapseAll } = usePanelContext();

  useEffect(() => {
    let cancelled = false;
    const push = () => {
      if (cancelled) return;
      const ref = mapRef.current;
      if (!ref || typeof ref.pushDelta !== "function") {
        setTimeout(push, 100);
        return;
      }
      const delta = buildDelta(entities, lastChange, detectionEntityIds);
      ref.pushDelta(JSON.stringify(delta));
    };
    push();
    return () => {
      cancelled = true;
    };
  }, [lastChange.version, mapRef]);

  const trackedId = isFollowing && selectedEntityId ? selectedEntityId : null;
  useEffect(() => {
    let cancelled = false;
    const push = () => {
      if (cancelled) return;
      const ref = mapRef.current;
      if (!ref || typeof ref.pushSelection !== "function") {
        setTimeout(push, 100);
        return;
      }
      ref.pushSelection(selectedEntityId, trackedId);
    };
    push();
    return () => {
      cancelled = true;
    };
  }, [selectedEntityId, trackedId, mapRef]);

  const filterJson = JSON.stringify({ tracks, sensors });
  useEffect(() => {
    let cancelled = false;
    const push = () => {
      if (cancelled) return;
      const ref = mapRef.current;
      if (!ref || typeof ref.pushSettings !== "function") {
        setTimeout(push, 100);
        return;
      }
      ref.pushSettings(baseLayer, filterJson, visualization.coverage, visualization.shapes);
    };
    push();
    return () => {
      cancelled = true;
    };
  }, [baseLayer, filterJson, visualization.coverage, visualization.shapes, mapRef]);

  // Clear selection when selected entity is removed from the store
  // Only check deletedIds to avoid running on every entity update
  useEffect(() => {
    if (selectedEntityId && lastChange.deletedIds.has(selectedEntityId)) {
      useSelectionStore.getState().clearSelection();
    }
  }, [selectedEntityId, lastChange.deletedIds]);

  useEscapeHandler();
  useDeepLink(true);

  const handleEntityClick = async (id: string | null) => {
    const { selectedEntityId, viewedEntityId, select, clearSelection } =
      useSelectionStore.getState();

    if (id) {
      if (selectedEntityId === id) {
        select(null);
      } else {
        select(id);
      }
      return;
    }

    if (selectedEntityId) {
      select(null);
    } else if (viewedEntityId) {
      clearSelection();
      collapseAll();
    } else {
      collapseAll();
    }
  };

  return (
    <>
      <MapView
        ref={mapRef}
        flyToTarget={flyToTarget}
        zoomCommand={zoomCommand}
        baseLayer={baseLayer}
        coverageVisible={visualization.coverage}
        shapesVisible={visualization.shapes}
        onEntityClick={handleEntityClick}
        onTrackingLost={async () => useSelectionStore.setState({ isFollowing: false })}
        onViewChange={async (lat, lng, zoom) => setCurrentView(lat, lng, zoom)}
      />

      <ResizablePanel side="left" minWidth={200} maxWidth={600} collapsedHeight={60}>
        <ResizablePanel.Collapsed>
          <CollapsedStats />
        </ResizablePanel.Collapsed>
        <ResizablePanel.Content>
          <LeftPanelContent />
        </ResizablePanel.Content>
      </ResizablePanel>

      <ResizablePanel
        side="right"
        minWidth={200}
        maxWidth={600}
        collapsedHeight={60}
        collapsed={!viewedEntityId}
      >
        <ResizablePanel.Collapsed>
          <CollapsedInfo />
        </ResizablePanel.Collapsed>
        <ResizablePanel.Content>
          <RightPanelContent headerActions={headerActions} />
        </ResizablePanel.Content>
      </ResizablePanel>

      <MapControls />
      <MapSearch />
      <PIPPlayer />
    </>
  );
}

export default function AwareScreen({ headerActions }: AwareScreenProps) {
  const startStream = useEntityStore((s) => s.startStream);
  const stopStream = useEntityStore((s) => s.stopStream);

  useEffect(() => {
    startStream();
    return () => stopStream();
  }, [startStream, stopStream]);

  return (
    <View className="flex-1">
      <KeyboardProvider>
        <PanelProvider>
          <PIPProvider>
            <AwareScreenContent headerActions={headerActions} />
          </PIPProvider>
        </PanelProvider>
      </KeyboardProvider>
    </View>
  );
}
