import { FloatingWindow } from "@hydra/ui/floating-window";
import { PANEL_TOP_OFFSET } from "@hydra/ui/panels";
import { Activity, GripHorizontal, X } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";

import { VideoStream } from "./components/video-stream/video-stream";
import { getInitialPosition, updateLastWindowPosition, usePIPContext } from "./pip-context";

const initialPositionsCache = new Map<string, { x: number; y: number }>();

function getWindowPosition(
  windowId: string,
  screenWidth: number,
  screenHeight: number,
): { x: number; y: number } {
  if (!initialPositionsCache.has(windowId)) {
    const pos = getInitialPosition(screenWidth, screenHeight, PANEL_TOP_OFFSET - 12);
    initialPositionsCache.set(windowId, pos);
    updateLastWindowPosition(pos);
  }
  return initialPositionsCache.get(windowId)!;
}

export function PIPPlayer() {
  const { windows, closePIP } = usePIPContext();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  useEffect(() => {
    if (windows.length === 0) {
      initialPositionsCache.clear();
      return;
    }
    const windowIds = new Set(windows.map((w) => w.id));
    for (const id of initialPositionsCache.keys()) {
      if (!windowIds.has(id)) {
        initialPositionsCache.delete(id);
      }
    }
  }, [windows]);

  if (windows.length === 0) {
    return null;
  }

  return (
    <>
      {windows.map((window) => (
        <FloatingWindow
          key={window.id}
          isVisible={true}
          minTop={PANEL_TOP_OFFSET - 12}
          initialPosition={getWindowPosition(window.id, screenWidth, screenHeight)}
          onPositionChange={updateLastWindowPosition}
          header={
            <View className="flex-row items-center justify-between border-b border-white/10 px-4 py-3">
              <View className="flex-1 flex-row items-center gap-1">
                <GripHorizontal size={14} color="rgba(255, 255, 255, 0.3)" strokeWidth={1.5} />
                <Text className="font-sans-medium text-foreground/90 text-xs" numberOfLines={1}>
                  {window.entityName || "Unknown"}
                </Text>
                {window.cameraLabel && (
                  <>
                    <Text className="text-foreground/30 font-mono text-[11px]">·</Text>
                    <Text className="text-foreground/50 font-mono text-[11px]" numberOfLines={1}>
                      {window.cameraLabel}
                    </Text>
                  </>
                )}
              </View>
              <Pressable
                onPress={() => closePIP(window.id)}
                hitSlop={8}
                className="relative z-50 ml-2 cursor-pointer active:opacity-50"
              >
                <X size={16} color="rgba(255, 255, 255, 0.5)" strokeWidth={2} />
              </Pressable>
            </View>
          }
          content={
            <VideoStream
              url={window.cameraUrl}
              protocol={window.cameraProtocol}
              objectFit="contain"
            />
          }
          footer={
            <View className="flex-row items-center justify-between border-t border-white/10 bg-white/5 px-4 py-2">
              <View className="flex-row items-center gap-1.5">
                <Activity size={10} color="rgba(34, 197, 94, 0.7)" strokeWidth={2} />
                <Text className="text-success/70 font-mono text-[9px]">LIVE</Text>
              </View>
              <Text className="text-foreground/30 font-mono text-[9px]" numberOfLines={1}>
                {window.entityId}
              </Text>
            </View>
          }
        />
      ))}
    </>
  );
}
