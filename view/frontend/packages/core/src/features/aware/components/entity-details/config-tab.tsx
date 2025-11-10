import { InfoRow } from "@hydra/ui/info-row";
import type { Entity } from "@projectqai/proto/world";
import * as Clipboard from "expo-clipboard";
import { Copy, Key, Server } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { toast } from "sonner-native";

import { useEntityMutation } from "../../../../lib/api/use-entity-mutation";

type ConfigTabProps = {
  entity: Entity;
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function JsonSyntax({ data, indent = 0 }: { data: JsonValue; indent?: number }) {
  const indentStr = "  ".repeat(indent);
  const nextIndent = indent + 1;
  const nextIndentStr = "  ".repeat(nextIndent);

  if (data === null) {
    return <Text className="text-yellow/80 font-mono text-[11px]">null</Text>;
  }

  if (typeof data === "boolean") {
    return <Text className="text-yellow/80 font-mono text-[11px]">{data ? "true" : "false"}</Text>;
  }

  if (typeof data === "number") {
    return <Text className="text-blue font-mono text-[11px]">{data}</Text>;
  }

  if (typeof data === "string") {
    return <Text className="text-green font-mono text-[11px]">{JSON.stringify(data)}</Text>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <Text className="text-foreground/50 font-mono text-[11px]">[]</Text>;
    }
    return (
      <Text className="font-mono text-[11px]">
        <Text className="text-foreground/50">[</Text>
        {"\n"}
        {data.map((item, i) => (
          <Text key={i}>
            <Text className="text-foreground/30">{nextIndentStr}</Text>
            <JsonSyntax data={item} indent={nextIndent} />
            {i < data.length - 1 && <Text className="text-foreground/50">,</Text>}
            {"\n"}
          </Text>
        ))}
        <Text className="text-foreground/30">{indentStr}</Text>
        <Text className="text-foreground/50">]</Text>
      </Text>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data);
    if (entries.length === 0) {
      return <Text className="text-foreground/50 font-mono text-[11px]">{"{}"}</Text>;
    }
    return (
      <Text className="font-mono text-[11px]">
        <Text className="text-foreground/50">{"{"}</Text>
        {"\n"}
        {entries.map(([key, value], i) => (
          <Text key={key}>
            <Text className="text-foreground/30">{nextIndentStr}</Text>
            <Text className="text-foreground/80">"{key}"</Text>
            <Text className="text-foreground/50">: </Text>
            <JsonSyntax data={value as JsonValue} indent={nextIndent} />
            {i < entries.length - 1 && <Text className="text-foreground/50">,</Text>}
            {"\n"}
          </Text>
        ))}
        <Text className="text-foreground/30">{indentStr}</Text>
        <Text className="text-foreground/50">{"}"}</Text>
      </Text>
    );
  }

  return null;
}

export function ConfigTab({ entity }: ConfigTabProps) {
  const config = entity.config;
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const { updateEntityConfig, isPending } = useEntityMutation();

  const jsonString = config?.value ? JSON.stringify(config.value, null, 2) : "null";

  useEffect(() => {
    if (editValue === "") return;
    const timer = setTimeout(() => {
      try {
        JSON.parse(editValue);
        setValidationError(null);
      } catch (e) {
        setValidationError(e instanceof Error ? e.message : "Invalid JSON");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [editValue]);

  if (!config) {
    return (
      <View className="flex-1 items-center justify-center px-2.5 py-6">
        <Text className="font-sans-medium text-foreground/40 text-sm">No configuration</Text>
      </View>
    );
  }

  const copyJson = async () => {
    await Clipboard.setStringAsync(jsonString);
    toast("Copied to clipboard");
  };

  const startEditing = () => {
    setEditValue(jsonString);
    setValidationError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditValue("");
    setValidationError(null);
  };

  const saveChanges = async () => {
    if (validationError) return;
    Keyboard.dismiss();
    try {
      const parsed = JSON.parse(editValue);
      await updateEntityConfig(entity, parsed);
      setIsEditing(false);
      setEditValue("");
      toast("Configuration saved");
    } catch {
      toast.error("Failed to save");
    }
  };

  return (
    <KeyboardAwareScrollView bottomOffset={20} style={{ flex: 1 }}>
      <View className="px-3 pt-3 pb-2">
        <Text className="text-foreground/50 mb-1 font-mono text-[11px] tracking-widest uppercase">
          Source
        </Text>
        <InfoRow icon={Server} label="Controller" value={config.controller} onCopy />
        <InfoRow icon={Key} label="Key" value={config.key} onCopy />
      </View>

      <View className="border-foreground/10 border-t px-3 pt-3 pb-3">
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="text-foreground/50 font-mono text-[11px] tracking-widest uppercase">
            Configuration
          </Text>
          <Pressable onPress={copyJson} hitSlop={8} className="hover:opacity-70 active:opacity-50">
            <Copy size={12} color="rgba(255, 255, 255, 0.4)" strokeWidth={2} />
          </Pressable>
        </View>

        {isEditing ? (
          <View>
            <TextInput
              value={editValue}
              onChangeText={setEditValue}
              multiline
              textAlignVertical="top"
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              className="border-foreground/20 bg-foreground/5 text-foreground/90 focus:border-foreground/40 min-h-[200px] rounded-lg border p-3 font-mono text-[11px] focus:outline-none"
              placeholderTextColor="rgba(255, 255, 255, 0.3)"
            />
            {validationError && (
              <Text className="text-red mt-1.5 font-mono text-[10px]">{validationError}</Text>
            )}
            <View className="mt-2 flex-row gap-1.5">
              <Pressable
                onPress={cancelEditing}
                disabled={isPending}
                className="border-foreground/20 bg-foreground/5 hover:bg-foreground/10 active:bg-foreground/10 flex-1 items-center justify-center rounded border py-2.5"
              >
                <Text className="font-sans-medium text-foreground/70 text-xs leading-none">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={saveChanges}
                disabled={isPending || !!validationError}
                className={`flex-1 items-center justify-center rounded py-2.5 ${
                  validationError
                    ? "bg-foreground/20"
                    : "bg-green hover:opacity-80 active:opacity-70"
                }`}
              >
                <Text className="font-sans-medium text-background text-xs leading-none">
                  {isPending ? "Saving..." : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View className="bg-foreground/[0.03] border-foreground/[0.06] rounded-lg border p-3">
              <JsonSyntax data={config.value as JsonValue} />
            </View>
            <Pressable
              onPress={startEditing}
              className="border-foreground/10 bg-foreground/5 hover:bg-foreground/10 active:bg-foreground/10 mt-1.5 flex-row items-center justify-center gap-1.5 rounded border py-1"
            >
              <Text className="font-sans-medium text-foreground/60 text-xs">Edit</Text>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAwareScrollView>
  );
}
