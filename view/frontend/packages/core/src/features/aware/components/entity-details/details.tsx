import { Badge } from "@hydra/ui/badge";
import { truncateMiddle } from "@hydra/ui/lib/utils";
import { Tab, Tabs } from "@hydra/ui/tabs";
import type { Entity } from "@projectqai/proto/world";
import * as Clipboard from "expo-clipboard";
import { Copy, Eye, Info, MapPin, SquareStack } from "lucide-react-native";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { Pressable, Text, View } from "react-native";
import { toast } from "sonner-native";

import {
  getEntityName,
  getStatusBadgeVariant,
  getTrackStatus,
} from "../../../../lib/api/use-track-utils";
import { ComponentsTab } from "./components-tab";
import { InfoTab } from "./info-tab";
import { LocationTab } from "./location-tab";
import { OverviewTab } from "./overview-tab";

type EntityDetailsContextValue = {
  entity: Entity;
  entityName: string;
  status: "Friend" | "Hostile" | "Neutral" | "Unknown" | null;
};

const EntityDetailsContext = createContext<EntityDetailsContextValue | null>(null);

function useEntityDetails() {
  const context = useContext(EntityDetailsContext);
  if (!context) throw new Error("EntityDetails components must be used within EntityDetails.Root");
  return context;
}

function Root({ entity, children }: { entity: Entity; children: ReactNode }) {
  const status = entity.symbol?.milStd2525C ? getTrackStatus(entity.symbol.milStd2525C) : null;
  const entityName = getEntityName(entity);

  return (
    <EntityDetailsContext.Provider value={{ entity, entityName, status }}>
      <View className="flex-1">{children}</View>
    </EntityDetailsContext.Provider>
  );
}

function Header({ children }: { children?: ReactNode }) {
  const { entity, entityName, status } = useEntityDetails();

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    toast("Copied to clipboard");
  };

  return (
    <View className="border-foreground/5 border-b px-3 pt-2 pb-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-semibold text-foreground text-[15px]">{entityName}</Text>
        {status && (
          <Badge variant={getStatusBadgeVariant(status)} size="sm">
            {status}
          </Badge>
        )}
      </View>

      <Pressable
        onPress={() => copyToClipboard(entity.id)}
        className="mt-3 mb-2.5 flex-row items-center gap-1.5 active:opacity-70"
        hitSlop={8}
      >
        <Text className="text-foreground/50 flex-1 font-mono text-xs">
          {truncateMiddle(entity.id)}
        </Text>
        <Copy size={12} color="rgba(255, 255, 255, 0.4)" strokeWidth={2} />
      </Pressable>

      {children}
    </View>
  );
}

function DetailTabs() {
  const { entity } = useEntityDetails();

  return (
    <Tabs initialTab="overview">
      <Tab name="overview" title="Overview" subtitle="Overview" icon={Eye}>
        <OverviewTab entity={entity} />
      </Tab>
      {(entity.bearing || entity.locationUncertainty) && (
        <Tab name="location" title="Location" subtitle="Location" icon={MapPin}>
          <LocationTab entity={entity} />
        </Tab>
      )}
      {(entity.symbol || entity.lifetime) && (
        <Tab name="info" title="Info" subtitle="Info" icon={Info}>
          <InfoTab entity={entity} />
        </Tab>
      )}
      <Tab name="components" title="Components" subtitle="Components" icon={SquareStack}>
        <ComponentsTab entity={entity} />
      </Tab>
    </Tabs>
  );
}

export { useEntityDetails };

export const EntityDetails = {
  Root,
  Header,
  Tabs: DetailTabs,
};
