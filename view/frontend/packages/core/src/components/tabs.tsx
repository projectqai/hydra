import { cn } from "@hydra/ui/lib/utils";
import { type Href, usePathname, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

type Tab = {
  label: string;
  path: string;
};

type TabsProps = {
  tabs: Tab[];
};

export function Tabs({ tabs }: TabsProps) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View className="px-4 pb-3">
      <View className="bg-muted/50 flex-row items-center gap-1 rounded-full px-2 py-2">
        {tabs.map((tab) => {
          const isActive = pathname === tab.path;
          return (
            <Pressable
              key={tab.path}
              onPress={() => router.push(tab.path as Href)}
              className={cn("mx-1 rounded-full px-5 py-2", isActive && "bg-muted")}
            >
              <Text
                className={cn(
                  "font-sans-medium text-sm",
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
