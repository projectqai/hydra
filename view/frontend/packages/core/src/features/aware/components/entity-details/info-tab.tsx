import { InfoRow } from "@hydra/ui/info-row";
import type { Entity } from "@projectqai/proto/world";
import * as Clipboard from "expo-clipboard";
import { Calendar, Copy } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { toast } from "sonner-native";

import { formatTime } from "../../../../lib/api/use-track-utils";

type InfoTabProps = {
  entity: Entity;
};

export function InfoTab({ entity }: InfoTabProps) {
  const copyMilSymbol = async () => {
    if (entity.symbol?.milStd2525C) {
      await Clipboard.setStringAsync(entity.symbol.milStd2525C);
      toast("Copied to clipboard");
    }
  };

  const hasSymbol = !!entity.symbol?.milStd2525C;
  const hasLifetime = !!entity.lifetime;

  if (!hasSymbol && !hasLifetime) {
    return (
      <View className="flex-1 items-center justify-center px-2.5 py-6">
        <Text className="font-sans-medium text-foreground/40 text-sm">No data available</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1">
      <View>
        {entity.symbol && (
          <View className="px-3 pt-2 pb-2">
            <View className="mb-1 flex-row items-center justify-between">
              <Text className="text-foreground/50 font-mono text-[11px] tracking-widest uppercase">
                Military Symbol
              </Text>
              <Pressable
                onPress={copyMilSymbol}
                hitSlop={8}
                className="hover:opacity-70 active:opacity-50"
              >
                <Copy size={12} color="rgba(255, 255, 255, 0.4)" strokeWidth={2} />
              </Pressable>
            </View>
            <InfoRow label="MIL-STD-2525C" value={entity.symbol.milStd2525C} />
          </View>
        )}

        {entity.lifetime && (
          <View className={`px-3 pt-3 pb-2 ${hasSymbol ? "border-foreground/10 border-t" : ""}`}>
            <Text className="text-foreground/50 mb-1 font-mono text-[11px] tracking-widest uppercase">
              Lifetime
            </Text>
            {entity.lifetime.from && (
              <InfoRow icon={Calendar} label="From" value={formatTime(entity.lifetime.from)} />
            )}
            {entity.lifetime.until && (
              <InfoRow icon={Calendar} label="Until" value={formatTime(entity.lifetime.until)} />
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
