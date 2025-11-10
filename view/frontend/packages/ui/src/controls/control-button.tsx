import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { Pressable } from "react-native";

import { GRADIENT_COLORS, GRADIENT_COLORS_ACTIVE, GRADIENT_PROPS } from "../lib/theme";

export type ControlButtonProps = {
  onPress: () => void;
  children: ReactNode;
  isActive?: boolean;
  size?: number;
};

export function ControlButton({ onPress, children, isActive, size = 40 }: ControlButtonProps) {
  return (
    <Pressable onPress={onPress} className="group focus:outline-none active:opacity-70">
      <LinearGradient
        colors={isActive ? GRADIENT_COLORS_ACTIVE : GRADIENT_COLORS}
        {...GRADIENT_PROPS}
        style={{ width: size, height: size, pointerEvents: "none" }}
        className="border-border/40 items-center justify-center overflow-hidden rounded-lg border transition-colors group-hover:border-white/20"
      >
        {children}
      </LinearGradient>
    </Pressable>
  );
}
