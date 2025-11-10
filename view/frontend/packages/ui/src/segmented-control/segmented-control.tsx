import { Pressable, Text, View } from "react-native";

import { cn } from "../lib/utils";

type Tab<T extends string> = {
  id: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  tabs: Tab<T>[];
  activeTab: T;
  onTabChange: (id: T) => void;
};

export function SegmentedControl<T extends string>({
  tabs,
  activeTab,
  onTabChange,
}: SegmentedControlProps<T>) {
  return (
    <View className="px-3 pt-4 pb-2">
      <View className="bg-muted/50 flex-row items-center gap-1 rounded-lg p-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onTabChange(tab.id)}
              className={cn(
                "flex-1 items-center rounded-md border py-1.5",
                isActive ? "border-border/40 bg-muted" : "border-transparent",
              )}
            >
              <Text
                className={cn(
                  "font-sans-medium text-xs",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
