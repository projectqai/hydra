import { GRADIENT_PROPS, GradientPanel } from "@hydra/ui/lib/theme";
import { cn } from "@hydra/ui/lib/utils";
import { FloatingSheet, type SheetOption } from "@hydra/ui/sheets/floating-sheet";
import { TimeWidget } from "@hydra/ui/widgets/time-widget";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { type Href, usePathname, useRootNavigationState, useRouter } from "expo-router";
import { Bell, Layers, LayoutGrid } from "lucide-react-native";
import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type TopNavContextValue = {
  pathname: string | null;
  isActive: (path: string) => boolean;
};

const TopNavContext = createContext<TopNavContextValue | null>(null);

function useTopNav() {
  const context = useContext(TopNavContext);
  if (!context) throw new Error("TopNav components must be used within TopNav.Root");
  return context;
}

function Root({ children }: { children: ReactNode }) {
  const navigationState = useRootNavigationState();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  if (!navigationState?.key) return null;

  const isActive = (path: string): boolean => {
    if (!pathname) return false;
    if (path === "/") return pathname === "/";
    return pathname.startsWith(path);
  };

  return (
    <TopNavContext.Provider value={{ pathname, isActive }}>
      <View className="px-3" style={{ paddingTop: insets.top + (Platform.OS === "web" ? 12 : 0) }}>
        <View className="h-11 flex-row items-center justify-center">{children}</View>
      </View>
    </TopNavContext.Provider>
  );
}

function Left({ children }: { children: ReactNode }) {
  return <View className="absolute left-0">{children}</View>;
}

function Right({ children }: { children: ReactNode }) {
  return <View className="absolute right-0 flex-row items-center gap-1">{children}</View>;
}

function Logo() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push("/")} className="focus:outline-none">
      <Image
        source={require("@hydra/ui/assets/logo.png")}
        style={{ width: 36, height: 36, opacity: 0.8 }}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
    </Pressable>
  );
}

function Time() {
  return <TimeWidget />;
}

function LogoOrTime() {
  const { isActive } = useTopNav();
  return isActive("/aware") ? <Time /> : <Logo />;
}

type Section = {
  label: string;
  path: string;
};

function Sections({ items }: { items: Section[] }) {
  const router = useRouter();
  const { isActive } = useTopNav();

  return (
    <GradientPanel className="border-border/80 h-11 flex-row items-center gap-0.5 overflow-hidden rounded-xl border px-1.5">
      {items.map((section) => {
        const active = isActive(section.path);
        return (
          <Pressable
            key={section.path}
            onPress={() => router.push(section.path as Href)}
            className={cn(
              "group rounded-lg px-5 py-1.5 transition-colors focus:outline-none",
              active ? "bg-white/10" : "hover:bg-white/10",
            )}
          >
            <Text
              className={cn(
                "font-sans-semibold text-sm transition-colors",
                active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
              )}
            >
              {section.label}
            </Text>
          </Pressable>
        );
      })}
    </GradientPanel>
  );
}

function Workspace({ name = "Default" }: { name?: string }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push("/")}
      className="hover:opacity-90 focus:outline-none active:opacity-70"
    >
      <LinearGradient
        colors={[
          "rgba(31, 31, 31, 0.95)",
          "rgba(35, 35, 35, 0.95)",
          "rgba(38, 38, 38, 0.95)",
          "rgba(42, 42, 42, 0.95)",
          "rgba(48, 48, 48, 0.95)",
        ]}
        {...GRADIENT_PROPS}
        className="border-border/80 h-11 flex-row items-center gap-2.5 overflow-hidden rounded-xl border px-2.5 hover:border-white/20"
      >
        <View className="bg-accent size-7 items-center justify-center rounded-md">
          <Layers size={14} color="rgb(255 255 255)" />
        </View>
        <View>
          <Text className="font-sans-semibold text-foreground text-xs leading-none">{name}</Text>
          <Text className="text-muted-foreground font-sans text-[10px]">Workspace</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

function QuickActions({
  options,
  onSelect,
}: {
  options: SheetOption[];
  onSelect: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  const handleSelect = (id: string) => {
    onSelect(id);
    setVisible(false);
  };

  return (
    <>
      <LinearGradient
        colors={[
          "rgba(35, 35, 35, 0.95)",
          "rgba(38, 38, 38, 0.95)",
          "rgba(42, 42, 42, 0.95)",
          "rgba(46, 46, 46, 0.95)",
          "rgba(50, 50, 50, 0.95)",
        ]}
        {...GRADIENT_PROPS}
        className="border-border/80 size-11 overflow-hidden rounded-xl border hover:border-white/20"
      >
        <Pressable
          className="size-full items-center justify-center hover:opacity-90 focus:outline-none active:opacity-70"
          onPress={() => setVisible(true)}
        >
          <LayoutGrid size={15} color="rgb(255 255 255 / 0.7)" />
        </Pressable>
      </LinearGradient>
      <FloatingSheet
        visible={visible}
        onClose={() => setVisible(false)}
        onSelect={handleSelect}
        options={options}
      />
    </>
  );
}

function Alerts({ count = 0 }: { count?: number }) {
  return (
    <Pressable className="hover:opacity-90 focus:outline-none active:opacity-70">
      <LinearGradient
        colors={[
          "rgba(38, 38, 38, 0.95)",
          "rgba(42, 42, 42, 0.95)",
          "rgba(46, 46, 46, 0.95)",
          "rgba(50, 50, 50, 0.95)",
          "rgba(54, 54, 54, 0.95)",
        ]}
        {...GRADIENT_PROPS}
        className="border-border/80 size-11 items-center justify-center overflow-hidden rounded-xl border hover:border-white/20"
      >
        <Bell size={15} color="rgb(255 255 255 / 0.7)" />
        {count > 0 && <View className="absolute top-2 right-2 size-2 rounded-full bg-red-500" />}
      </LinearGradient>
    </Pressable>
  );
}

export const TopNav = {
  Root,
  Left,
  Right,
  Logo,
  Time,
  LogoOrTime,
  Sections,
  Workspace,
  QuickActions,
  Alerts,
};
