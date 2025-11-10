import type { ComponentProps } from "react";
import { View } from "react-native";

import { cn } from "./lib/utils";

function Card({ className, ...props }: ComponentProps<typeof View>) {
  return (
    <View className={cn("border-border/40 bg-card rounded-lg border p-3", className)} {...props} />
  );
}

function CardHeader({ className, ...props }: ComponentProps<typeof View>) {
  return <View className={cn("mb-2 flex-row items-start", className)} {...props} />;
}

function CardTitle({ className, ...props }: ComponentProps<typeof View>) {
  return <View className={cn("flex-1", className)} {...props} />;
}

function CardAction({ className, ...props }: ComponentProps<typeof View>) {
  return <View className={cn("", className)} {...props} />;
}

function CardContent({ className, ...props }: ComponentProps<typeof View>) {
  return <View className={cn("", className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<typeof View>) {
  return <View className={cn("flex-row items-center", className)} {...props} />;
}

export { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle };
