"use no memo";

import { type ReactNode, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { runOnUI, useSharedValue } from "react-native-reanimated";

import { PanelContext, type PanelContextValue } from "./panel-context";

type PanelProviderProps = {
  children: ReactNode;
};

export function PanelProvider({ children }: PanelProviderProps) {
  const isFullscreen = useSharedValue(false);
  const rightPanelCollapsed = useSharedValue(false);
  const rightPanelWidth = useSharedValue(280);
  const mapControlsHeight = useSharedValue(0);
  const [rightPanelFocused, setRightPanelFocused] = useState(false);

  const focusRightPanel = () => setRightPanelFocused(true);
  const unfocusRightPanel = () => setRightPanelFocused(false);

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
    mapControlsHeight,
    rightPanelFocused,
    collapseAll,
    expandAll,
    toggleFullscreen,
    setRightPanelCollapsed,
    focusRightPanel,
    unfocusRightPanel,
  };

  return (
    <PanelContext.Provider value={contextValue}>
      <GestureHandlerRootView className="flex-1">{children}</GestureHandlerRootView>
    </PanelContext.Provider>
  );
}
