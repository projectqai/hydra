import AwareScreen from "@hydra/core/features/aware/aware-screen";
import { ActionsSection } from "@hydra/core/features/aware/components/entity-details/actions-section";
import { selectEntity, useEntityStore } from "@hydra/core/features/aware/store/entity-store";
import { useSelectionStore } from "@hydra/core/features/aware/store/selection-store";
import { cn } from "@hydra/ui/lib/utils";
import { Eye } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

function EntityActionButtons() {
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const selectedEntity = useEntityStore(selectEntity(selectedEntityId));
  const isFollowingEntity = useSelectionStore((s) => s.isFollowing);
  const toggleFollowEntity = useSelectionStore((s) => s.toggleFollow);

  const isTrack = !!selectedEntity?.track;

  return (
    <View className="gap-1.5">
      {isTrack && (
        <Pressable
          onPress={toggleFollowEntity}
          className={cn(
            "flex-row items-center justify-center gap-1.5 rounded-md border py-2.5",
            isFollowingEntity
              ? "border-green/50 bg-green/20 hover:bg-green/30 active:bg-green/30"
              : "border-foreground/10 bg-foreground/5 hover:bg-foreground/10 active:bg-foreground/10",
          )}
        >
          <Eye
            size={14}
            color={isFollowingEntity ? "rgb(61 141 122)" : "rgba(255, 255, 255, 0.7)"}
            strokeWidth={2}
          />
          <Text
            className={cn(
              "font-sans-medium text-xs leading-none",
              isFollowingEntity ? "text-green" : "text-foreground/80",
            )}
          >
            {isFollowingEntity ? "Following" : "Follow"}
          </Text>
        </Pressable>
      )}
      <ActionsSection />
    </View>
  );
}

export default function AwarePage() {
  return <AwareScreen headerActions={<EntityActionButtons />} />;
}
