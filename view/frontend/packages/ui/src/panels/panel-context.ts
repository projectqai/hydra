import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";

export type PanelContextValue = {
  isFullscreen: SharedValue<boolean>;
  rightPanelCollapsed: SharedValue<boolean>;
  rightPanelWidth: SharedValue<number>;
  leftPanelWidth: SharedValue<number>;
  mapControlsHeight: SharedValue<number>;
  rightPanelFocused: boolean;
  collapseAll: () => void;
  expandAll: () => void;
  toggleFullscreen: () => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  focusRightPanel: () => void;
  unfocusRightPanel: () => void;
};

export const PanelContext = createContext<PanelContextValue | null>(null);

export function usePanelContext() {
  const context = useContext(PanelContext);
  if (!context) {
    throw new Error("usePanelContext must be used within PanelProvider");
  }
  return context;
}
