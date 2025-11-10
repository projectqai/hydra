"use no memo";

import { useEffect } from "react";
import { runOnUI, useSharedValue } from "react-native-reanimated";

import type { PanelState } from "./types";

type UsePanelStateOptions = {
  defaultWidth: number;
  defaultHeight: number;
  collapsedHeight: number;
  defaultCollapsed: boolean;
};

export function usePanelState({
  defaultWidth,
  defaultHeight,
  collapsedHeight,
  defaultCollapsed,
}: UsePanelStateOptions): PanelState {
  const width = useSharedValue(defaultWidth);
  const height = useSharedValue(defaultCollapsed ? collapsedHeight : defaultHeight);
  const expandedHeightValue = useSharedValue(defaultHeight);
  const collapsedHeightValue = useSharedValue(collapsedHeight);

  useEffect(() => {
    runOnUI(() => {
      "worklet";
      width.value = defaultWidth;
    })();
  }, [defaultWidth]);

  useEffect(() => {
    runOnUI(() => {
      "worklet";
      expandedHeightValue.value = defaultHeight;
      if (!defaultCollapsed && height.value > collapsedHeight + 30) {
        height.value = defaultHeight;
      }
    })();
  }, [defaultHeight, defaultCollapsed, collapsedHeight]);

  const setWidth = (newWidth: number) => {
    "worklet";
    width.value = newWidth;
  };

  const setHeight = (newHeight: number) => {
    "worklet";
    height.value = newHeight;
    if (Math.abs(newHeight - collapsedHeight) > 10) {
      expandedHeightValue.value = newHeight;
    }
  };

  return {
    width,
    height,
    expandedHeightValue,
    collapsedHeightValue,
    setWidth,
    setHeight,
  };
}
