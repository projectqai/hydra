import { SegmentedControl } from "@hydra/ui/segmented-control";
import type { Entity } from "@projectqai/proto/world";
import { FlashList } from "@shopify/flash-list";
import { AlertTriangle, Crosshair, MapPin } from "lucide-react-native";
import { useRef, useState } from "react";
import { Text, View } from "react-native";

import {
  formatAltitude,
  formatTime,
  getEntityName,
  getTrackStatus,
  isAsset,
} from "../../lib/api/use-track-utils";
import { useUrlParams } from "../../lib/use-url-params";
import { EntityAssetCard, EntityTrackCard } from "./entity-track-card";
import {
  selectAssetCount,
  selectAssets,
  selectTrackCount,
  selectTracks,
  useEntityStore,
} from "./store/entity-store";
import { type ListMode, useLeftPanelStore } from "./store/left-panel-store";
import { useMapEngine } from "./store/map-engine-store";
import { useSelectionStore } from "./store/selection-store";

export function CollapsedStats() {
  const listMode = useLeftPanelStore((s) => s.listMode);
  const trackCount = useEntityStore(selectTrackCount);
  const assetCount = useEntityStore(selectAssetCount);
  const count = listMode === "tracks" ? trackCount : assetCount;
  const alertCount = 0;

  const Icon = listMode === "tracks" ? Crosshair : MapPin;
  const label = listMode === "tracks" ? "Tracks" : "Assets";

  return (
    <View className="flex-row items-center gap-3">
      <View className="flex-row items-center gap-1.5">
        <AlertTriangle size={15} color="rgba(255, 255, 255, 0.5)" strokeWidth={2} />
        <Text className="font-sans-semibold text-foreground/80 text-xs">{alertCount} Alerts</Text>
      </View>

      <Text className="text-foreground/40 text-xl leading-none">•</Text>

      <View className="flex-row items-center gap-1.5">
        <Icon size={15} color="white" opacity={0.5} strokeWidth={2} />
        <Text className="font-sans-semibold text-foreground/80 text-xs">
          {count} {label}
        </Text>
      </View>
    </View>
  );
}

function EmptyState({ mode }: { mode: "tracks" | "assets" }) {
  const Icon = mode === "tracks" ? Crosshair : MapPin;
  const title = mode === "tracks" ? "No tracks detected" : "No assets available";
  const subtitle = mode === "tracks" ? "Waiting for tracked objects" : "No static assets on map";

  return (
    <View className="flex-1 px-6 pt-16 select-none">
      <View className="items-center">
        <View className="opacity-30">
          <Icon size={28} color="rgba(255, 255, 255)" strokeWidth={1.5} />
        </View>
        <Text className="font-sans-medium text-foreground/50 mt-2 text-center text-sm">
          {title}
        </Text>
        <Text className="text-foreground/30 text-center font-sans text-xs leading-relaxed">
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

const TABS = [
  { id: "tracks" as const, label: "Tracks" },
  { id: "assets" as const, label: "Assets" },
];

const PAGE_SIZE = 200;

export function LeftPanelContent() {
  const listMode = useLeftPanelStore((s) => s.listMode);
  const setListMode = useLeftPanelStore((s) => s.setListMode);
  const tracks = useEntityStore(selectTracks);
  const assets = useEntityStore(selectAssets);
  const select = useSelectionStore((s) => s.select);
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const mapEngine = useMapEngine();
  const { clearParams } = useUrlParams();

  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const listRef = useRef<any>(null);

  const onTabChange = (mode: ListMode) => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    setDisplayCount(PAGE_SIZE);
    setListMode(mode);
  };

  const handleItemPress = (entity: Entity) => {
    clearParams(["entityId", "lat", "lng", "alt", "zoom", "tab"]);

    if (selectedEntityId === entity.id) {
      select(null);
    } else {
      select(entity.id);
      if (entity.geo) {
        const currentZoom = mapEngine.getView()?.zoom ?? 10;
        const targetZoom = Math.max(currentZoom, 14);
        mapEngine.flyTo(
          entity.geo.latitude,
          entity.geo.longitude,
          entity.geo.altitude ?? 0,
          1.5,
          targetZoom,
        );
      }
    }
  };

  const handleLoadMore = () => {
    setDisplayCount((c) => c + PAGE_SIZE);
  };

  const entities = listMode === "tracks" ? tracks : assets;
  const displayedEntities = entities.slice(0, displayCount);
  const hasMore = displayedEntities.length < entities.length;

  return (
    <View className="flex-1">
      <SegmentedControl tabs={TABS} activeTab={listMode} onTabChange={onTabChange} />
      {displayedEntities.length === 0 ? (
        <EmptyState mode={listMode} />
      ) : (
        <FlashList
          ref={listRef}
          data={displayedEntities}
          extraData={selectedEntityId}
          renderItem={({ item }) =>
            isAsset(item) ? (
              <EntityAssetCard
                name={getEntityName(item)}
                time={formatTime(item.lifetime?.from || item.detection?.lastMeasured)}
                altitude={formatAltitude(item.geo?.altitude)}
                status={getTrackStatus(item.symbol?.milStd2525C || "")}
                onPress={() => handleItemPress(item)}
              />
            ) : (
              <EntityTrackCard
                entity={item}
                isSelected={selectedEntityId === item.id}
                onPress={() => handleItemPress(item)}
              />
            )
          }
          keyExtractor={(item) => item.id}
          drawDistance={500}
          contentContainerStyle={{ paddingVertical: 8, paddingLeft: 12, paddingRight: 4 }}
          showsVerticalScrollIndicator
          onEndReached={hasMore ? handleLoadMore : undefined}
          onEndReachedThreshold={0.5}
        />
      )}
    </View>
  );
}
