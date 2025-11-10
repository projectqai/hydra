import { type LucideIcon } from "lucide-react-native";
import { type ReactElement, type ReactNode, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { cn } from "../lib/utils";

type TabProps = {
  name: string;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  children: ReactNode;
};

type TabsProps = {
  children:
    | ReactElement<TabProps>
    | (ReactElement<TabProps> | false | null | undefined)[]
    | false
    | null
    | undefined;
  initialTab?: string;
  currentTab?: string;
  onTabChange?: (tabName: string) => void;
};

export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

export function Tabs({ children, initialTab, currentTab, onTabChange }: TabsProps) {
  const childrenArray = (Array.isArray(children) ? children : [children]).filter(
    (child): child is ReactElement<TabProps> => Boolean(child),
  );

  const tabs = childrenArray.map((child) => ({
    name: child.props.name,
    title: child.props.title,
    subtitle: child.props.subtitle,
    icon: child.props.icon,
  }));

  const [internalTab, setInternalTab] = useState(initialTab ?? tabs[0]?.name ?? "");
  const activeTab = currentTab ?? internalTab;

  const handleTabPress = (tabName: string) => {
    if (!currentTab) {
      setInternalTab(tabName);
    }
    onTabChange?.(tabName);
  };

  const activeChild = childrenArray.find((child) => child.props.name === activeTab);

  return (
    <View className="flex-1">
      <View className="border-border flex-row border-b">
        {tabs.map((tab) => {
          const isActive = tab.name === activeTab;
          const Icon = tab.icon;
          return (
            <Pressable
              key={tab.name}
              onPress={() => handleTabPress(tab.name)}
              className={cn("flex-1 items-center justify-center py-2")}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
              })}
            >
              {Icon ? (
                <View className="items-center gap-0.5">
                  <Icon
                    size={18}
                    color={isActive ? "rgba(220, 220, 220, 0.7)" : "rgba(220, 220, 220, 0.3)"}
                    strokeWidth={2}
                  />
                  {tab.subtitle && (
                    <Text
                      className={cn(
                        "text-xs",
                        isActive ? "text-foreground/90" : "text-foreground/30",
                      )}
                      numberOfLines={1}
                    >
                      {tab.subtitle}
                    </Text>
                  )}
                </View>
              ) : (
                <Text
                  className={cn(
                    "text-sm font-medium",
                    isActive ? "text-foreground/90" : "text-foreground/30",
                  )}
                  numberOfLines={1}
                >
                  {tab.title}
                </Text>
              )}
              {isActive && <View className="bg-primary absolute bottom-0 h-0.5 w-full" />}
            </Pressable>
          );
        })}
      </View>
      <View className="flex-1">{activeChild?.props.children}</View>
    </View>
  );
}
