import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Animated, Text, TouchableOpacity, View } from "react-native";

import { cn } from "../lib/utils";

const INDICATOR_BASE_WIDTH = 80;
const HORIZONTAL_PADDING = 16;

type TabConfig = {
  name: string;
  title: string;
};

type Route = {
  key: string;
  name: string;
};

type TabBarProps = {
  tabs: TabConfig[];
  state: {
    index: number;
    routes: Route[];
  };
  navigation: {
    emit: (event: { type: string; target: string; canPreventDefault: boolean }) => {
      defaultPrevented: boolean;
    };
    navigate: (name: string) => void;
  };
  position: Animated.AnimatedInterpolation<number>;
};

export function TabBar({ tabs, state, navigation, position }: TabBarProps) {
  const [layouts, setLayouts] = useState<Record<string, { x: number; width: number }>>({});

  const allLayoutsAvailable = tabs.every((tab) => layouts[tab.name]);

  if (!allLayoutsAvailable) {
    return (
      <View className="relative px-4 pt-2">
        <Animated.View
          className="bg-foreground/90 absolute bottom-0 h-0.5"
          style={{ transform: [{ translateX: HORIZONTAL_PADDING }, { scaleX: 1 }] }}
        />
        <View className="flex-row gap-6">
          {tabs.map((tab, index) => {
            const isFocused = state.index === index;
            const route = state.routes.find((r) => r.name === tab.name);
            if (!route) return null;

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <TouchableOpacity
                key={tab.name}
                onPress={onPress}
                onLayout={(e: LayoutChangeEvent) => {
                  const { x, width } = e.nativeEvent.layout;
                  setLayouts((prev) => ({
                    ...prev,
                    [tab.name]: { x, width },
                  }));
                }}
                className="py-3"
              >
                <Text
                  className={cn(
                    "font-sans-medium text-xs",
                    isFocused ? "text-foreground" : "text-foreground/60",
                  )}
                >
                  {tab.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  const inputRange = state.routes.map((_, i) => i);

  const translateX = position.interpolate({
    inputRange,
    outputRange: inputRange.map((i) => {
      const { x = 0, width = INDICATOR_BASE_WIDTH } = layouts[state.routes[i]?.name ?? ""] ?? {};
      const scale = width / INDICATOR_BASE_WIDTH;
      const scaleOffset = (INDICATOR_BASE_WIDTH / 2) * (scale - 1);
      return x + HORIZONTAL_PADDING + scaleOffset;
    }),
  });

  const scaleX = position.interpolate({
    inputRange,
    outputRange: inputRange.map((i) => {
      const { width = INDICATOR_BASE_WIDTH } = layouts[state.routes[i]?.name ?? ""] ?? {};
      return width / INDICATOR_BASE_WIDTH;
    }),
  });

  return (
    <View className="relative px-4 pt-2">
      <Animated.View
        className="bg-foreground/90 absolute bottom-0 h-0.5"
        style={{
          width: INDICATOR_BASE_WIDTH,
          transform: [{ translateX }, { scaleX }],
        }}
      />
      <View className="flex-row gap-6">
        {tabs.map((tab, index) => {
          const isFocused = state.index === index;
          const route = state.routes.find((r) => r.name === tab.name);
          if (!route) return null;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={tab.name}
              onPress={onPress}
              onLayout={(e: LayoutChangeEvent) => {
                const { x, width } = e.nativeEvent.layout;
                setLayouts((prev) => ({
                  ...prev,
                  [tab.name]: { x, width },
                }));
              }}
              className="py-3"
            >
              <Text
                className={cn(
                  "font-sans-medium text-xs",
                  isFocused ? "text-foreground" : "text-foreground/60",
                )}
              >
                {tab.title}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
