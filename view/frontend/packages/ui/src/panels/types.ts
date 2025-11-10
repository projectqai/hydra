import type { ReactNode } from "react";
import type { SharedValue } from "react-native-reanimated";

export type PanelSide = "left" | "right";

export type ResizablePanelProps = {
  side: PanelSide;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  defaultHeight?: number;
  minHeight?: number;
  collapsedHeight?: number;
  defaultCollapsed?: boolean;
  collapsed?: boolean;
  children: ReactNode;
};

export type PanelState = {
  width: SharedValue<number>;
  height: SharedValue<number>;
  expandedHeightValue: SharedValue<number>;
  collapsedHeightValue: SharedValue<number>;
  setWidth: (width: number) => void;
  setHeight: (height: number) => void;
};
