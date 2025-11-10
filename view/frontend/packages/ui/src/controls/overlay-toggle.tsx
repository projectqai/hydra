import type { LucideIcon } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { cn } from "../lib/utils";

export type ThemeColor = "red" | "yellow" | "blue" | "green";

const colorClasses: Record<ThemeColor, string> = {
  red: "bg-red",
  yellow: "bg-yellow",
  blue: "bg-blue",
  green: "bg-green",
};

export type OverlayToggleProps = {
  label: string;
  color?: ThemeColor;
  icon?: LucideIcon;
  isActive: boolean;
  onToggle: () => void;
};

export function OverlayToggle({
  label,
  color,
  icon: Icon,
  isActive,
  onToggle,
}: OverlayToggleProps) {
  return (
    <Pressable onPress={onToggle} className="hover:opacity-70 active:opacity-70">
      <View
        className={cn(
          "flex-row items-center gap-2 rounded px-2.5 py-1 select-none",
          isActive ? "bg-white/15" : "bg-white/5",
        )}
      >
        {Icon ? (
          <Icon
            size={12}
            strokeWidth={1.5}
            color={isActive ? "rgba(255,255,255,1)" : "rgba(255,255,255,0.5)"}
          />
        ) : color ? (
          <View
            className={cn("size-1.5 rounded-full", isActive ? colorClasses[color] : "bg-white/30")}
          />
        ) : null}
        <Text
          selectable={false}
          className={cn("text-sm", isActive ? "text-white" : "text-white/50")}
          style={{ fontWeight: isActive ? "500" : "400" }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
