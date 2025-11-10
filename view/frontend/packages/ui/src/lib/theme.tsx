import { LinearGradient } from "expo-linear-gradient";
import type { ComponentProps } from "react";

export const GRADIENT_COLORS = [
  "rgba(19, 19, 19, 0.95)",
  "rgba(24, 24, 24, 0.95)",
  "rgba(31, 31, 31, 0.95)",
  "rgba(38, 38, 38, 0.95)",
  "rgba(48, 48, 48, 0.95)",
] as const;

export const GRADIENT_COLORS_ACTIVE = [
  "rgba(38, 38, 38, 0.95)",
  "rgba(45, 45, 45, 0.95)",
  "rgba(52, 52, 52, 0.95)",
  "rgba(58, 58, 58, 0.95)",
  "rgba(65, 65, 65, 0.95)",
] as const;

export const GRADIENT_COLORS_DENSE = [
  "rgba(19, 19, 19, 0.98)",
  "rgba(24, 24, 24, 0.98)",
  "rgba(31, 31, 31, 0.98)",
  "rgba(38, 38, 38, 0.98)",
  "rgba(48, 48, 48, 0.98)",
] as const;

export const GRADIENT_COLORS_CARD = [
  "rgba(27, 27, 27, 0.95)",
  "rgba(30, 30, 30, 0.95)",
  "rgba(33, 33, 33, 0.95)",
  "rgba(36, 36, 36, 0.95)",
  "rgba(39, 39, 39, 0.95)",
] as const;

export const GRADIENT_PROPS = {
  locations: [0, 0.25, 0.5, 0.75, 1] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

const GRADIENT_VARIANT_COLORS = {
  default: GRADIENT_COLORS,
  active: GRADIENT_COLORS_ACTIVE,
  dense: GRADIENT_COLORS_DENSE,
  card: GRADIENT_COLORS_CARD,
} as const;

type GradientVariant = keyof typeof GRADIENT_VARIANT_COLORS;

type GradientPanelProps = Omit<ComponentProps<typeof LinearGradient>, "colors"> & {
  variant?: GradientVariant;
};

export function GradientPanel({ variant = "default", children, ...props }: GradientPanelProps) {
  return (
    <LinearGradient colors={GRADIENT_VARIANT_COLORS[variant]} {...GRADIENT_PROPS} {...props}>
      {children}
    </LinearGradient>
  );
}
