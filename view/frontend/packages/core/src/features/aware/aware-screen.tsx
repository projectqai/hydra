import { KeyboardProvider } from "@hydra/ui/keyboard";
import { PanelProvider, ResizablePanel, usePanelContext } from "@hydra/ui/panels";
import type { Entity } from "@projectqai/proto/world";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { useDeepLink } from "./hooks/use-deep-link";
import { useEscapeHandler } from "./hooks/use-escape-handler";
import { useMapSync } from "./hooks/use-map-sync";
import { CollapsedStats, LeftPanelContent } from "./left-panel-content";
import { MapControls } from "./map-controls";
import { MapSearch } from "./map-search";
import MapView from "./map-view";
import { PIPProvider } from "./pip-context";
import { PIPPlayer } from "./pip-player";
import { CollapsedInfo, RightPanelContent } from "./right-panel-content";
import { useEntityStore } from "./store/entity-store";
import { setMapReady, useFlyToTarget, useMapRef } from "./store/map-engine-store";
import { useSelectionStore } from "./store/selection-store";
import { transformEntities } from "./utils/transform-entities";

type AwareScreenProps = {
  headerActions?: ReactNode;
};

function serializeEntities(entities: Map<string, Entity>) {
  return transformEntities(entities).map((e) => ({
    ...e,
    activeSectors: e.activeSectors ? Array.from(e.activeSectors) : undefined,
  }));
}

function AwareScreenContent({ headerActions }: AwareScreenProps) {
  const viewedEntityId = useSelectionStore((s) => s.viewedEntityId);
  const entities = useEntityStore((s) => s.entities);
  const [mapReady, setMapReadyLocal] = useState(false);
  const mapRef = useMapRef();
  const flyToTarget = useFlyToTarget();
  const { collapseAll, unfocusRightPanel } = usePanelContext();
  const serializedEntities = serializeEntities(entities);

  useEscapeHandler();
  useMapSync(mapReady);
  useDeepLink(mapReady);

  const handleEntityClick = (id: string | null) => {
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
      unfocusRightPanel();
    } else if (viewedEntityId) {
      clearSelection();
      collapseAll();
    } else {
      collapseAll();
    }
  };

  const handleMapReady = () => {
    setMapReadyLocal(true);
    setMapReady(true);
  };

  return (
    <>
      <MapView
        ref={mapRef}
        entities={serializedEntities}
        flyToTarget={flyToTarget}
        onReady={handleMapReady}
        onEntityClick={handleEntityClick}
        onTrackingLost={() => useSelectionStore.setState({ isFollowing: false })}
      />

      {mapReady && (
        <>
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
      )}
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
