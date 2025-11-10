import type { Entity } from "@projectqai/proto/world";
import { Radio } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";

type ComponentsTabProps = {
  entity: Entity;
};

export function ComponentsTab({ entity }: ComponentsTabProps) {
  const hasComponents = entity.track || entity.camera || entity.detection;

  if (!hasComponents) {
    return (
      <View className="flex-1 items-center justify-center px-2.5 py-6">
        <Text className="font-sans-medium text-foreground/40 text-sm">No data available</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1">
      <View>
        <View className="px-3 pt-2 pb-2">
          <Text className="text-foreground/50 mb-1 font-mono text-[11px] tracking-widest uppercase">
            Active Components
          </Text>
          {entity.track && (
            <View className="flex-row items-center gap-2 py-1.5">
              <View className="w-5 items-center">
                <Radio size={15} color="rgba(255, 255, 255, 0.5)" strokeWidth={2} />
              </View>
              <Text className="font-sans-medium text-foreground/80 text-xs">Track</Text>
            </View>
          )}
          {entity.camera && (
            <View className="flex-row items-center gap-2 py-1.5">
              <View className="w-5 items-center">
                <Radio size={15} color="rgba(255, 255, 255, 0.5)" strokeWidth={2} />
              </View>
              <Text className="font-sans-medium text-foreground/80 text-xs">Camera</Text>
            </View>
          )}
          {entity.detection && (
            <View className="flex-row items-center gap-2 py-1.5">
              <View className="w-5 items-center">
                <Radio size={15} color="rgba(255, 255, 255, 0.5)" strokeWidth={2} />
              </View>
              <Text className="font-sans-medium text-foreground/80 text-xs">Detection</Text>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
