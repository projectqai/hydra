import type { ComponentType, ReactNode } from "react";
import { Text, View } from "react-native";

import { cn } from "./lib/utils";

export type BadgeVariant =
  | "success"
  | "danger"
  | "warning"
  | "neutral"
  | "info"
  | "affiliation-blue"
  | "affiliation-red"
  | "affiliation-neutral"
  | "affiliation-unknown";
export type BadgeSize = "sm" | "md" | "lg";

type BadgeProps = {
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: ComponentType<{ size: number; color: string }>;
  children: ReactNode;
};

const variantStyles: Record<BadgeVariant, string> = {
  success: "bg-success/20 border-success/40",
  danger: "bg-red/20 border-red/40",
  warning: "bg-warning/20 border-warning/40",
  neutral: "bg-foreground/10 border-foreground/20",
  info: "bg-blue/20 border-blue/40",
  "affiliation-blue": "bg-milsymbol-friend/20 border-milsymbol-friend/40",
  "affiliation-red": "bg-milsymbol-hostile/20 border-milsymbol-hostile/40",
  "affiliation-neutral": "bg-milsymbol-neutral/20 border-milsymbol-neutral/40",
  "affiliation-unknown": "bg-milsymbol-unknown/20 border-milsymbol-unknown/40",
};

const textVariantStyles: Record<BadgeVariant, string> = {
  success: "text-success",
  danger: "text-red",
  warning: "text-warning",
  neutral: "text-foreground/80",
  info: "text-blue",
  "affiliation-blue": "text-milsymbol-friend",
  "affiliation-red": "text-milsymbol-hostile",
  "affiliation-neutral": "text-milsymbol-neutral",
  "affiliation-unknown": "text-milsymbol-unknown",
};

const sizeStyles: Record<BadgeSize, { container: string; text: string; icon: number }> = {
  sm: { container: "px-1.5 py-0.5 gap-1", text: "text-[10px]", icon: 10 },
  md: { container: "px-2 py-1 gap-1.5", text: "text-xs", icon: 12 },
  lg: { container: "px-2.5 py-1.5 gap-2", text: "text-sm", icon: 14 },
};

export function Badge({ variant = "neutral", size = "md", icon: Icon, children }: BadgeProps) {
  const styles = sizeStyles[size];

  return (
    <View
      className={cn(
        "flex-row items-center justify-center rounded-md border",
        variantStyles[variant],
        styles.container,
      )}
    >
      {Icon && <Icon size={styles.icon} color="currentColor" />}
      <Text className={cn("font-sans-medium", styles.text, textVariantStyles[variant])}>
        {children}
      </Text>
    </View>
  );
}
