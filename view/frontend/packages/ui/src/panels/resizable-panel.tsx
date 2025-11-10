import { Children, isValidElement, type ReactNode, useContext } from "react";
import { Platform, ScrollView, TouchableOpacity, useWindowDimensions } from "react-native";
import Animated, {
  interpolate,
  runOnUI,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { GradientPanel } from "../lib/theme";
import { PanelCollapsed } from "./panel-collapsed";
import { PanelContent } from "./panel-content";
import { PanelContext } from "./panel-context";
import { ResizeHandle } from "./resize-handle";
import type { ResizablePanelProps } from "./types";
import { usePanelState } from "./use-panel-state";

const SPRING_CONFIG = {
  damping: 35,
  stiffness: 180,
  mass: 1,
  overshootClamping: true,
};

const DEFAULT_WIDTH_DESKTOP = 280;
const DEFAULT_WIDTH_MOBILE = 200;
const MOBILE_BREAKPOINT = 768;
const MIN_WIDTH = 180;
const MAX_WIDTH = 600;
const COLLAPSED_HEIGHT = 60;

export const PANEL_TOP_OFFSET = Platform.OS === "web" ? 90 : 100;

const SCROLL_CONTENT_STYLE = { flexGrow: 1 };

function setHeightWithSpring(heightValue: SharedValue<number>, target: number) {
  "worklet";
  heightValue.value = withSpring(target, SPRING_CONFIG);
}

function setBooleanValue(sharedValue: SharedValue<boolean>, value: boolean) {
  "worklet";
  if (sharedValue.value !== value) {
    sharedValue.value = value;
  }
}

function setNumberValue(sharedValue: SharedValue<number>, value: number) {
  "worklet";
  sharedValue.value = value;
}

function ResizablePanelComponent(props: ResizablePanelProps) {
  return <ResizablePanelAnimated {...props} />;
}

function ResizablePanelAnimated({
  side,
  defaultWidth,
  minWidth = MIN_WIDTH,
  maxWidth = MAX_WIDTH,
  defaultHeight,
  collapsedHeight = COLLAPSED_HEIGHT,
  defaultCollapsed = false,
  collapsed,
  children,
}: ResizablePanelProps) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const panelWidth = defaultWidth ?? (isMobile ? DEFAULT_WIDTH_MOBILE : DEFAULT_WIDTH_DESKTOP);
  const maxHeight = defaultHeight ?? windowHeight - PANEL_TOP_OFFSET;

  const panelContext = useContext(PanelContext);

  const childArray = Children.toArray(children);
  const collapsedChild = childArray.find(
    (child) => isValidElement(child) && child.type === PanelCollapsed,
  );
  const contentChild = childArray.find(
    (child) => isValidElement(child) && child.type === PanelContent,
  );

  const collapsedContent = isValidElement(collapsedChild)
    ? (collapsedChild.props as { children: ReactNode }).children
    : null;
  const expandedContent = isValidElement(contentChild)
    ? (contentChild.props as { children: ReactNode }).children
    : children;

  const { width, height, expandedHeightValue, collapsedHeightValue } = usePanelState({
    defaultWidth: panelWidth,
    defaultHeight: maxHeight,
    collapsedHeight,
    defaultCollapsed,
  });

  useAnimatedReaction(
    () => panelContext?.isFullscreen.value ?? false,
    (isFullscreen, prevFullscreen) => {
      if (prevFullscreen == null || isFullscreen === prevFullscreen) return;

      const targetHeight = isFullscreen ? collapsedHeightValue.value : expandedHeightValue.value;
      setHeightWithSpring(height, targetHeight);
    },
    [],
  );

  const rightPanelCollapsed = panelContext?.rightPanelCollapsed;

  useAnimatedReaction(
    () => collapsed ?? false,
    (shouldCollapse, prevShouldCollapse) => {
      if (prevShouldCollapse == null || shouldCollapse === prevShouldCollapse) return;

      const targetHeight = shouldCollapse ? collapsedHeightValue.value : expandedHeightValue.value;
      setHeightWithSpring(height, targetHeight);

      if (!shouldCollapse && panelContext?.isFullscreen.value) {
        setBooleanValue(panelContext.isFullscreen, false);
      }
    },
  );

  const mapControlsHeight = panelContext?.mapControlsHeight;
  useAnimatedReaction(
    () => height.value,
    (currentHeight) => {
      if (side === "right" && rightPanelCollapsed && mapControlsHeight) {
        const panelTopFromBottom = currentHeight + 12;
        const controlsHeight = mapControlsHeight.value || 400;
        const threshold = maxHeight - controlsHeight;
        const shouldCollapse = panelTopFromBottom < threshold;
        setBooleanValue(rightPanelCollapsed, shouldCollapse);
      }
    },
  );

  const rightPanelWidth = panelContext?.rightPanelWidth;
  useAnimatedReaction(
    () => width.value,
    (currentWidth) => {
      if (side === "right" && rightPanelWidth) {
        setNumberValue(rightPanelWidth, currentWidth);
      }
    },
    [],
  );

  const animatedContainerStyle = useAnimatedStyle(() => {
    return {
      position: "absolute",
      width: width.value,
      height: height.value,
      bottom: 12,
      left: side === "left" ? 12 : undefined,
      right: side === "right" ? 12 : undefined,
    };
  });

  const collapsedContentStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      height.value,
      [collapsedHeight, collapsedHeight + 50],
      [1, 0],
      "clamp",
    );
    const scale = interpolate(
      height.value,
      [collapsedHeight, collapsedHeight + 50],
      [1, 0.9],
      "clamp",
    );

    return {
      opacity: withSpring(opacity, SPRING_CONFIG),
      transform: [{ scale: withSpring(scale, SPRING_CONFIG) }],
      pointerEvents: height.value < collapsedHeight + 30 ? ("auto" as const) : ("none" as const),
    };
  });

  const expandedContentStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      height.value,
      [collapsedHeight + 30, collapsedHeight + 100],
      [0, 1],
      "clamp",
    );
    const translateY = interpolate(
      height.value,
      [collapsedHeight + 30, collapsedHeight + 100],
      [20, 0],
      "clamp",
    );

    return {
      opacity: withSpring(opacity, SPRING_CONFIG),
      transform: [{ translateY: withSpring(translateY, SPRING_CONFIG) }],
      pointerEvents: height.value > collapsedHeight + 50 ? ("auto" as const) : ("none" as const),
    };
  });

  const handlesVisibilityStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      height.value,
      [collapsedHeight, collapsedHeight + 30],
      [0, 1],
      "clamp",
    );
    return {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      opacity: withSpring(opacity, SPRING_CONFIG),
    };
  });

  return (
    <Animated.View style={animatedContainerStyle}>
      <GradientPanel className="border-border/40 flex-1 overflow-hidden rounded-xl border">
        <Animated.View
          style={[
            collapsedContentStyle,
            {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              justifyContent: "center",
              alignItems: "center",
            },
          ]}
        >
          <TouchableOpacity
            style={{ width: "100%", height: "100%" }}
            className="items-center justify-center outline-none"
            onPress={() => {
              runOnUI(() => {
                "worklet";
                setHeightWithSpring(height, expandedHeightValue.value);

                if (panelContext) {
                  // Exit fullscreen when any panel expands
                  if (panelContext.isFullscreen.value) {
                    setBooleanValue(panelContext.isFullscreen, false);
                  }

                  if (side === "right") {
                    setBooleanValue(panelContext.rightPanelCollapsed, false);
                  }
                }
              })();
            }}
          >
            {collapsedContent || expandedContent}
          </TouchableOpacity>
        </Animated.View>

        <Animated.View style={[expandedContentStyle, { flex: 1 }]}>
          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={SCROLL_CONTENT_STYLE}
          >
            {expandedContent}
          </ScrollView>
        </Animated.View>
      </GradientPanel>

      <Animated.View style={handlesVisibilityStyle} pointerEvents="box-none">
        <ResizeHandle
          direction="horizontal"
          side={side}
          value={width}
          min={minWidth}
          max={maxWidth}
          collapsedValue={collapsedHeightValue}
          expandedValue={expandedHeightValue}
        />
        <ResizeHandle
          direction="vertical"
          value={height}
          min={collapsedHeight}
          max={maxHeight}
          collapsedValue={collapsedHeightValue}
          expandedValue={expandedHeightValue}
        />
      </Animated.View>
    </Animated.View>
  );
}

export const ResizablePanel = Object.assign(ResizablePanelComponent, {
  Collapsed: PanelCollapsed,
  Content: PanelContent,
});

export { usePanelContext } from "./panel-context";
export { PanelProvider } from "./panel-provider";
export type { PanelSide, ResizablePanelProps } from "./types";
