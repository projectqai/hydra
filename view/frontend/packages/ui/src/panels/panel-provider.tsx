"use no memo";

import type { ReactNode } from "react";
import { View } from "react-native";
import { runOnUI, useSharedValue } from "react-native-reanimated";

import { PanelContext, type PanelContextValue } from "./panel-context";

type PanelProviderProps = {
  children: ReactNode;
};

export function PanelProvider({ children }: PanelProviderProps) {
  const isFullscreen = useSharedValue(false);
  const rightPanelCollapsed = useSharedValue(false);
  const rightPanelWidth = useSharedValue(280);
  const leftPanelWidth = useSharedValue(280);
  const mapControlsHeight = useSharedValue(0);

  const collapseAll = () => {
    runOnUI(() => {
      "worklet";
      isFullscreen.value = true;
    })();
  };

  const expandAll = () => {
    runOnUI(() => {
      "worklet";
      isFullscreen.value = false;
    })();
  };

  const toggleFullscreen = () => {
    runOnUI(() => {
      "worklet";
      isFullscreen.value = !isFullscreen.value;
    })();
  };

  const setRightPanelCollapsed = (collapsed: boolean) => {
    runOnUI(() => {
      "worklet";
      rightPanelCollapsed.value = collapsed;
    })();
  };

  const contextValue: PanelContextValue = {
    isFullscreen,
    rightPanelCollapsed,
    rightPanelWidth,
    leftPanelWidth,
    mapControlsHeight,
    collapseAll,
    expandAll,
    toggleFullscreen,
    setRightPanelCollapsed,
  };

  return (
    <PanelContext.Provider value={contextValue}>
      <View className="flex-1">{children}</View>
    </PanelContext.Provider>
  );
}
