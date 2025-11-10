"use no memo";

import { GripHorizontal, GripVertical } from "lucide-react-native";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";
import { useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { cn } from "../lib/utils";
import type { PanelSide } from "./types";

const SPRING_CONFIG = {
  damping: 30,
  stiffness: 200,
  mass: 1,
  overshootClamping: true,
};

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}

type Direction = "horizontal" | "vertical";

type ResizeHandleProps = {
  direction: Direction;
  side?: PanelSide;
  value: SharedValue<number>;
  min: number;
  max: number;
  collapsedValue: SharedValue<number>;
  expandedValue: SharedValue<number>;
};

export function ResizeHandle({
  direction,
  side,
  value,
  min,
  max,
  collapsedValue,
  expandedValue,
}: ResizeHandleProps) {
  const startValue = useSharedValue(0);
  const isHorizontal = direction === "horizontal";
  const activeOffset = isHorizontal ? { x: [-5, 5], y: 0 } : { x: 0, y: [-5, 5] };

  const gesture = Gesture.Pan()
    .activeOffsetX(activeOffset.x as [number, number])
    .activeOffsetY(activeOffset.y as [number, number])
    .onStart(() => {
      startValue.value = value.value;
    })
    .onUpdate((e) => {
      if (isHorizontal) {
        const delta = side === "left" ? e.translationX : -e.translationX;
        value.value = clamp(startValue.value + delta, min, max);
      } else {
        const delta = -e.translationY;
        const newValue = clamp(startValue.value + delta, min, max);
        value.value = newValue;
      }
    })
    .onEnd(() => {
      if (!isHorizontal) {
        const currentHeight = value.value;

        const snapCollapsed = collapsedValue.value;
        const snapSmall = expandedValue.value * 0.33;
        const snapMedium = expandedValue.value * 0.66;
        const snapFull = expandedValue.value;

        // Snap to nearest of 4 points
        const distances = [
          { height: snapCollapsed, distance: Math.abs(currentHeight - snapCollapsed) },
          { height: snapSmall, distance: Math.abs(currentHeight - snapSmall) },
          { height: snapMedium, distance: Math.abs(currentHeight - snapMedium) },
          { height: snapFull, distance: Math.abs(currentHeight - snapFull) },
        ];
        const targetHeight = distances.reduce((prev, curr) =>
          curr.distance < prev.distance ? curr : prev,
        ).height;

        if (targetHeight === snapCollapsed) {
          value.value = withTiming(targetHeight, { duration: 250 });
        } else {
          value.value = withSpring(targetHeight, SPRING_CONFIG);
        }
      } else {
        value.value = withSpring(clamp(value.value, min, max), SPRING_CONFIG);
      }
    });

  return (
    <GestureDetector gesture={gesture}>
      <View
        className={
          isHorizontal
            ? cn(
                "absolute top-0 bottom-0 z-10 flex w-3 cursor-ew-resize items-center justify-center",
                side === "left" ? "-right-1.5" : "-left-1.5",
              )
            : "absolute -top-3 left-1/2 z-10 -ml-3 flex size-6 cursor-ns-resize items-center justify-center"
        }
      >
        <View
          className="opacity-60 hover:opacity-100"
          style={{
            backgroundColor: "rgba(48, 48, 48, 0.8)",
            borderRadius: 4,
            width: isHorizontal ? 16 : 24,
            height: isHorizontal ? 24 : 16,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isHorizontal ? (
            <GripVertical size={13} color="rgba(255, 255, 255, 1)" strokeWidth={2} />
          ) : (
            <GripHorizontal size={13} color="rgba(255, 255, 255, 1)" strokeWidth={2} />
          )}
        </View>
      </View>
    </GestureDetector>
  );
}
