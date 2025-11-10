import { FloatingWindow } from "@hydra/ui/floating-window";
import { PANEL_TOP_OFFSET } from "@hydra/ui/panels";
import { Activity, GripHorizontal, X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { WebRTCStream } from "./components/webrtc";
import { usePIPContext } from "./pip-context";

export function PIPPlayer() {
  const { isVisible, entityId, entityName, cameraUrl, cameraLabel, closePIP } = usePIPContext();

  if (!isVisible) {
    return null;
  }

  return (
    <FloatingWindow
      isVisible={isVisible}
      minTop={PANEL_TOP_OFFSET - 12}
      header={
        <View className="flex-row items-center justify-between border-b border-white/10 px-4 py-3">
          <View className="flex-1 flex-row items-center gap-1">
            <GripHorizontal size={14} color="rgba(255, 255, 255, 0.3)" strokeWidth={1.5} />
            <Text className="font-sans-medium text-foreground/90 text-xs" numberOfLines={1}>
              {entityName || "Unknown"}
            </Text>
            {cameraLabel && (
              <>
                <Text className="text-foreground/30 font-mono text-[11px]">·</Text>
                <Text className="text-foreground/50 font-mono text-[11px]" numberOfLines={1}>
                  {cameraLabel}
                </Text>
              </>
            )}
          </View>
          <Pressable
            onPress={closePIP}
            hitSlop={8}
            className="relative z-50 ml-2 cursor-pointer active:opacity-50"
          >
            <X size={16} color="rgba(255, 255, 255, 0.5)" strokeWidth={2} />
          </Pressable>
        </View>
      }
      content={cameraUrl && <WebRTCStream url={cameraUrl} objectFit="contain" />}
      footer={
        <View className="flex-row items-center justify-between border-t border-white/10 bg-white/5 px-4 py-2">
          <View className="flex-row items-center gap-1.5">
            <Activity size={10} color="rgba(34, 197, 94, 0.7)" strokeWidth={2} />
            <Text className="text-success/70 font-mono text-[9px]">LIVE</Text>
          </View>
          {entityId && (
            <Text className="text-foreground/30 font-mono text-[9px]" numberOfLines={1}>
              {entityId}
            </Text>
          )}
        </View>
      }
    />
  );
}
