import type { Entity } from "@projectqai/proto/world";
import { Zap } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { toast } from "sonner-native";
import { useShallow } from "zustand/react/shallow";

import { useRunTask } from "../../../../lib/api/use-run-task";
import { useEntityStore } from "../../store/entity-store";
import { useSelectionStore } from "../../store/selection-store";

function getTaskableLabel(entity: Entity): string {
  return entity.label || entity.taskable?.label || entity.id;
}

function hasContextOrAssignee(entity: Entity, targetEntityId: string): boolean {
  if (!entity.taskable) return false;

  const hasContext = entity.taskable.context.some((c) => c.entityId === targetEntityId);
  const hasAssignee = entity.taskable.assignee.some((a) => a.entityId === targetEntityId);

  return hasContext || hasAssignee;
}

function TaskableButton({ taskable }: { taskable: Entity }) {
  const { runTask, isPending } = useRunTask();
  const label = getTaskableLabel(taskable);

  const handlePress = async () => {
    try {
      await runTask(taskable.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Task failed");
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={isPending}
      className="border-foreground/10 bg-foreground/5 hover:bg-foreground/10 active:bg-foreground/10 flex-1 flex-row items-center justify-center gap-1.5 rounded-md border py-2.5 select-none disabled:opacity-50"
    >
      {isPending ? (
        <View className="h-3.5 w-3.5 items-center justify-center">
          <ActivityIndicator size={14} color="rgba(255, 255, 255, 0.7)" />
        </View>
      ) : (
        <>
          <Zap size={14} color="rgba(255, 255, 255, 0.7)" strokeWidth={2} />
          <Text className="font-sans-medium text-foreground/80 text-xs leading-none">{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function ActionsSection() {
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);

  const taskables = useEntityStore(
    useShallow((s) => {
      if (!selectedEntityId) return [];

      const allEntities = Array.from(s.entities.values());
      const withTaskable = allEntities.filter((e) => e.taskable);
      const matching = withTaskable.filter((e) => hasContextOrAssignee(e, selectedEntityId));

      return matching;
    }),
  );

  if (!selectedEntityId) return null;

  if (taskables.length === 0) {
    return (
      <View className="py-2">
        <Text className="text-foreground/40 text-center font-sans text-xs">
          No actions available
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-1.5">
      {taskables.map((taskable) => (
        <TaskableButton key={taskable.id} taskable={taskable} />
      ))}
    </View>
  );
}
