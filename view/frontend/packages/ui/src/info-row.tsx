import * as Clipboard from "expo-clipboard";
import { Copy } from "lucide-react-native";
import type { ComponentType, ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { toast } from "sonner-native";

import { cn } from "./lib/utils";

type InfoRowProps = {
  icon?: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  label: string;
  value: ReactNode;
  copyValue?: string;
  onCopy?: boolean;
  className?: string;
};

export function InfoRow({ icon: Icon, label, value, copyValue, onCopy, className }: InfoRowProps) {
  const handleCopy = async () => {
    if (!onCopy) return;
    const textToCopy = copyValue ?? (typeof value === "string" ? value : undefined);
    if (textToCopy) {
      await Clipboard.setStringAsync(textToCopy);
      toast("Copied to clipboard");
    }
  };

  return (
    <View className={cn("flex-row items-center gap-2 py-1.5", className)}>
      {Icon && (
        <View className="w-5 items-center">
          <Icon size={15} color="rgba(255, 255, 255, 0.5)" strokeWidth={2} />
        </View>
      )}
      <View className="flex-1 flex-row items-center justify-between gap-2">
        <Text className="font-sans-medium text-foreground/60 text-xs">{label}</Text>
        <View className="flex-row items-center gap-1.5">
          <Text className="font-sans-medium text-foreground/90 text-xs">
            {typeof value === "string" || typeof value === "number" ? value : value}
          </Text>
          {onCopy && (copyValue || typeof value === "string") && (
            <Pressable
              onPress={handleCopy}
              hitSlop={8}
              className="hover:opacity-70 active:opacity-50"
            >
              <Copy size={12} color="rgba(255, 255, 255, 0.4)" strokeWidth={2} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
