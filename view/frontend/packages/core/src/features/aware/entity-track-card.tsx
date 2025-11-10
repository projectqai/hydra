import { Badge } from "@hydra/ui/badge";
import type { Entity } from "@projectqai/proto/world";
import { Clock, Compass, MapPin, Mountain, Radio, Zap } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import {
  formatAltitude,
  formatTime,
  getEntityName,
  getStatusBadgeVariant,
  getTrackStatus,
  type TrackStatus,
} from "../../lib/api/use-track-utils";
import { calculateCourseFromVelocity, calculateGroundSpeed } from "./utils/format-kinematics";

type DataItemProps = {
  icon: typeof Clock;
  value: string;
};

function DataItem({ icon: Icon, value }: DataItemProps) {
  return (
    <View className="flex-row items-center gap-1">
      <Icon size={11} color="rgb(153 153 153)" strokeWidth={1.5} />
      <Text className="font-sans-medium text-foreground/70 text-[10px]">{value}</Text>
    </View>
  );
}

function SourceItem({ value }: { value: string }) {
  return (
    <View className="min-w-0 flex-1 shrink flex-row items-center gap-1">
      <View className="shrink-0">
        <Radio size={11} color="rgb(153 153 153)" strokeWidth={1.5} />
      </View>
      <Text className="text-foreground/70 font-sans-medium shrink text-[10px]" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

type EntityAssetCardProps = {
  name: string;
  time?: string;
  altitude: string;
  status: TrackStatus;
  isSelected?: boolean;
  onPress?: () => void;
};

export function EntityAssetCard({
  name,
  time,
  altitude,
  status,
  isSelected,
  onPress,
}: EntityAssetCardProps) {
  return (
    <Pressable
      className={`border-border/30 mb-1 rounded-md border px-2.5 py-2 ${
        isSelected
          ? "bg-foreground/10 border-foreground/50"
          : "bg-foreground/5 active:bg-foreground/10"
      }`}
      onPress={onPress}
    >
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="font-sans-semibold text-foreground flex-1 text-[13px]">{name}</Text>
        <View className="size-5 items-center justify-center opacity-50">
          <MapPin size={14} color="rgba(255, 255, 255, 1)" strokeWidth={2} />
        </View>
      </View>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2.5">
          {time && <DataItem icon={Clock} value={time} />}
          <DataItem icon={Mountain} value={altitude} />
        </View>
        <Badge variant={getStatusBadgeVariant(status)} size="sm">
          {status}
        </Badge>
      </View>
    </Pressable>
  );
}

type EntityTrackCardProps = {
  entity: Entity;
  isSelected?: boolean;
  onPress?: () => void;
};

export function EntityTrackCard({ entity, isSelected, onPress }: EntityTrackCardProps) {
  const name = getEntityName(entity);
  const status = getTrackStatus(entity.symbol?.milStd2525C || "");
  const time = formatTime(entity.lifetime?.from || entity.detection?.lastMeasured);
  const altitude = formatAltitude(entity.geo?.altitude);
  const course =
    entity.bearing?.azimuth ?? calculateCourseFromVelocity(entity.kinematics?.velocityEnu);
  const speed = calculateGroundSpeed(entity.kinematics?.velocityEnu);
  const source = entity.controller?.name;

  return (
    <Pressable
      className={`border-border/30 mb-1 rounded-md border px-2.5 py-2 ${
        isSelected
          ? "bg-foreground/10 border-foreground/50"
          : "bg-foreground/5 active:bg-foreground/10"
      }`}
      onPress={onPress}
    >
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="font-sans-semibold text-foreground flex-1 text-[13px]" numberOfLines={1}>
          {name}
        </Text>
        <Badge variant={getStatusBadgeVariant(status)} size="sm">
          {status}
        </Badge>
      </View>
      <View className="mb-1 flex-row items-center gap-2">
        {course !== undefined && <DataItem icon={Compass} value={`${course.toFixed(0)}°`} />}
        <DataItem icon={Mountain} value={altitude} />
        {speed !== undefined && <DataItem icon={Zap} value={`${speed.toFixed(0)} m/s`} />}
      </View>
      <View className="flex-row items-center gap-2">
        {source && <SourceItem value={source} />}
        {time && <DataItem icon={Clock} value={time} />}
      </View>
    </Pressable>
  );
}
