import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";

export type SheetOption = {
  readonly id: string;
  readonly title: string;
  readonly icon?: LucideIcon | string;
  readonly subtitle?: string;
  readonly action?: () => void;
  readonly hasNested?: boolean;
  readonly nestedConfig?: NestedSheetConfig;
};

export type NestedSheetConfig<T = unknown> = {
  readonly title: string;
  readonly searchEnabled?: boolean;
  readonly searchPlaceholder?: string;
  readonly items: readonly T[];
  readonly itemsPerRow?: number;
  readonly minHeight?: number;
  readonly renderItem?: (item: T, onSelect: (value: string) => void) => ReactNode;
};

export type FloatingSheetProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSelect: (value: string) => void;
  readonly options: readonly SheetOption[];
  readonly nestedSheetConfig?: NestedSheetConfig;
  readonly onNavigateToNested?: (optionId: string) => boolean;
};
