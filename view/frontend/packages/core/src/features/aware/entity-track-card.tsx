import type { BadgeVariant } from "@hydra/ui/badge";
import { Badge } from "@hydra/ui/badge";
import { Clock, MapPin, Mountain } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

type EntityStatus = "Friend" | "Hostile" | "Neutral" | "Unknown";

type EntityCardProps = {
  name: string;
  time?: string;
  altitude: string;
  status: EntityStatus;
  onPress?: () => void;
};

function getBadgeVariant(status: EntityStatus): BadgeVariant {
  if (status === "Friend") return "info";
  if (status === "Hostile") return "danger";
  return "neutral";
}

type DataRowProps = {
  icon: typeof Clock;
  value: string;
};

function DataRow({ icon: Icon, value }: DataRowProps) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Icon size={12} color="rgb(153 153 153)" strokeWidth={1.5} />
      <Text className="font-sans-medium text-foreground/80 text-[11px]">{value}</Text>
    </View>
  );
}

export function EntityTrackCard({ name, time, altitude, status, onPress }: EntityCardProps) {
  return (
    <Pressable
      className="border-border/30 bg-foreground/5 active:bg-foreground/10 mb-1 rounded-md border px-2.5 py-2"
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
          {time && <DataRow icon={Clock} value={time} />}
          <DataRow icon={Mountain} value={altitude} />
        </View>
        <Badge variant={getBadgeVariant(status)} size="sm">
          {status}
        </Badge>
      </View>
    </Pressable>
  );
}
