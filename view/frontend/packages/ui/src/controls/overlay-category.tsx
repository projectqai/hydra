import type { LucideIcon } from "lucide-react-native";
import { Text, View } from "react-native";

import { OverlayToggle, type ThemeColor } from "./overlay-toggle";

type BaseOption = {
  id: string;
  label: string;
};

export type OverlayCategoryOption = BaseOption &
  ({ color: ThemeColor; icon?: never } | { icon: LucideIcon; color?: never });

export type OverlayCategoryProps = {
  title: string;
  options: OverlayCategoryOption[];
  activeStates: Record<string, boolean>;
  onToggle: (id: string) => void;
};

export function OverlayCategory({ title, options, activeStates, onToggle }: OverlayCategoryProps) {
  return (
    <View className="gap-1.5">
      <Text
        selectable={false}
        className="text-[12px] font-medium tracking-wider text-white/40 uppercase"
      >
        {title}
      </Text>
      <View className="flex-row flex-wrap gap-1">
        {options.map((option) => (
          <OverlayToggle
            key={option.id}
            label={option.label}
            color={option.color}
            icon={option.icon}
            isActive={activeStates[option.id] ?? false}
            onToggle={() => onToggle(option.id)}
          />
        ))}
      </View>
    </View>
  );
}
