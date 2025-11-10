import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import { ChevronRight, Search, X } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { GRADIENT_PROPS } from "../lib/theme";
import type { FloatingSheetProps, NestedSheetConfig, SheetOption } from "./types";

function SheetBackdrop({ onPress }: { readonly onPress: () => void }) {
  return (
    <Pressable
      className="absolute inset-0 bg-black/50 focus:outline-none"
      onPress={onPress}
      accessible={false}
      style={{ zIndex: 1 }}
    />
  );
}

function SheetContainer({ children }: { readonly children: React.ReactNode }) {
  return (
    <View
      className="absolute inset-0 items-center justify-center px-4"
      style={{ zIndex: 2 }}
      pointerEvents="box-none"
    >
      <View className="w-full max-w-md" onStartShouldSetResponder={() => true}>
        <LinearGradient
          colors={["rgba(19, 19, 19, 0.98)", "rgba(24, 24, 24, 0.98)", "rgba(31, 31, 31, 0.98)"]}
          start={GRADIENT_PROPS.start}
          end={GRADIENT_PROPS.end}
          className="border-border/60 overflow-hidden rounded-2xl border"
        >
          {children}
        </LinearGradient>
      </View>
    </View>
  );
}

function SheetHeader({
  title,
  onClose,
  onBack,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly onBack?: () => void;
}) {
  return (
    <View className="border-border/30 flex-row items-center justify-between border-b px-4 py-3">
      {onBack ? (
        <Pressable onPress={onBack} className="mr-2 p-1 focus:outline-none">
          <ChevronRight size={20} color="rgb(161 161 170)" className="rotate-180" />
        </Pressable>
      ) : (
        <View className="w-6" />
      )}
      <Text className="font-sans-semibold text-foreground flex-1 text-center text-base">
        {title}
      </Text>
      <Pressable onPress={onClose} className="p-1 focus:outline-none">
        <X size={20} color="rgb(161 161 170)" />
      </Pressable>
    </View>
  );
}

function SheetOptionItem({
  option,
  onPress,
}: {
  readonly option: SheetOption;
  readonly onPress: () => void;
}) {
  const Icon = option.icon as LucideIcon | undefined;

  return (
    <Pressable
      onPress={onPress}
      className="border-border/20 flex-row items-center gap-3 border-b px-4 py-3.5 focus:outline-none active:bg-white/5"
    >
      {Icon && (
        <View className="size-10 items-center justify-center rounded-xl bg-white/5">
          <Icon size={20} color="rgb(255 255 255 / 0.9)" />
        </View>
      )}
      <View className="flex-1">
        <Text className="font-sans-semibold text-foreground text-sm">{option.title}</Text>
        {option.subtitle && (
          <Text className="text-muted-foreground font-sans text-xs">{option.subtitle}</Text>
        )}
      </View>
      {option.hasNested && <ChevronRight size={18} color="rgb(161 161 170)" />}
    </Pressable>
  );
}

function SheetSearch({
  value,
  onChangeText,
  placeholder,
}: {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly placeholder?: string;
}) {
  return (
    <View className="border-border/30 border-b px-4 py-3">
      <View className="flex-row items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
        <Search size={16} color="rgb(161 161 170)" />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? "Search..."}
          placeholderTextColor="rgb(161 161 170)"
          className="text-foreground flex-1 font-sans text-sm"
        />
      </View>
    </View>
  );
}

function NestedSheetContent<T>({
  config,
  onSelect,
  searchQuery,
}: {
  readonly config: NestedSheetConfig<T>;
  readonly onSelect: (value: string) => void;
  readonly searchQuery: string;
}) {
  const filteredItems = config.items.filter((item) => {
    if (!searchQuery) return true;
    const itemStr = typeof item === "string" ? item : JSON.stringify(item);
    return itemStr.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const itemsPerRow = config.itemsPerRow ?? 4;
  const minHeight = config.minHeight ?? 300;

  if (config.renderItem) {
    return (
      <ScrollView className="px-4 py-3" style={{ minHeight }} showsVerticalScrollIndicator={false}>
        <View className="flex-row flex-wrap gap-2">
          {filteredItems.map((item, index) => (
            <View key={index} className="basis-[calc((100%-8px)/4)]">
              {config.renderItem!(item, onSelect)}
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView className="px-4 py-3" style={{ minHeight }} showsVerticalScrollIndicator={false}>
      <View className="flex-row flex-wrap gap-2">
        {filteredItems.map((item, index) => {
          const value = typeof item === "string" ? item : String(index);
          const label = typeof item === "string" ? item : JSON.stringify(item);

          return (
            <Pressable
              key={index}
              onPress={() => onSelect(value)}
              className="items-center justify-center rounded-lg bg-white/5 p-3 focus:outline-none active:bg-white/10"
              style={{ width: `${100 / itemsPerRow - 2}%` }}
            >
              <Text className="font-sans-medium text-foreground text-center text-sm">{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function FloatingSheet({
  visible,
  onClose,
  onSelect,
  options,
  nestedSheetConfig,
  onNavigateToNested,
}: FloatingSheetProps) {
  const [activeNested, setActiveNested] = useState<SheetOption | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const handleClose = () => {
    setActiveNested(null);
    setSearchQuery("");
    onClose();
  };

  const handleBack = () => {
    setActiveNested(null);
    setSearchQuery("");
  };

  const handleOptionPress = (option: SheetOption) => {
    if (option.hasNested) {
      if (onNavigateToNested?.(option.id)) {
        setActiveNested(option);
      } else if (option.nestedConfig) {
        setActiveNested(option);
      }
    } else {
      option.action?.();
      onSelect(option.id);
      handleClose();
    }
  };

  const handleNestedSelect = (value: string) => {
    onSelect(value);
    handleClose();
  };

  const currentConfig = activeNested?.nestedConfig ?? nestedSheetConfig;
  const isNested = activeNested !== null;
  const title = isNested ? (currentConfig?.title ?? "Options") : "Quick Actions";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View className="flex-1">
        <SheetBackdrop onPress={handleClose} />
        <SheetContainer>
          <SheetHeader
            title={title}
            onClose={handleClose}
            onBack={isNested ? handleBack : undefined}
          />

          {isNested && currentConfig ? (
            <>
              {currentConfig.searchEnabled && (
                <SheetSearch
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={currentConfig.searchPlaceholder}
                />
              )}
              <NestedSheetContent
                config={currentConfig}
                onSelect={handleNestedSelect}
                searchQuery={searchQuery}
              />
            </>
          ) : (
            <ScrollView className="max-h-96" showsVerticalScrollIndicator={false}>
              {options.map((option) => (
                <SheetOptionItem
                  key={option.id}
                  option={option}
                  onPress={() => handleOptionPress(option)}
                />
              ))}
            </ScrollView>
          )}
        </SheetContainer>
      </View>
    </Modal>
  );
}

export type { FloatingSheetProps, NestedSheetConfig, SheetOption } from "./types";
