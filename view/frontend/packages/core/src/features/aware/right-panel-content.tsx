import { generateSymbol } from "@hydra/map-engine/utils/milsymbol";
import { usePanelContext } from "@hydra/ui/panels";
import { Info } from "lucide-react-native";
import type { ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";

import { getEntityName } from "../../lib/api/use-track-utils";
import { EntityDetails } from "./components/entity-details/details";
import { selectEntity, useEntityStore } from "./store/entity-store";
import { useSelectionStore } from "./store/selection-store";

type RightPanelContentProps = {
  headerActions?: ReactNode;
};

function EmptyState() {
  return (
    <View className="flex-1 px-6 pt-16 select-none">
      <View className="items-center">
        <View className="opacity-30">
          <Info size={28} color="rgba(255, 255, 255)" strokeWidth={1.5} />
        </View>
        <Text className="font-sans-medium text-foreground/50 mt-2 text-center text-sm">
          No entity selected
        </Text>
        <Text className="text-foreground/30 text-center font-sans text-xs leading-relaxed">
          Click an entity on the map to view details
        </Text>
      </View>
    </View>
  );
}

export function CollapsedInfo() {
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const selectedEntity = useEntityStore(selectEntity(selectedEntityId));

  if (!selectedEntity) {
    return (
      <View className="flex-row items-center gap-1.5">
        <Info size={14} color="rgba(255, 255, 255, 0.5)" strokeWidth={2} />
        <Text className="font-sans-medium text-foreground/50 text-xs">No entity selected</Text>
      </View>
    );
  }

  const sidc = selectedEntity.symbol?.milStd2525C;

  return (
    <View className="flex-row items-center gap-1.5">
      {sidc ? (
        <Image source={{ uri: generateSymbol(sidc) }} className="size-5" />
      ) : (
        <Info size={14} color="rgba(255, 255, 255, 0.5)" strokeWidth={2} />
      )}
      <Text className="font-sans-medium text-foreground/80 text-xs">
        {getEntityName(selectedEntity)}
      </Text>
    </View>
  );
}

export function RightPanelContent({ headerActions }: RightPanelContentProps) {
  const { focusRightPanel } = usePanelContext();
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const selectedEntity = useEntityStore(selectEntity(selectedEntityId));

  if (!selectedEntity) {
    return <EmptyState />;
  }

  return (
    <Pressable onPress={focusRightPanel} className="flex-1 cursor-default">
      <EntityDetails.Root entity={selectedEntity}>
        <EntityDetails.Header>{headerActions}</EntityDetails.Header>
        <EntityDetails.Tabs />
      </EntityDetails.Root>
    </Pressable>
  );
}
