import { SegmentedControl } from "@hydra/ui/segmented-control";
import type { Entity } from "@projectqai/proto/world";
import { FlashList } from "@shopify/flash-list";
import { AlertTriangle, Crosshair, MapPin } from "lucide-react-native";
import { Text, View } from "react-native";

import {
  formatAltitude,
  formatTime,
  getEntityName,
  getTrackStatus,
  isAsset,
  isExpired,
  isTrack,
} from "../../lib/api/use-track-utils";
import { EntityTrackCard } from "./entity-track-card";
import { useEntityStore } from "./store/entity-store";
import { useLeftPanelStore } from "./store/left-panel-store";
import { useMapEngine } from "./store/map-engine-store";
import { useSelectionStore } from "./store/selection-store";

type TrackData = {
  id: string;
  name: string;
  time?: string;
  altitude: string;
  status: "Friend" | "Hostile" | "Neutral" | "Unknown";
  entity: Entity;
};

function entityToTrackData(entity: Entity): TrackData {
  return {
    id: entity.id,
    name: getEntityName(entity),
    time: formatTime(entity.lifetime?.from || entity.detection?.lastMeasured),
    altitude: formatAltitude(entity.geo?.altitude),
    status: getTrackStatus(entity.symbol?.milStd2525C || ""),
    entity,
  };
}

export function CollapsedStats() {
  const listMode = useLeftPanelStore((s) => s.listMode);
  const count = useEntityStore((s) => {
    const entities = Array.from(s.entities.values());
    const filter = listMode === "tracks" ? isTrack : isAsset;
    return entities.filter((e) => filter(e) && !isExpired(e)).length;
  });
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

export function LeftPanelContent() {
  const entities = useEntityStore((s) => s.entities);
  const select = useSelectionStore((s) => s.select);
  const mapEngine = useMapEngine();
  const listMode = useLeftPanelStore((s) => s.listMode);
  const setListMode = useLeftPanelStore((s) => s.setListMode);

  const handleItemPress = (item: TrackData) => {
    select(item.id);
    if (item.entity.geo) {
      mapEngine.flyTo(
        item.entity.geo.latitude,
        item.entity.geo.longitude,
        item.entity.geo.altitude ?? 0,
      );
    }
  };

  const filter = listMode === "tracks" ? isTrack : isAsset;
  const items = Array.from(entities.values())
    .filter((entity) => filter(entity) && !isExpired(entity))
    .map(entityToTrackData)
    .sort((a, b) => {
      const timeA = a.entity.lifetime?.from?.seconds || BigInt(0);
      const timeB = b.entity.lifetime?.from?.seconds || BigInt(0);
      return Number(timeB - timeA);
    });

  return (
    <View className="flex-1">
      <SegmentedControl tabs={TABS} activeTab={listMode} onTabChange={setListMode} />
      {items.length === 0 ? (
        <EmptyState mode={listMode} />
      ) : (
        <FlashList
          data={items}
          renderItem={({ item }) => (
            <EntityTrackCard
              name={item.name}
              time={item.time}
              altitude={item.altitude}
              status={item.status}
              onPress={() => handleItemPress(item)}
            />
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 12 }}
        />
      )}
    </View>
  );
}
